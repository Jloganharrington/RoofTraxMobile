// Estimate math + Brain payload mapping for the advisory Estimate step.
// Pure functions only — the route owns authz/persistence, brainCourier owns
// payload assembly. All money is integer cents until the Brain payload,
// where values become pre-formatted currency strings (the proof-package
// template renders strings verbatim).
import type { EstimateLineItem, InspectionEstimate } from '@workspace/db';

// ---------------------------------------------------------------------------
// Measured basis + waste math
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

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
  const wasteAdjustedSquares = round2(roofSquares * (1 + input.wastePercent / 100));
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

// ---------------------------------------------------------------------------
// Brain payload mapping (REPORT_DATA.contractorEstimate / .priceBook shapes)
// ---------------------------------------------------------------------------

export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Trim trailing zeros so 12.00 renders "12" but 12.33 stays "12.33". */
function formatQuantity(quantity: number): string {
  return String(round2(quantity));
}

/** Template shape: {lines:[{description,quantity,unitPrice,total,isAdder}],
 *  subtotal, note} — all currency pre-formatted strings. Null when no
 *  estimate was saved (back-compat: the section then omits). */
export function contractorEstimateForPayload(estimate: InspectionEstimate | null | undefined) {
  if (!estimate || estimate.lines.length === 0) return null;
  return {
    lines: estimate.lines.map((line) => ({
      description: line.unit ? `${line.description} (${line.unit})` : line.description,
      quantity: formatQuantity(line.quantity),
      unitPrice: formatCents(line.unitPriceCents),
      total: formatCents(line.totalCents),
      isAdder: line.isAdder,
    })),
    subtotal: formatCents(estimate.subtotalCents),
    note: buildEstimateNote(estimate),
  };
}

function buildEstimateNote(estimate: InspectionEstimate): string | null {
  const parts: string[] = [];
  const basis = estimate.measuredBasis;
  if (basis.roofSquares != null && basis.wasteAdjustedSquares != null) {
    parts.push(
      `Measured roof area ${basis.roofAreaSqft} sq ft (${basis.roofSquares} squares); ` +
        `${estimate.wastePercent}% waste factor applied for ${basis.wasteAdjustedSquares} billable squares.`,
    );
  } else if (estimate.wastePercent > 0) {
    parts.push(`${estimate.wastePercent}% waste factor applied.`);
  }
  if (estimate.note) parts.push(estimate.note);
  return parts.length ? parts.join(' ') : null;
}

/** Template shape: {version, publishedAt, packages:[{name, items:[{name,
 *  description, unit, unitPrice}]}], note}. Standalone items (not assigned to
 *  any package) render under a catch-all group. Null when the company has no
 *  price book at all (the template then falls back to the exhibit divider). */
export function priceBookSnapshotForPayload(input: {
  items: Array<{
    id: string;
    name: string;
    description: string | null;
    unit: string | null;
    unitPrice: number;
    updatedAt: Date;
  }>;
  packages: Array<{ name: string; itemIds: string[] }>;
}) {
  if (input.items.length === 0) return null;
  const itemById = new Map(input.items.map((i) => [i.id, i]));
  const mapItem = (item: (typeof input.items)[number]) => ({
    name: item.name,
    description: item.description,
    unit: item.unit,
    unitPrice: formatCents(item.unitPrice),
  });

  const assigned = new Set<string>();
  const packages = input.packages
    .map((pkg) => {
      const items = pkg.itemIds
        .map((id) => itemById.get(id))
        .filter((i): i is NonNullable<typeof i> => Boolean(i))
        .map((i) => {
          assigned.add(i.id);
          return mapItem(i);
        });
      return { name: pkg.name, items };
    })
    .filter((pkg) => pkg.items.length > 0);

  const standalone = input.items.filter((i) => !assigned.has(i.id));
  if (standalone.length > 0) {
    packages.push({
      name: packages.length > 0 ? 'Additional Line Items' : 'Line Items',
      items: standalone.map(mapItem),
    });
  }
  if (packages.length === 0) return null;

  const latest = input.items.reduce<Date | null>(
    (max, i) => (max == null || i.updatedAt > max ? i.updatedAt : max),
    null,
  );
  return {
    version: null as string | null, // price book is not versioned yet
    publishedAt: latest ? latest.toISOString().slice(0, 10) : null,
    packages,
    note: null as string | null,
  };
}
