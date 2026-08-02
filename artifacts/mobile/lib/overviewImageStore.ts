/**
 * In-memory store for measurement report page images rendered from the
 * measurements PDF during AI analysis.  Holds all pages per inspection so
 * mobile can flip between them without further API calls.
 *
 * Signed URLs are valid for 3 hours.  When the store is cold (app restart or
 * URLs expired) the mobile screens call GET /inspections/:id/measurement-pages
 * to get fresh signed URLs.
 *
 * Cleared when the measurements report PDF is replaced.
 */

export type MeasurementPage = { page: number; url: string };

interface OverviewState {
  pages: MeasurementPage[]; // sorted ascending by page number
  currentPage: number;
}

const store = new Map<string, OverviewState>();

/** Replace all stored pages for an inspection and set the active page. */
export function setMeasurementPages(
  inspectionId: string,
  pages: MeasurementPage[],
  currentPage = 0,
): void {
  const sorted = [...pages].sort((a, b) => a.page - b.page);
  store.set(inspectionId, { pages: sorted, currentPage });
}

/** Return all stored pages for an inspection (sorted by page number). */
export function getMeasurementPages(inspectionId: string): MeasurementPage[] {
  return store.get(inspectionId)?.pages ?? [];
}

/** Return the signed URL for a specific page, or null if not cached. */
export function getMeasurementPageUrl(inspectionId: string, page: number): string | null {
  const entry = store.get(inspectionId);
  if (!entry) return null;
  return entry.pages.find((p) => p.page === page)?.url ?? null;
}

/** Return the currently active page number (defaults to 0). */
export function getCurrentPage(inspectionId: string): number {
  return store.get(inspectionId)?.currentPage ?? 0;
}

/** Update which page is displayed without replacing the page list. */
export function setCurrentPage(inspectionId: string, page: number): void {
  const entry = store.get(inspectionId);
  if (entry) store.set(inspectionId, { ...entry, currentPage: page });
}

/** Add or update a single page entry (used by the fallback render-overview-image path). */
export function addMeasurementPage(inspectionId: string, page: number, url: string): void {
  const entry = store.get(inspectionId);
  if (entry) {
    const existing = entry.pages.find((p) => p.page === page);
    if (existing) { existing.url = url; }
    else { entry.pages.push({ page, url }); entry.pages.sort((a, b) => a.page - b.page); }
    store.set(inspectionId, { ...entry, currentPage: page });
  } else {
    store.set(inspectionId, { pages: [{ page, url }], currentPage: page });
  }
}

/** Remove cached pages for an inspection (call when the PDF is replaced). */
export function clearMeasurementPages(inspectionId: string): void {
  store.delete(inspectionId);
}
