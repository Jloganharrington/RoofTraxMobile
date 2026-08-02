/**
 * Thin in-memory store that holds the roof diagram signed URL (and the PDF
 * page it was rendered from) per inspection.  Written as soon as the AI
 * parse response lands (even before the inspector taps Apply), so the URL
 * remains accessible in Facet Details after `pendingMeasurements` is
 * cleared.  The page sticks too, so once the inspector flips to the right
 * page for a non-EagleView report, every screen shows that page.
 *
 * Signed URLs are valid for 3 hours — long enough for a field session.
 * If the URL has expired, the Image component will simply fail to load;
 * the inspector can re-run AI analysis to get a fresh one.
 */

export type OverviewEntry = { url: string; page: number };

const store = new Map<string, OverviewEntry>();

export function setOverviewImage(inspectionId: string, url: string, page: number): void {
  store.set(inspectionId, { url, page });
}

export function getOverviewImage(inspectionId: string): OverviewEntry | null {
  return store.get(inspectionId) ?? null;
}

/** Called when the measurements report is replaced — the cached diagram
 *  belongs to the old PDF. */
export function clearOverviewImage(inspectionId: string): void {
  store.delete(inspectionId);
}
