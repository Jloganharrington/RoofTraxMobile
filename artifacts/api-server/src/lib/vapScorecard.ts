import type {
  VinylAssessmentProtocol,
  VapDamageCategoryKey,
  StoredRepairabilityAssessment,
  RepairabilityAssessmentV3,
} from '@workspace/db';

// ── Vinyl Assessment Protocol (VAP) scorecard ───────────────────────────────
// Server-side mirror of the mobile vinyl repairability screen's scorecard
// math (artifacts/mobile/app/inspection-repairability.tsx). Pure functions
// over the stored repairabilityAssessment jsonb so reports and AI briefs
// render the same counts the rep saw in the field. Defensive throughout:
// stored jsonb may be legacy or partially filled.

export interface VapCategoryDef {
  key: VapDamageCategoryKey;
  /** Scorecard line label — matches the mobile screen. */
  label: string;
}

/** Display order for the scorecard — mobile question order 1–5. */
export const VAP_DAMAGE_CATEGORIES: VapCategoryDef[] = [
  { key: 'crackSplit', label: 'Cracked / split / torn / punctured panels' },
  { key: 'lockingEdge', label: 'Locking-edge / lap-joint failures' },
  { key: 'nailHem', label: 'Nail-hem / fastening-slot damage' },
  { key: 'trimInterface', label: 'Trim/interface damage' },
  { key: 'reseat', label: 'Reseating / alignment / movement concerns' },
];

/** Example-photo PRIORITY order (differs from display order): a broken /
 *  non-reengageable locking edge first, then a cracked/split panel, then
 *  trim-interface or nail-hem failures. */
export const VAP_PHOTO_PRIORITY: VapDamageCategoryKey[] = [
  'lockingEdge',
  'crackSplit',
  'nailHem',
  'trimInterface',
  'reseat',
];

export interface VapScorecard {
  /** The protocol removes exactly one target panel (X). */
  targetPanelsRemoved: number;
  panelsManipulated: number;
  trimManipulated: number;
  /** Unique components with any new collateral damage — a component counts
   *  once no matter how many damage types it recorded. */
  newCollateralDamagedComponents: number;
  /** Per-category affected-component counts, in display order. */
  categories: Array<{ key: VapDamageCategoryKey; label: string; count: number }>;
}

/** Section of the compiled report blob for the VAP scorecard. Server-built
 *  (never AI-generated); photo references are ids into photoIndex, never
 *  URLs. The final archive photo stays in the inspection archive and is NOT
 *  part of the report output. */
export interface VapReportSection {
  scorecard: VapScorecard;
  vap1PhotoId: string | null;
  examplePhotos: Array<{
    photoId: string;
    categoryKey: VapDamageCategoryKey;
    label: string;
    note: string | null;
  }>;
}

/**
 * Pull the VAP record out of a stored repairabilityAssessment jsonb value.
 * Only v3 records can carry one. Returns null for anything else or anything
 * malformed — callers treat null as "no VAP section".
 */
export function extractVap(assessment: unknown): VinylAssessmentProtocol | null {
  if (!assessment || typeof assessment !== 'object') return null;
  const ra = assessment as Partial<StoredRepairabilityAssessment> & {
    version?: number;
    vap?: VinylAssessmentProtocol | null;
  };
  const vap = ra.version === 3 ? (ra as RepairabilityAssessmentV3).vap : null;
  if (!vap || typeof vap !== 'object') return null;
  if (!vap.damage || typeof vap.damage !== 'object') return null;
  return vap;
}

const yesComponents = (vap: VinylAssessmentProtocol, key: VapDamageCategoryKey): string[] => {
  const finding = vap.damage[key];
  if (!finding || finding.answer !== 'yes' || !Array.isArray(finding.components)) return [];
  return finding.components.filter((c) => typeof c === 'string' && c.length > 0);
};

/** Mirror of the mobile scorecard math — unique components, not labels. */
export function computeVapScorecard(vap: VinylAssessmentProtocol): VapScorecard {
  const collateralSet = new Set<string>();
  for (const cat of VAP_DAMAGE_CATEGORIES) {
    for (const c of yesComponents(vap, cat.key)) collateralSet.add(c);
  }
  return {
    targetPanelsRemoved: 1,
    panelsManipulated: vap.panelsManipulated ?? 0,
    trimManipulated: vap.trimManipulated ?? 0,
    newCollateralDamagedComponents: collateralSet.size,
    categories: VAP_DAMAGE_CATEGORIES.map((cat) => ({
      key: cat.key,
      label: cat.label,
      count: yesComponents(vap, cat.key).length,
    })),
  };
}

/**
 * Pick the photos the report embeds: the VAP1 photo plus up to 2
 * newly-damaged-component example photos, in VAP_PHOTO_PRIORITY order
 * (locking edge → cracked panel → nail-hem/trim).
 */
export function selectVapReportPhotos(vap: VinylAssessmentProtocol): {
  vap1PhotoId: string | null;
  examplePhotoIds: string[];
} {
  const examplePhotoIds: string[] = [];
  for (const key of VAP_PHOTO_PRIORITY) {
    if (examplePhotoIds.length >= 2) break;
    const finding = vap.damage[key];
    if (finding?.answer === 'yes' && typeof finding.photoId === 'string' && finding.photoId) {
      if (!examplePhotoIds.includes(finding.photoId)) examplePhotoIds.push(finding.photoId);
    }
  }
  return {
    vap1PhotoId:
      typeof vap.vap1PhotoId === 'string' && vap.vap1PhotoId ? vap.vap1PhotoId : null,
    examplePhotoIds,
  };
}

/**
 * Build the server-side VAP section for the compiled report blob. Returns
 * null when the assessment has no VAP record — the report omits the section.
 */
export function buildVapReportSection(assessment: unknown): VapReportSection | null {
  const vap = extractVap(assessment);
  if (!vap) return null;
  const scorecard = computeVapScorecard(vap);
  const photos = selectVapReportPhotos(vap);
  const labelOf = new Map(VAP_DAMAGE_CATEGORIES.map((c) => [c.key, c.label]));
  const examplePhotos = photos.examplePhotoIds.map((photoId) => {
    const entry = (Object.keys(vap.damage) as VapDamageCategoryKey[])
      .map((key) => ({ key, finding: vap.damage[key] }))
      .find(({ finding }) => finding?.photoId === photoId);
    const key = entry?.key ?? 'lockingEdge';
    return {
      photoId,
      categoryKey: key,
      label: labelOf.get(key) ?? key,
      note: entry?.finding?.note ?? null,
    };
  });
  return { scorecard, vap1PhotoId: photos.vap1PhotoId, examplePhotos };
}

/**
 * Archive-only photo rule: the VAP final annotated archive photo stays
 * stored evidence but must NEVER enter report output (photo brief, photo
 * groupings, evidence manifest). Report compilation filters curated photos
 * through this predicate.
 */
export function isVapArchiveOnlyPhoto(assessment: unknown, photoId: string): boolean {
  const vap = extractVap(assessment);
  return vap?.finalPhotoId != null && vap.finalPhotoId === photoId;
}

/** Plain-text scorecard lines for the AI brief (matches report content). */
export function vapScorecardBriefLines(scorecard: VapScorecard): string[] {
  return [
    `Vinyl Assessment Protocol scorecard:`,
    `  Target panels removed: ${scorecard.targetPanelsRemoved}`,
    `  Panels manipulated: ${scorecard.panelsManipulated}`,
    `  Trim/interface components manipulated: ${scorecard.trimManipulated}`,
    `  New collateral-damaged panels/components (unique): ${scorecard.newCollateralDamagedComponents}`,
    ...scorecard.categories.map((c) => `  ${c.label}: ${c.count}`),
  ];
}
