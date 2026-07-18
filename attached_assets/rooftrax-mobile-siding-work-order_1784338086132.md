# Work Order — Siding Inspection + Conditional Damage Branches (protocol v2.1)

**Repo:** RoofTraxMobile · **Who builds:** Replit (mobile + gate). Brain-side (conditional
package + siding exhibit/estimate) is Claude's, after this lands.
**Spec:** `rooftrax-mobile-protocol-v2.md` (v2.1 section). All 5 forks confirmed there.

**Goal:** make the forensic flow **branch on three "damage found" flags** so it handles
roof-only, siding-only, or combined claims, and add a **Siding Inspection** module. Also:
drop the "Step N" number prefixes (named steps only).

> Build faithfully as a working skeleton; Logan tweaks on-device.

---

## 1. Elevation Walk (was "Elevation Walk & Access")
- **Rename** the step to **Elevation Walk** (key stays `elevation_access`, or rename to
  `elevation` — your call, just keep it consistent across the 3 gate builders + contract).
- **Remove the roof-access photo** entirely (capture + gate rule).
- **Add three boolean toggles**, stored on the inspection: **Roof Damage Found**,
  **Siding Damage Found**, **Collateral Damage Found** (`roof_damage_found`,
  `siding_damage_found`, `collateral_damage_found`, default false).

## 2. Conditional steps (the core new mechanic)
`PROTOCOL_STEPS` gains an **`appliesWhen(flags)`** predicate. Show + gate a step only when
its flag is set. The submit gate aggregates **only applicable** steps.

| Step (named, no "Step N") | key | applies when |
|---|---|---|
| Arrival Log | `arrival` | always |
| Elevation Walk | `elevation_access` | always |
| **Roof Facets & Measurements** | `facets` | `roofDamageFound` |
| Test Squares | `test_squares` | `roofDamageFound` |
| **Roof Components & Penetrations** | `components` | `roofDamageFound` |
| **Roofing Product ID** | `product` | `roofDamageFound` |
| **Siding Inspection** | `siding` (new) | `sidingDamageFound` |
| Collateral Sweep | `collateral` | `collateralDamageFound` |
| Interior / Attic | `interior` | always |
| Homeowner | `homeowner` | always |
| Declaration | `declaration` | always |
| Readiness & Submit | `submit` | always |

- **Renames:** add "Roof"/"Roofing" to the three labels above. **Remove the "Step N ·"
  prefix from every step** — labels are the names only.
- **Order:** exactly the table order (roof group together, Roofing Product ID moved up into
  it, Collateral after Siding).
- **Submit rule:** **≥1 of the three damage flags must be set** to submit
  (`NO_DAMAGE_SURFACE_SELECTED` deficiency on `submit` otherwise).

## 3. Siding Inspection (new module)
New screen + gate step `siding`, shown only when `sidingDamageFound`.

- **Facet count via a +/− counter** (− removes the *last* facet added). Facets labeled
  **`S1, S2, S3…`** (distinct from roof `F1…`).
- **Per siding facet:** **Damaged?** Y/N → if Y: **Damage type** (`wind` / `hail` / `tree`)
  + **Photo of Damage** → **Photo of Facet** (always) → **# of Components** → **photo of
  each component**. **No area / pitch / material** (quantities come from the measurement
  report — §4).
- Photos: new `subjectType: 'siding_facet'`, captions `S{n} Damage`, `S{n} Facet`,
  `S{n} Component {k}`.
- **Gate (`siding`):** ≥1 siding facet; each facet has a facet photo; each *damaged* facet
  has a type + ≥1 damage photo; each component has a photo.

### Schema (new table)
`inspection_siding_facets`: `id, companyId, inspectionId, label ('S{n}'), damaged boolean,
damageType varchar enum(wind|hail|tree) null, createdAt`. Components as either a child
table `inspection_siding_components (id, sidingFacetId, index, notes)` with photos by
`subjectId`, or a simple `componentCount int` + photos captioned per component — your call,
keep it simple. `db:push`.

## 4. Measurement Report upload (siding quantities)
Siding **feeds the estimate**, but area comes from an uploaded **Measurement Report**
(EagleView/Hover-style PDF), not in-app measurement.
- Add a **document upload** (PDF/image) for the siding measurement report → object storage,
  referenced on the inspection (`siding_measurement_report_ref`), emitted in the contract.
- **Not required to submit** the inspection (reports are often ordered post-inspection) —
  soft-flag if missing. The Brain's siding **estimate** is what requires it.
- **OPEN (confirm with Logan):** does this upload live here in the app's Siding step, or in
  the office/CRM/Brain at estimate time? If office-side, drop it from this order and it
  becomes a CRM/Brain task. Default: include a lightweight optional upload here.

## 5. Contract (Brain side handled by Claude)
Emit for the Brain to consume:
- `elevationDamage { roof, siding, collateral }` booleans.
- `sidingFacets[]` (label, damaged, damageType, + component refs).
- `sidingMeasurementReportRef` (nullable).
- Photo `stage` = `siding`; captions as above.
Regenerate OpenAPI/zod/client. Don't rename existing roof `subjectType`s.

## 6. Verification
1. Set only Roof Damage Found → only roof steps appear; siding/collateral hidden.
2. Set only Siding → only Siding Inspection appears; roof steps hidden; submit still gates.
3. Set none → submit blocked (`NO_DAMAGE_SURFACE_SELECTED`).
4. Siding: +/− counter adds/removes S{n}; damaged facet requires type+photo; components photo'd.
5. Roof-access photo gone; three toggles persist; renamed labels; no "Step N" anywhere.
6. Gate parity test green across the 3 builders. Workspace typecheck clean.

## 7. Out of scope
- The siding **estimate/scope math** (Brain, future — depends on measurement-report format).
- The Siding **exhibit** in the proof package (Claude, Brain-side).
- Phase-1 preliminary, storm, canvassing, CRM.
