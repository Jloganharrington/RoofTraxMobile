---
name: Facet inventory single-stage AI flow
description: Replaced two-stage EXTRACT→SEQUENCE routing with single-stage facet inventory extraction. Covers server helpers, DB schema, mobile confirm screen, and prompt loading.
---

## Rule
Facet analysis is single-stage: one document-bearing AI call per PDF, extract count/areas/pitches only. No routing, adjacency, or walking order. The inspector decides walking order on the roof.

**Why:** The two-stage EXTRACT→SEQUENCE flow was scrapped because the AI couldn't reliably differentiate roof levels, orientation, and walking order across diverse report formats.

## How to apply

### Server (`artifacts/api-server/src/routes/inspections.ts`)
- `runFacetInventory(pdfBase64, req)` calls claude-opus-4-8, max_tokens 4000, system=facet-extractor.md prompt, one retry on validation failure, second failure throws.
- Model name is `claude-opus-4-8`; if that errors at runtime, fall back to `claude-opus-4-7`.
- Prompt file: `artifacts/api-server/prompts/facet-extractor.md` — loaded lazily via `getFacetExtractorPrompt()` with cwd-relative + repo-root fallback.
- On success: delete-and-reinsert `roof_facets` rows for that inspectionId, update inspection row (`facetInventory`, `facetCount`, `facetInventoryStatus = 'complete'`).
- On failure: set `facetInventoryStatus = 'failed'`; do NOT fail the analyze response — fallback to manual slope ordering.
- Response shape: `{ parsed, facetInventoryStatus, facetInventory }`.

### DB schema (`lib/db/src/schema/inspections.ts`)
- `inspectionsTable`: `facetInventory` (jsonb), `facetCount` (integer), `facetInventoryStatus` (text). Old 5 routing columns dropped.
- `roofFacetsTable`: id, inspectionId, facetId, areaSqFt, pitch, sortOrder — delete-and-reinsert on every re-analysis.

### Protocol types (`lib/protocol/src/measurements.ts`)
- Exports: `FacetInventoryStatus`, `RoofFacet`, `FacetInventoryItem`, `FacetInventory`.
- Old routing types (`FacetWalkability`, `FacetEdgeType`, `FacetGraphFacet/Edge`, `FacetGraph`, `FacetSequenceStep`, `FacetSequence`, `FacetGraphStatus`, `FacetRoutingState`) removed.

### Mobile pending store (`artifacts/mobile/lib/pendingMeasurements.ts`)
- `PendingMeasurementsData extends ParsedMeasurements` adds `facetInventory?` and `facetInventoryStatus?`.
- `setPendingMeasurements({ ...data.parsed, facetInventory, facetInventoryStatus })` in the hub screen.

### Mobile confirm screen (`artifacts/mobile/app/inspection-measurements-confirm.tsx`)
- `inventoryComplete = status === 'complete' && facetCount > 0` drives all branching.
- Inventory card shows facet list, total area, predominant pitch, excluded footnote, dismissible warning chips, Re-analyze button.
- Manual fallback (State A) shown when `!inventoryComplete && slopes.length > 0`.
- Apply payload: when inventory complete, build slopes from `pending.facetInventory.facets` (F1…Fn area-descending); otherwise use manual tap order.
- Re-analyze calls `POST /inspections/:id/analyze-measurements` again; updates pending in place.

### Mobile hub screen (`artifacts/mobile/app/inspection/[id].tsx`)
- Imports `FacetInventory`, `FacetInventoryStatus` from `@workspace/protocol`.
- Spreads `facetInventory` + `facetInventoryStatus` from analyze response into `setPendingMeasurements`.

### Facet screen (`artifacts/mobile/app/inspection-facet.tsx`)
- `routeNote` state and fetch useEffect removed; transition note banner removed.
