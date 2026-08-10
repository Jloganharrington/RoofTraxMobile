import {
  CreateBugReportBody,
  UpdateBugReportBody,
} from '@workspace/api-zod';
import { roleRank, type Role } from '@workspace/authz';
import { db, bugReportsTable, userProfilesTable, usersTable } from '@workspace/db';
import { and, desc, eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';
import { requirePermission } from '../middlewares/requirePermission';

// Beta bug reporting (temporary instrument, flag-gated client-side).
// Writes are accepted even while the company flag is off: reports queue in
// the mobile outbox and may drain AFTER the beta flag is flipped — rejecting
// them would dead-letter legitimate feedback that was filed while enabled.

const router: IRouter = Router();

// --- Rate limit: 10 reports / user / hour (in-memory sliding window). ------
// Purpose is abuse containment for a stuck client retry loop, not billing
// accuracy, so an in-process store is fine for a single-instance beta server.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const recentByUser = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const timestamps = (recentByUser.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT) {
    recentByUser.set(userId, timestamps);
    return true;
  }
  timestamps.push(now);
  recentByUser.set(userId, timestamps);
  return false;
}

function isAdmin(role: string | null | undefined): boolean {
  return roleRank((role ?? 'field_rep') as Role) >= roleRank('admin');
}

async function loadActor(userId: string) {
  const [row] = await db
    .select({ role: userProfilesTable.role, companyId: usersTable.companyId })
    .from(usersTable)
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, usersTable.id))
    .where(eq(usersTable.id, userId));
  return row ?? null;
}

function toApiBugReport(
  row: typeof bugReportsTable.$inferSelect,
  reporter?: { firstName: string | null; lastName: string | null; email: string | null } | null,
) {
  return {
    id: row.id,
    companyId: row.companyId,
    userId: row.userId,
    reporterName: reporter
      ? [reporter.firstName, reporter.lastName].filter(Boolean).join(' ') || null
      : null,
    reporterEmail: reporter?.email ?? null,
    route: row.route,
    routeParams: row.routeParams ?? null,
    severity: row.severity,
    description: row.description,
    context: row.context,
    screenshotUrl: row.screenshotUrl ?? null,
    appVersion: row.appVersion ?? null,
    platform: row.platform ?? null,
    osVersion: row.osVersion ?? null,
    status: row.status,
    internalNote: row.internalNote ?? null,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// bug_report.submit
router.post('/bug-reports', requirePermission('bug_report.submit'), async (req: Request, res: Response) => {

  const parsed = CreateBugReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid bug report payload' });
    return;
  }
  const input = parsed.data;

  // Idempotent replay (mobile outbox): if this client id already exists for
  // this user, treat the retry as success — do NOT count it against the rate
  // limit or duplicate the row.
  const [existing] = await db
    .select()
    .from(bugReportsTable)
    .where(and(eq(bugReportsTable.id, input.id), eq(bugReportsTable.userId, req.actorCtx!.actorId)));
  if (existing) {
    res.status(201).json({ bugReport: toApiBugReport(existing) });
    return;
  }

  if (isRateLimited(req.actorCtx!.actorId)) {
    res.status(429).json({ error: 'Too many bug reports; try again later' });
    return;
  }

  const [row] = await db
    .insert(bugReportsTable)
    .values({
      id: input.id,
      companyId: req.actorCtx!.companyId,
      userId: req.actorCtx!.actorId,
      route: input.route,
      routeParams: input.routeParams ?? null,
      severity: input.severity,
      description: input.description,
      context: input.context,
      screenshotUrl: input.screenshotUrl ?? null,
      appVersion: input.appVersion ?? null,
      platform: input.platform ?? null,
      osVersion: input.osVersion ?? null,
    })
    .onConflictDoNothing()
    .returning();

  if (!row) {
    // Conflict on an id owned by ANOTHER user — a forged/colliding client id.
    res.status(400).json({ error: 'Bug report id conflict' });
    return;
  }

  res.status(201).json({ bugReport: toApiBugReport(row) });
});

// bug_report.manage
router.get('/bug-reports', requirePermission('bug_report.manage'), async (req: Request, res: Response) => {
  const actor = { companyId: req.actorCtx!.companyId };

  const rows = await db
    .select({ report: bugReportsTable, reporter: usersTable })
    .from(bugReportsTable)
    .leftJoin(usersTable, eq(usersTable.id, bugReportsTable.userId))
    .where(eq(bugReportsTable.companyId, actor.companyId))
    .orderBy(desc(bugReportsTable.createdAt));

  res.json({ bugReports: rows.map((r) => toApiBugReport(r.report, r.reporter)) });
});

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

// bug_report.manage
router.get('/bug-reports/export.csv', requirePermission('bug_report.manage'), async (req: Request, res: Response) => {
  const actor = { companyId: req.actorCtx!.companyId };

  const rows = await db
    .select({ report: bugReportsTable, reporter: usersTable })
    .from(bugReportsTable)
    .leftJoin(usersTable, eq(usersTable.id, bugReportsTable.userId))
    .where(eq(bugReportsTable.companyId, actor.companyId))
    .orderBy(desc(bugReportsTable.createdAt));

  const header = [
    'createdAt',
    'severity',
    'status',
    'route',
    'description',
    'reporterName',
    'reporterEmail',
    'appVersion',
    'platform',
    'osVersion',
    'screenshotUrl',
    'internalNote',
    'context',
  ];
  const lines = [header.join(',')];
  for (const { report, reporter } of rows) {
    const api = toApiBugReport(report, reporter);
    lines.push(
      [
        api.createdAt,
        api.severity,
        api.status,
        api.route,
        api.description,
        api.reporterName,
        api.reporterEmail,
        api.appVersion,
        api.platform,
        api.osVersion,
        api.screenshotUrl,
        api.internalNote,
        JSON.stringify(api.context),
      ]
        .map(csvEscape)
        .join(','),
    );
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="bug-reports.csv"');
  res.send(lines.join('\n'));
});

// bug_report.manage
router.patch('/bug-reports/:bugReportId', requirePermission('bug_report.manage'), async (req: Request, res: Response) => {
  const actor = { companyId: req.actorCtx!.companyId };

  const parsed = UpdateBugReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid update payload' });
    return;
  }
  const { status, internalNote } = parsed.data;

  const [row] = await db
    .update(bugReportsTable)
    .set({
      ...(status !== undefined ? { status } : {}),
      ...(internalNote !== undefined ? { internalNote } : {}),
      ...(status === 'fixed'
        ? { resolvedAt: new Date() }
        : status !== undefined
          ? { resolvedAt: null }
          : {}),
    })
    .where(
      and(
        eq(bugReportsTable.id, String(req.params.bugReportId)),
        eq(bugReportsTable.companyId, actor.companyId),
      ),
    )
    .returning();

  if (!row) {
    res.status(404).json({ error: 'Bug report not found' });
    return;
  }

  res.json({ bugReport: toApiBugReport(row) });
});

export default router;
