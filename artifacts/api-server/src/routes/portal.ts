import { and, asc, eq, isNull } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';
import {
  db,
  companiesTable,
  inspectionsTable,
  inspectionPhotosTable,
  usersTable,
} from '@workspace/db';

import { normalizePortalAccessCode } from '../lib/portalAccess';
import { ObjectStorageService } from '../lib/objectStorage';
import { isVapArchiveOnlyPhoto } from '../lib/vapScorecard';
import { renderCompiledReportHtml } from './inspections';

// ─────────────────────────────────────────────────────────────────────────
// Public Evidence Portal — NO session auth. The share code (59 bits of
// entropy, generated at Proof Package compile time) is the sole capability.
// Serves ONLY: inspection summary, evidence photos, and compiled Proof
// Package versions. Agreement/FIPSA content is NEVER served here, and
// archive-only protocol photos (e.g. the VAP final archive) are excluded —
// the same exclusion every report/export surface must reapply.
// ─────────────────────────────────────────────────────────────────────────

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// Simple fixed-window per-IP rate limit: unauthenticated code lookups are a
// brute-force surface (even with 59-bit codes, throttling is cheap defense).
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 30;
const attempts = new Map<string, { windowStart: number; count: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    // Bound the map: sweep expired windows before inserting.
    if (attempts.size >= 10_000) {
      for (const [key, val] of attempts) {
        if (now - val.windowStart > WINDOW_MS) attempts.delete(key);
      }
    }
    attempts.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > MAX_ATTEMPTS_PER_WINDOW;
}

/** Resolve an access code to a live (non-revoked) inspection row, or null. */
async function loadInspectionByCode(rawCode: string) {
  const code = normalizePortalAccessCode(rawCode);
  if (!code) return null;
  const [inspection] = await db
    .select()
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.portalAccessCode, code),
        isNull(inspectionsTable.portalAccessRevokedAt),
      ),
    );
  return inspection ?? null;
}

function guardRateLimit(req: Request, res: Response): boolean {
  const ip = req.ip ?? 'unknown';
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.' });
    return false;
  }
  return true;
}

// GET /portal/:accessCode — inspection summary + photos + report versions.
router.get('/portal/:accessCode', async (req: Request, res: Response) => {
  if (!guardRateLimit(req, res)) return;

  const inspection = await loadInspectionByCode(req.params.accessCode as string);
  if (!inspection) {
    res.status(404).json({ error: 'Unknown access code.' });
    return;
  }

  const [[company], [inspector], photoRows] = await Promise.all([
    db
      .select({ name: companiesTable.name })
      .from(companiesTable)
      .where(eq(companiesTable.id, inspection.companyId)),
    inspection.inspectorUserId
      ? db
          .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
          .from(usersTable)
          .where(eq(usersTable.id, inspection.inspectorUserId))
      : Promise.resolve([] as Array<{ firstName: string | null; lastName: string | null }>),
    db
      .select()
      .from(inspectionPhotosTable)
      .where(eq(inspectionPhotosTable.inspectionId, inspection.id))
      .orderBy(asc(inspectionPhotosTable.createdAt)),
  ]);

  // Archive-only protocol photos (e.g. VAP final archive) must never leave
  // the system through this surface.
  const visible = photoRows.filter(
    (p) => !isVapArchiveOnlyPhoto(inspection.repairabilityAssessment, p.id),
  );

  const photos = (
    await Promise.all(
      visible.map(async (p) => {
        const url = await objectStorageService.tryGetSignedObjectUrl(p.url);
        if (!url) return null;
        const overlay = p.overlayJson as { caption?: unknown } | null;
        return {
          id: p.id,
          url,
          capturedAtUtc: p.capturedAtUtc ? p.capturedAtUtc.toISOString() : null,
          stage: p.stage,
          zone: p.zone,
          subjectType: p.subjectType,
          caption: typeof overlay?.caption === 'string' ? overlay.caption : null,
        };
      }),
    )
  ).filter((p): p is NonNullable<typeof p> => p !== null);

  const versions = (inspection.compiledReportVersions ?? []) as Array<{
    path: string;
    generatedAt: string;
    lintStatus?: 'passed' | 'needs_review' | 'blocked';
  }>;
  const reportVersions = versions.map((v, i) => ({
    versionIndex: i,
    generatedAt: v.generatedAt,
    // Blocked versions are listed (history is honest) but not served unless
    // a reviewer resolved that exact blob path.
    shareable:
      v.lintStatus !== 'blocked' ||
      inspection.reportLintResolution?.path === v.path,
  }));

  const inspectorName =
    inspector && (inspector.firstName || inspector.lastName)
      ? [inspector.firstName, inspector.lastName].filter(Boolean).join(' ')
      : null;

  res.json({
    inspection: {
      address: inspection.address,
      claimNumber: inspection.claimNumber,
      carrierName: inspection.carrierName,
      dateOfLoss: inspection.dateOfLoss,
      inspectorName,
      companyName: company?.name ?? null,
      completedAt: inspection.lockedAt ? inspection.lockedAt.toISOString() : null,
    },
    photos,
    reportVersions,
  });
});

// GET /portal/:accessCode/reports/:versionIndex — rendered Proof Package HTML.
router.get('/portal/:accessCode/reports/:versionIndex', async (req: Request, res: Response) => {
  if (!guardRateLimit(req, res)) return;

  const inspection = await loadInspectionByCode(req.params.accessCode as string);
  if (!inspection) {
    res.status(404).json({ error: 'Unknown access code.' });
    return;
  }

  const versions = (inspection.compiledReportVersions ?? []) as Array<{ path: string }>;
  const idx = Number(req.params.versionIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= versions.length) {
    res.status(404).json({ error: 'Unknown report version.' });
    return;
  }

  // allowBlocked is always false here — blocked content never leaves the
  // company through the public portal (resolved versions pass the gate
  // inside the renderer via reportLintResolution).
  const rendered = await renderCompiledReportHtml({
    inspection,
    reportPath: versions[idx].path,
    companyId: inspection.companyId,
    allowBlocked: false,
    // The portal page itself is where the reader already is — no access
    // block needed inside portal-rendered copies.
    portalAccess: null,
  });
  if (!rendered.ok) {
    res.status(409).json({ error: 'This report version is not available for sharing.' });
    return;
  }
  res.json({ html: rendered.html });
});

export default router;
