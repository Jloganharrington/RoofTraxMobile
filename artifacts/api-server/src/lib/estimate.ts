// Estimate math for the advisory Estimate step. Pure functions only — the
// route owns authz/persistence. All money is integer cents.
import type { EstimateLineItem, InspectionEstimate } from '@workspace/db';

// ---------------------------------------------------------------------------
// Measured basis + waste math
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Shingle bundles cover 1/3 square, so the waste-adjusted figure rounds UP
 *  to the next third of a square (then to 2 decimals for storage/display) —
 *  partial bundles are still bought whole. Epsilon guards float noise so an
 *  exact multiple of 1/3 doesn't get bumped a full bundle. */
const roundUpToThirdSquare = (n: number) => round2(Math.ceil(n * 3 - 1e-9) / 3);

/** Roofing squares (1 square = 100 sqft) from summed slope areas, plus the
 *  waste-adjusted figure. Null areas mean "no measured basis" (manual entry
 *  still allowed); zero-area slopes count as measured. */
export function computeMeasuredBasis(input: {
  slopeAreasSqft: Array<number | null | undefined>;
  damagedSidingFacetCount: number;
  wastePercent: number;
}): InspectionEstimate['measuredBasis'] {
  const measured = input.slopeAreasSqft.filter(
    (a): a is number => typeof a === 'number' && isFinite(a) && a >= 0,
  );
  if (measured.length === 0) {
    return {
      roofAreaSqft: null,
      roofSquares: null,
      wasteAdjustedSquares: null,
      damagedSidingFacetCount: input.damagedSidingFacetCount,
    };
  }
  const roofAreaSqft = round2(measured.reduce((sum, a) => sum + a, 0));
  const roofSquares = round2(roofAreaSqft / 100);
  const wasteAdjustedSquares = roundUpToThirdSquare(roofSquares * (1 + input.wastePercent / 100));
  return {
    roofAreaSqft,
    roofSquares,
    wasteAdjustedSquares,
    damagedSidingFacetCount: input.damagedSidingFacetCount,
  };
}

// ---------------------------------------------------------------------------
// Line totals — server-recomputed; the client's math is never trusted.
// ---------------------------------------------------------------------------

export interface EstimateLineInput {
  priceBookItemId: string | null;
  description: string;
  unit: string | null;
  quantity: number;
  unitPriceCents: number;
  isAdder: boolean;
}

export function computeLines(lines: EstimateLineInput[]): {
  lines: EstimateLineItem[];
  subtotalCents: number;
} {
  const computed = lines.map((line) => ({
    ...line,
    totalCents: Math.round(line.quantity * line.unitPriceCents),
  }));
  return {
    lines: computed,
    subtotalCents: computed.reduce((sum, l) => sum + l.totalCents, 0),
  };
}
