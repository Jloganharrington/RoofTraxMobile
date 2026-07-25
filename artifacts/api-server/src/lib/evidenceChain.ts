// Evidence-chain helpers for the Proof Package: photo → damage finding →
// estimate/scope line. Pure functions only — routes own authz/persistence.
// Everything here is server-built provenance; AI narrative never feeds it.
import type { EstimateLineItem, EvidenceLink } from '@workspace/db';

import { escHtml } from './reportTemplate';

// ---------------------------------------------------------------------------
// Linked-finding summaries (photo subject → immutable display summary)
// ---------------------------------------------------------------------------

export interface LinkedFindingSummary {
  subjectType: string;
  subjectId: string;
  /** Stable human-readable reference, e.g. "Finding a1b2c3d4 — hail". */
  displayRef: string;
  /** Location/zone/slope label when available. */
  location: string | null;
  /** Observed-condition summary from the linked record, when available. */
  observedCondition: string | null;
}

interface DamageInstanceLike {
  id: string;
  slopeId: string | null;
  elevationId: string | null;
  damageType: string;
  severity: string | null;
  notes: string | null;
}

interface SlopeLike {
  id: string;
  label: string;
  damageType?: string | null;
}

const shortRef = (id: string) => id.slice(0, 8);
const trim = (s: string | null | undefined, max = 160) => {
  const t = s?.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * Build a compact immutable summary of the record a photo is attached to.
 * Returns null when the photo has no subject link. Rich summaries for damage
 * instances and slopes; a stable display reference for every other subject.
 */
export function buildLinkedFindingSummary(
  photo: { subjectType: string | null; subjectId: string | null },
  lookups: {
    damageById: Map<string, DamageInstanceLike>;
    slopeById: Map<string, SlopeLike>;
  },
): LinkedFindingSummary | null {
  const { subjectType, subjectId } = photo;
  if (!subjectType || !subjectId) return null;

  if (subjectType === 'damage_instance') {
    const d = lookups.damageById.get(subjectId);
    if (d) {
      const slope = d.slopeId ? lookups.slopeById.get(d.slopeId) : undefined;
      return {
        subjectType,
        subjectId,
        displayRef: `Finding ${shortRef(d.id)} — ${d.damageType}`,
        location: slope ? `Slope ${slope.label}` : d.elevationId ? 'Elevation' : null,
        observedCondition:
          trim([d.damageType, d.severity].filter(Boolean).join(', ')) ?? null,
      };
    }
  }
  if (subjectType === 'slope') {
    const s = lookups.slopeById.get(subjectId);
    if (s) {
      return {
        subjectType,
        subjectId,
        displayRef: `Slope ${s.label}`,
        location: `Slope ${s.label}`,
        observedCondition: trim(s.damageType ?? null),
      };
    }
  }
  // Any other subject: keep a stable reference without inventing detail.
  return {
    subjectType,
    subjectId,
    displayRef: `${subjectType.replace(/_/g, ' ')} ${shortRef(subjectId)}`,
    location: null,
    observedCondition: null,
  };
}

// ---------------------------------------------------------------------------
// Approved scope links (estimate lines → evidence), snapshot-ready
// ---------------------------------------------------------------------------

export interface ApprovedScopeLink {
  /** Index of the line in the estimate's lines array at compile time. */
  scopeLineIndex: number;
  /** Snapshot of the line's description so old versions stay readable. */
  scopeDescription: string;
  photoIds: string[];
  damageInstanceIds: string[];
  /** linkSource per target id, e.g. { "<id>": "inspector" }. */
  linkSources: Record<string, string>;
}

/**
 * Extract ONLY approved evidence links from estimate lines. Unreviewed or
 * rejected links (including AI-suggested ones) never reach the compiled
 * snapshot, the manifest hash, or carrier-facing rendering.
 */
export function collectApprovedScopeLinks(
  lines: EstimateLineItem[] | null | undefined,
): ApprovedScopeLink[] {
  if (!lines?.length) return [];
  const out: ApprovedScopeLink[] = [];
  lines.forEach((line, i) => {
    const approved = (line.evidenceLinks ?? []).filter((l) => l.reviewStatus === 'approved');
    if (approved.length === 0) return;
    const photoIds: string[] = [];
    const damageInstanceIds: string[] = [];
    const linkSources: Record<string, string> = {};
    for (const l of approved) {
      if (l.targetType === 'photo') photoIds.push(l.targetId);
      else damageInstanceIds.push(l.targetId);
      linkSources[l.targetId] = l.linkSource;
    }
    out.push({
      scopeLineIndex: i,
      scopeDescription: line.description,
      photoIds: [...new Set(photoIds)].sort(),
      damageInstanceIds: [...new Set(damageInstanceIds)].sort(),
      linkSources,
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Link validation + review stamping (PUT estimate)
// ---------------------------------------------------------------------------

export interface RawEvidenceLinkInput {
  targetType: 'photo' | 'damage_instance';
  targetId: string;
  linkSource: EvidenceLink['linkSource'];
  reviewStatus: EvidenceLink['reviewStatus'];
}

/**
 * Normalize client-supplied links for one line: dedupe by target, verify no
 * dangling ids, and stamp review metadata server-side. Returns the cleaned
 * links or a validation error message.
 */
export function normalizeEvidenceLinks(
  raw: RawEvidenceLinkInput[] | undefined,
  ctx: {
    validPhotoIds: Set<string>;
    validDamageInstanceIds: Set<string>;
    reviewerUserId: string;
    now: string;
    /** Prior links for this line keyed by `${targetType}:${targetId}` — so an
     *  unchanged link keeps its original review stamp instead of re-stamping. */
    prior?: Map<string, EvidenceLink>;
  },
): { links: EvidenceLink[] } | { error: string } {
  if (!raw?.length) return { links: [] };
  const seen = new Set<string>();
  const links: EvidenceLink[] = [];
  for (const l of raw) {
    const key = `${l.targetType}:${l.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const valid =
      l.targetType === 'photo'
        ? ctx.validPhotoIds.has(l.targetId)
        : ctx.validDamageInstanceIds.has(l.targetId);
    if (!valid) {
      return { error: `Evidence link references unknown ${l.targetType} "${l.targetId}"` };
    }
    const prior = ctx.prior?.get(key);
    if (l.reviewStatus === 'unreviewed') {
      links.push({ ...l, reviewedBy: null, reviewedAt: null });
    } else if (
      prior &&
      prior.reviewStatus === l.reviewStatus &&
      prior.linkSource === l.linkSource &&
      prior.reviewedBy
    ) {
      // Unchanged decision — preserve the original review stamp.
      links.push({ ...l, reviewedBy: prior.reviewedBy, reviewedAt: prior.reviewedAt });
    } else {
      // New or changed decision — stamped with the acting reviewer, never
      // client-supplied.
      links.push({ ...l, reviewedBy: ctx.reviewerUserId, reviewedAt: ctx.now });
    }
  }
  return { links };
}

// ---------------------------------------------------------------------------
// Evidence-to-Scope Index appendix (render-time, approved links only)
// ---------------------------------------------------------------------------

export interface ManifestPhotoEntryLike {
  photoId: string;
  stage: string | null;
  subjectType: string | null;
  triadRole: string | null;
  zone: string | null;
  linkedFinding?: LinkedFindingSummary | null;
}

/**
 * Build the "Evidence-to-Scope Index" appendix HTML. Server-built and fully
 * escaped; includes ONLY approved links. When a photo has no approved scope
 * mapping, the scope cell is omitted — never inferred.
 */
export function buildEvidenceScopeIndexHtml(params: {
  approvedScopeLinks: ApprovedScopeLink[];
  manifestPhotos: ManifestPhotoEntryLike[];
  /** damageInstanceId → display summary (from manifest linked findings or lookups). */
  findingDisplayById: Map<string, { displayRef: string; location: string | null }>;
}): string | null {
  const { approvedScopeLinks, manifestPhotos } = params;
  if (approvedScopeLinks.length === 0) return null;

  const photoById = new Map(manifestPhotos.map((p) => [p.photoId, p]));
  const rows: string[] = [];

  for (const link of approvedScopeLinks) {
    // Photo-backed rows.
    for (const pid of link.photoIds) {
      const photo = photoById.get(pid);
      const location = photo
        ? [photo.zone, photo.stage, photo.triadRole].filter(Boolean).join(' · ')
        : '';
      const finding = photo?.linkedFinding
        ? `${photo.linkedFinding.displayRef}${photo.linkedFinding.location ? ` (${photo.linkedFinding.location})` : ''}`
        : '—';
      rows.push(`<tr>
        <td style="font-family:monospace;font-size:10px">${escHtml(pid)}</td>
        <td>${escHtml(location ? `Photo — ${location}` : 'Photo')}</td>
        <td>${escHtml(finding)}</td>
        <td>${escHtml(link.scopeDescription)}</td>
        <td>Approved</td>
      </tr>`);
    }
    // Finding-backed rows (no specific photo).
    for (const did of link.damageInstanceIds) {
      const display = params.findingDisplayById.get(did);
      rows.push(`<tr>
        <td style="font-family:monospace;font-size:10px">${escHtml(did)}</td>
        <td>${escHtml(display?.location ?? '—')}</td>
        <td>${escHtml(display?.displayRef ?? `Finding ${did.slice(0, 8)}`)}</td>
        <td>${escHtml(link.scopeDescription)}</td>
        <td>Approved</td>
      </tr>`);
    }
  }

  if (rows.length === 0) return null;
  return `
<p style="font-size:12px;color:#555">Each row maps a piece of evidence (photo or documented finding) to the
specific repair/scope item it supports. Only inspector-approved links appear here; where no approved mapping
exists, no scope link is shown. This index is generated from structured inspection records, never from AI narrative.</p>
<table class="detail-table" style="font-size:11px">
  <tr><th>Evidence ID</th><th>Photo / Location</th><th>Linked Finding</th><th>Linked Scope Item</th><th>Link Status</th></tr>
  ${rows.join('\n')}
</table>`;
}
