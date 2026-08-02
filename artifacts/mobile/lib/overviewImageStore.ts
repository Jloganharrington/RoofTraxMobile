/**
 * Thin in-memory store that holds the roof diagram signed URL per
 * inspection.  Written as soon as the AI parse response lands (even before
 * the inspector taps Apply), so the URL remains accessible in Facet Details
 * after `pendingMeasurements` is cleared.
 *
 * Signed URLs are valid for 3 hours — long enough for a field session.
 * If the URL has expired, the Image component will simply fail to load;
 * the inspector can re-run AI analysis to get a fresh one.
 */

const store = new Map<string, string>();

export function setOverviewImageUrl(inspectionId: string, url: string): void {
  store.set(inspectionId, url);
}

export function getOverviewImageUrl(inspectionId: string): string | null {
  return store.get(inspectionId) ?? null;
}
