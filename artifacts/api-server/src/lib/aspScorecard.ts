import type {
  AluminumSidingProtocol,
  AspConditionKey,
  AspElevation,
  RepairabilityAssessmentV3,
  StoredRepairabilityAssessment,
} from '@workspace/db';

// Aluminum Siding Forensic Inspection Protocol (ASP) scorecard. This is a
// defensive, server-owned rendering model: it describes observed condition
// and product compatibility and intentionally never implies any manipulation.

export const ASP_CONDITION_CATEGORIES: Array<{ key: AspConditionKey; label: string }> = [
  { key: 'impactDeformation', label: 'Impact deformation' },
  { key: 'coatingBreach', label: 'Coating breach' },
  { key: 'substrateExposure', label: 'Substrate exposure' },
  { key: 'nailHemCondition', label: 'Nail-hem condition' },
  { key: 'interlockDisplacement', label: 'Interlock displacement' },
  { key: 'chalking', label: 'Chalking' },
  { key: 'finishVariance', label: 'Finish variance' },
  { key: 'priorRepair', label: 'Prior repair' },
  { key: 'coatingAdhesion', label: 'Coating adhesion' },
  { key: 'collateralSoftMetal', label: 'Collateral soft-metal condition' },
];

export interface AspScorecard {
  surveyedElevations: number;
  accessibleElevations: number;
  testSquares: number;
  documentedImpacts: number;
  lightingTechnique: string | null;
  diffuseOnly: boolean;
  deformationWithoutRakingPhoto: AspElevation[];
  affirmativeConditions: number;
  matchedCompatibilityCriteria: number;
  unmatchedCompatibilityCriteria: number;
  categories: Array<{ key: AspConditionKey; label: string; count: number }>;
}

export interface AspReportSection {
  scorecard: AspScorecard;
  referencePhotoId: string | null;
  rakingPhotoIds: string[];
  testSquarePhotoIds: string[];
  examplePhotos: Array<{ photoId: string; label: string; note: string | null }>;
  conclusion: string | null;
  conclusionBasis: string | null;
  compatibilityBasis: string | null;
}

export function extractAsp(assessment: unknown): AluminumSidingProtocol | null {
  if (!assessment || typeof assessment !== 'object') return null;
  const ra = assessment as Partial<StoredRepairabilityAssessment> & {
    version?: number;
    asp?: AluminumSidingProtocol | null;
  };
  const asp = ra.version === 3 ? (ra as RepairabilityAssessmentV3).asp : null;
  if (!asp || typeof asp !== 'object' || !Array.isArray(asp.elevations) || !Array.isArray(asp.testSquares)) {
    return null;
  }
  return asp;
}

const affirmativeElevationCount = (asp: AluminumSidingProtocol, key: AspConditionKey): number => {
  const finding = asp.findings?.[key];
  return finding?.answer === 'yes' && Array.isArray(finding.elevations)
    ? new Set(finding.elevations.filter(Boolean)).size
    : 0;
};

export function computeAspScorecard(asp: AluminumSidingProtocol): AspScorecard {
  const compatibility = Object.values(asp.compatibility ?? {});
  const impactFinding = asp.findings?.impactDeformation;
  const deformationWithoutRakingPhoto = (impactFinding?.answer === 'yes' ? asp.elevations : [])
    .filter((elevation) =>
      impactFinding?.elevations?.includes(elevation.elevation) && !elevation.rakingPhotoId,
    )
    .map((elevation) => elevation.elevation);
  return {
    surveyedElevations: asp.elevations.length,
    accessibleElevations: asp.elevations.filter((e) => e.accessible).length,
    testSquares: asp.testSquares.length,
    documentedImpacts: asp.testSquares.reduce(
      (sum, square) => sum + (Number.isInteger(square.impactCount) && square.impactCount >= 0 ? square.impactCount : 0),
      0,
    ),
    lightingTechnique: asp.assessmentConditions?.lightingTechnique ?? null,
    diffuseOnly: asp.assessmentConditions?.lightingTechnique === 'diffuse_only',
    deformationWithoutRakingPhoto,
    affirmativeConditions: ASP_CONDITION_CATEGORIES.filter((c) => asp.findings?.[c.key]?.answer === 'yes').length,
    matchedCompatibilityCriteria: compatibility.filter((v) => v === 'matched').length,
    unmatchedCompatibilityCriteria: compatibility.filter((v) => v === 'not_matched').length,
    categories: ASP_CONDITION_CATEGORIES.map((c) => ({
      ...c,
      count: affirmativeElevationCount(asp, c.key),
    })),
  };
}

export function buildAspReportSection(assessment: unknown): AspReportSection | null {
  const asp = extractAsp(assessment);
  if (!asp) return null;
  const used = new Set<string>();
  const add = (id: unknown): string | null =>
    typeof id === 'string' && id.length > 0 && !used.has(id) ? (used.add(id), id) : null;
  const referencePhotoId = add(asp.referencePhotoId);
  const rakingPhotoIds = asp.elevations.map((e) => add(e.rakingPhotoId)).filter((id): id is string => id !== null);
  const testSquarePhotoIds = asp.testSquares.map((s) => add(s.photoId)).filter((id): id is string => id !== null);
  const examplePhotos = ['impactDeformation', 'coatingBreach']
    .map((key) => ASP_CONDITION_CATEGORIES.find((c) => c.key === key)!)
    .map((category) => ({ category, finding: asp.findings?.[category.key] }))
    .filter(({ finding }) => finding?.answer === 'yes')
    .map(({ category, finding }) => {
      const photoId = add(finding?.photoId);
      return photoId ? { photoId, label: category.label, note: finding?.note ?? null } : null;
    })
    .filter((entry): entry is { photoId: string; label: string; note: string | null } => entry !== null)
    .slice(0, 2);
  return {
    scorecard: computeAspScorecard(asp),
    referencePhotoId,
    rakingPhotoIds,
    testSquarePhotoIds,
    examplePhotos,
    conclusion: asp.conclusion ?? null,
    conclusionBasis: asp.conclusionBasis ?? null,
    compatibilityBasis: asp.compatibilityBasis ?? null,
  };
}

export function aspScorecardBriefLines(scorecard: AspScorecard): string[] {
  const lines = [
    'Aluminum Siding Forensic Inspection Protocol (non-destructive) scorecard:',
    `  Elevations surveyed: ${scorecard.surveyedElevations}; accessible: ${scorecard.accessibleElevations}`,
    `  Test areas: ${scorecard.testSquares}; documented impacts: ${scorecard.documentedImpacts}`,
    `  Affirmative condition categories: ${scorecard.affirmativeConditions}`,
    `  Compatibility criteria: ${scorecard.matchedCompatibilityCriteria} matched; ${scorecard.unmatchedCompatibilityCriteria} not matched`,
    ...scorecard.categories.map((c) => `  ${c.label}: ${c.count} affected elevation(s)`),
  ];
  if (scorecard.lightingTechnique) {
    lines.push(`  Lighting technique: ${scorecard.lightingTechnique.replaceAll('_', ' ')}`);
  }
  if (scorecard.diffuseOnly) {
    lines.push(
      '  Diffuse-light qualifier: a negative deformation finding under diffuse light only does not establish that deformation is absent.',
    );
  }
  if (scorecard.testSquares > 0) {
    lines.push(
      '  Test-square scope: documented impact counts characterize only the counted 10 ft × 10 ft areas and are never extrapolated to the elevation or building.',
    );
  }
  if (scorecard.deformationWithoutRakingPhoto.length > 0) {
    lines.push(
      `  Missing raking-light frame: deformation was recorded on elevation(s) ${scorecard.deformationWithoutRakingPhoto.join(', ')} without a raking photo; the finding remains recorded, but the visibility gap must be disclosed.`,
    );
  }
  lines.push(
    '  Protocol limit: no manipulation was performed, so no finding is made about how a panel, nailing hem, or interlock would respond to manipulation.',
  );
  return lines;
}