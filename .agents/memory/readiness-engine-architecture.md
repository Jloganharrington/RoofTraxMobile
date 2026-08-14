---
name: Readiness Engine Architecture
description: Three-layer readiness contract after the Step-1/2/3/4/5 refactor — what each layer owns, how they connect, and where to look when adding new checks.
---

## Three distinct layers

| Layer | Location | Owns |
|---|---|---|
| Field-evidence evaluation | `lib/protocol/src/rules.ts` via `evaluateServerInspection()` in `api-server/src/lib/inspectionProtocolState.ts` | Protocol deficiencies with `resolution: 'capture_in_app' | 'upload' | 'unavailable'`; soft flags |
| Submission-layer readiness | `api-server/src/lib/readiness.ts` → `computeReadiness()` | 9 hard claim-readiness items (attestation, forensic findings, product ID, RAP record, estimate, trigger flags, company settings, AHJ pack, standards) |
| Content-quality lint | `api-server/src/lib/lintReportFragments.ts` | Section-level content quality — deliberately separate, never merged |

## Contract between layers

`computeReadiness()` takes `evaluationResult: EvaluationResult` (output of `evaluateServerInspection()`) as input — it never re-queries the DB for product or test-square existence. This eliminates the two historical Conflicts:

- **Conflict A (product):** `products.length === 0` check replaced with `evaluationResult.deficiencies.some(d => d.code === 'NO_PRODUCT_RECORD')`. When the deficiency is absent AND products array is empty, the protocol step does not apply → readiness passes.
- **Conflict B (test squares):** `testSquaresCount > 0` replaced with `!evaluationResult.deficiencies.some(d => d.code.startsWith('MISSING_TEST_SQUARE_'))`. Gate reason logic is unchanged.

## Unified readiness endpoint

`GET /inspections/:inspectionId/readiness` now returns:

```json
{
  "inspectionId": "...",
  "overallPass": true,       // protocol clean AND submission passes
  "can_generate": true,      // submission passes (compile-gate check)
  "variant": "standard",     // or "upload_path" when any capture_in_app deficiency remains
  "protocol": {
    "deficiencies": [...],
    "softFlags": [...],
    "applicable_steps": [...]
  },
  "submission": {
    "overallPass": true,
    "items": [...]
  }
}
```

Old flat response shape is gone. Old `POST /inspections/:id/preflight` is still live but logs a deprecation warning — migrate callers.

## compile gate

`POST /inspections/:id/report/compile` now:
1. Fetches `hydrateInspectionChildren` once (no second call later in the handler)
2. Calls `evaluateServerInspection()` with the children
3. Passes result to `computeReadiness()`
4. Gates on `readinessResult.overallPass`

Previously it did its own parallel fetches (products, testSquares, attests, damageInstances, slopes separately) and passed `testSquaresCount`.

## Resolution vocabulary

Every `deficiency()` call in rules.ts carries a 4th arg:
- `capture_in_app` — arrival conditions, test squares, product ID, declaration, final-review confirm
- `upload` — elevation photos, facet data, damage records/photos, components, siding facets, measurements
- `unavailable` — reserved for future use (nothing maps to it yet)

`variant: 'upload_path'` when any `capture_in_app` deficiency remains; `variant: 'standard'` when clean.

## pp.ts readiness route

`pp.ts` builds a **synthetic** `EvaluationResult` from the data it already fetches (products, testSquares arrays) rather than calling `evaluateServerInspection()` (which needs all children). The synthetic result emits `NO_PRODUCT_RECORD` when products are empty and `MISSING_TEST_SQUARE_pp` when testSquares are empty AND roofDamageFound. This preserves the old gate behavior without pulling photos/elevations/components.

**Why:** PP inspections are upload-path; the full hydrate would fetch many rows that don't exist, and the pp.ts route doesn't have access to `hydrateInspectionChildren` (it's local to inspections.ts).

## Test coverage

- `lib/protocol/src/__tests__/rules.test.ts` — 53 tests, all `toMatchObject` tolerating the new `resolution` field
- `api-server/src/lib/__tests__/readiness.test.ts` — 25 tests: baseline pass, Conflict A, Conflict B, resolution partitioning, applicableSteps routing, variant derivation
