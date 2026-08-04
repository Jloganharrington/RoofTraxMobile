---
name: AHJ Wizard — materialApplicability item dimension
description: How material applicability is stored, validated, and surfaced for AHJ candidate items (v1.1+)
---

## The rule

`materialApplicability` is a **jsonb array** on `ahj_candidate_items` (default `["all"]`).
`needsMaterialReview` is a **boolean** (default `false`). Set to `true` by the route when the extraction returns `["all"]` for a material-sensitive category.

## Material-sensitive categories (single source of truth)

Defined in `artifacts/api-server/src/lib/ahjWizard.ts` as `MATERIAL_SENSITIVE_CATEGORIES`:
```
underlayment, ice_water_shield, valley_construction, ridge_hip
```
The route imports this constant — never duplicate the list.

## Prompt version

Bumped to `1.1`. RULE 7 in `buildExtractionPrompt` instructs the AI to walk every material subsection and tag each item specifically for material-sensitive categories.

## PATCH gate

When `item.needsMaterialReview === true`, the PATCH `/ahj-wizard/items/:id` route (verify/edit_verify) **rejects 422** unless `materialApplicability` is explicitly provided in the body. Providing it clears `needsMaterialReview`.

## Virginia golden-set eval

`scoreVirginiaGoldenSet` now accepts `materialApplicability?: string[]` on each candidate. Material canary check:
1. If all candidates tag `["all"]` → fails
2. Items marked `isMaterialCanary: true` in the fixture must have a non-`["all"]` matched candidate

Golden-set fixture adds VA-013 (R905.7 wood shingle) and VA-014 (R905.8 cedar shake) as material canaries. VA-004 (R905.2.1) and VA-007 (R905.2.8.2) also marked as material canaries.

## UI

- `CandidateItem` interface carries `materialApplicability: string[]` and `needsMaterialReview: boolean`
- List card: shows "⚠ mat. review" badge or material code chips (max 2, non-"all" only)
- Drawer: toggle-chip editor when `editMode || needsMaterialReview`; always sends `materialApplicability` in PATCH payload

**Why:** Material-specific provisions (R905.2 asphalt vs R905.7 wood vs R905.8 shake) must not be merged into a single "all materials" provision in the assembled pack — contractors installing cedar shakes should not be handed asphalt-shingle-specific underlayment requirements.
