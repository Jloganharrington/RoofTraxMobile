import type {
  RepairAttemptProtocol,
  RepairabilityAssessment,
  RapDamageCategoryKey,
  RapSelection,
  RapSelectionCriteria,
} from '@workspace/db';

// ── Repair Attempt Protocol (RAP) scorecard ────────────────────────────────
// Server-side mirror of the mobile RAP screen's scorecard math
// (artifacts/mobile/app/inspection-repairability.tsx). Pure functions over
// the stored repairabilityAssessment jsonb so reports and AI briefs render
// the same counts the rep saw in the field. Everything here is defensive:
// stored jsonb may be legacy v1, v2 without RAP, or partially filled.

/** Legacy fallback: shingle "X" plus shingles 1–8 are all handled during the
 *  protocol. Used only for RAP records that predate the explicit
 *  manipulated-count question (v3 records carry `manipulatedCount`). */
export const RAP_MANIPULATED_SHINGLE_COUNT = 9;

export interface RapCategoryDef {
  key: RapDamageCategoryKey;
  /** Scorecard line label — matches the mobile screen. */
  label: string;
}

/** Display order for the scorecard AND priority order for example photos
 *  (delamination first, then creasing/cracking/fracture, then the rest). */
export const RAP_DAMAGE_CATEGORIES: RapCategoryDef[] = [
  { key: 'delamination', label: 'Delamination' },
  { key: 'creasing', label: 'Creasing/cracking/fracture' },
  { key: 'nailZone', label: 'Nail-zone damage' },
  { key: 'puncture', label: 'Puncture/tear/gouge' },
  { key: 'reseat', label: 'Reseating/seal-integration concerns' },
];

export interface RapScorecard {
  manipulatedShingles: number;
  /** Unique shingles (1–8) with any new collateral damage — a shingle
   *  counts once no matter how many damage types it recorded. */
  newCollateralDamagedShingles: number;
  /** Mat-transfer "yes" findings on shingles 1–2 (0, 1, or 2). */
  matTransferCount: number;
  /** Per-category affected-shingle counts, in display order. */
  categories: Array<{ key: RapDamageCategoryKey; label: string; count: number }>;
}

export interface RapReportPhotos {
  rap1PhotoId: string | null;
  /** Up to 2 newly-damaged-shingle example photo ids, priority-ordered. */
  examplePhotoIds: string[];
}

/** Section of the compiled report blob for the RAP scorecard. Server-built
 *  (never AI-generated); photo references are ids into photoIndex, never
 *  URLs. */
export interface RapReportSection {
  scorecard: RapScorecard;
  rap1PhotoId: string | null;
  examplePhotos: Array<{ photoId: string; categoryKey: RapDamageCategoryKey; label: string; note: string | null }>;
  /** Target-shingle selection record. Absent on legacy assessments that
   *  predate the selection step — renderers must treat it as optional. */
  selection?: RapSelection | null;
}

/**
 * Pull the RAP record out of a stored repairabilityAssessment jsonb value.
 * v2 records carry it inside the roof flow (`roof.rap`); v3 records carry
 * it at the top level (`rap`). Returns null for legacy v1 records, records
 * without a RAP, or anything malformed — callers treat null as "no RAP
 * section".
 */
export function extractRap(assessment: unknown): RepairAttemptProtocol | null {
  if (!assessment || typeof assessment !== 'object') return null;
  const ra = assessment as Partial<RepairabilityAssessment> & {
    version?: number;
    rap?: RepairAttemptProtocol | null;
  };
  const rap = ra.version === 2 ? ra.roof?.rap : ra.version === 3 ? ra.rap : null;
  if (!rap || typeof rap !== 'object') return null;
  if (!rap.damage || typeof rap.damage !== 'object') return null;
  return rap;
}

const yesShingles = (rap: RepairAttemptProtocol, key: RapDamageCategoryKey): number[] => {
  const finding = rap.damage[key];
  if (!finding || finding.answer !== 'yes' || !Array.isArray(finding.shingles)) return [];
  return finding.shingles.filter((s) => Number.isFinite(s));
};

/** Mirror of the mobile scorecard math. */
export function computeRapScorecard(rap: RepairAttemptProtocol): RapScorecard {
  const collateralSet = new Set<number>();
  const mt = rap.matTransfer ?? { shingle1: null, shingle2: null };
  if (mt.shingle1 === 'yes') collateralSet.add(1);
  if (mt.shingle2 === 'yes') collateralSet.add(2);
  for (const cat of RAP_DAMAGE_CATEGORIES) {
    for (const s of yesShingles(rap, cat.key)) collateralSet.add(s);
  }
  const matTransferCount = (mt.shingle1 === 'yes' ? 1 : 0) + (mt.shingle2 === 'yes' ? 1 : 0);
  return {
    // v3 records answer the count explicitly (6/7/8); legacy records render
    // the historical fixed count. Mirrors the mobile screen's scorecard.
    manipulatedShingles: rap.manipulatedCount ?? RAP_MANIPULATED_SHINGLE_COUNT,
    newCollateralDamagedShingles: collateralSet.size,
    matTransferCount,
    categories: RAP_DAMAGE_CATEGORIES.map((cat) => ({
      key: cat.key,
      label: cat.label,
      count: yesShingles(rap, cat.key).length,
    })),
  };
}

/**
 * Pick the photos the report embeds: the RAP1 photo plus up to 2
 * newly-damaged-shingle example photos. When more than 2 categories have
 * photos, priority goes to 1 delamination example and 1
 * creasing/cracking/fracture example; remaining slots (if either of those
 * is missing) fill in category display order.
 */
export function selectRapReportPhotos(rap: RepairAttemptProtocol): RapReportPhotos {
  const candidates: Array<{ photoId: string; key: RapDamageCategoryKey }> = [];
  for (const cat of RAP_DAMAGE_CATEGORIES) {
    const finding = rap.damage[cat.key];
    if (finding?.answer === 'yes' && typeof finding.photoId === 'string' && finding.photoId) {
      candidates.push({ photoId: finding.photoId, key: cat.key });
    }
  }
  // Candidates are already in priority order (delamination, creasing, …):
  // taking the first two implements "1 delamination + 1 creasing when both
  // exist, otherwise fill from the next categories in order".
  const examplePhotoIds: string[] = [];
  for (const c of candidates) {
    if (examplePhotoIds.length >= 2) break;
    if (!examplePhotoIds.includes(c.photoId)) examplePhotoIds.push(c.photoId);
  }
  return {
    rap1PhotoId:
      typeof rap.rap1PhotoId === 'string' && rap.rap1PhotoId ? rap.rap1PhotoId : null,
    examplePhotoIds,
  };
}

/**
 * Build the server-side RAP section for the compiled report blob. Returns
 * null when the assessment has no RAP record (legacy assessments — the
 * report simply omits the section).
 */
export function buildRapReportSection(assessment: unknown): RapReportSection | null {
  const rap = extractRap(assessment);
  if (!rap) return null;
  const scorecard = computeRapScorecard(rap);
  const photos = selectRapReportPhotos(rap);
  const labelOf = new Map(RAP_DAMAGE_CATEGORIES.map((c) => [c.key, c.label]));
  const examplePhotos = photos.examplePhotoIds.map((photoId) => {
    const entry = (Object.keys(rap.damage) as RapDamageCategoryKey[])
      .map((key) => ({ key, finding: rap.damage[key] }))
      .find(({ finding }) => finding?.photoId === photoId);
    const key = entry?.key ?? 'delamination';
    return {
      photoId,
      categoryKey: key,
      label: labelOf.get(key) ?? key,
      note: entry?.finding?.note ?? null,
    };
  });
  return { scorecard, rap1PhotoId: photos.rap1PhotoId, examplePhotos, selection: rap.selection ?? null };
}

/** Plain-text scorecard lines for the AI brief (matches report content). */
export function rapScorecardBriefLines(
  scorecard: RapScorecard,
  selection?: RapSelection | null,
): string[] {
  const lines: string[] = [
    `Repair Attempt Protocol scorecard:`,
    `  Manipulated shingles: ${scorecard.manipulatedShingles}`,
    `  New collateral-damaged shingles (unique): ${scorecard.newCollateralDamagedShingles}`,
    `  Mat-transfer findings on shingles 1-2: ${scorecard.matTransferCount}`,
    ...scorecard.categories.map((c) => `  ${c.label}: ${c.count}`),
  ];
  if (selection?.mode === 'damaged_target') {
    lines.push('  Selection criteria: confirmed (damaged target shingle)');
  } else if (selection?.mode === 'fallback_slope') {
    lines.push(
      `  Selection criteria: fallback — no damaged shingle usable; note: ${selection.note ?? '(none)'}`,
    );
  }
  return lines;
}
