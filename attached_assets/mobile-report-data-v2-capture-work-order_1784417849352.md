# Work Order — Field Capture for REPORT_DATA v2 (Phase 2 Proof Package)

**Repo:** RoofTraxMobile · **Who builds:** Replit (mobile + api-server + contract)
**Driver:** `phase2-proof-package-structure-map.pdf` §3 — the `REPORT_DATA` v2 data contract.
**Division of labor:** a separate track owns the HTML report template/renderer. This order
covers **only the field capture the app must produce** so that contract can be populated.
Brain-side assembly of `REPORT_DATA` is Claude's.

**Governing principle from the spec:** *"Nothing in the template should require hand-editing
per report — every conditional, every exhibit, every piece of content comes from this data
shape."* If the app doesn't capture it, the report cannot render it. Every item below is a
field the renderer expects and the app currently does not emit.

---

## 0. Prerequisite — a 4th damage flag (structural, do this first)

The app has three: `roofDamageFound`, `sidingDamageFound`, `collateralDamageFound`
(`lib/db/src/schema/inspections.ts:318-320`). The contract requires **four**:

```js
areasImpacted: { roof, siding, interior, collateral }   // each { impacted: boolean }
```

`interior` gates §4 photos, §9 code citations, §11 scope, and the §3 narrative — an
all-or-nothing area toggle exactly like the other three.

**Add `interiorDamageFound`** as a fourth toggle in the Elevation Walk alongside the
existing three. Do **not** derive it from `interiorObservations.length > 0` — deriving it
loses the inspector's explicit "interior is part of this claim" judgment, and the renderer
treats this as a claim-scope decision, not a byproduct.

Knock-on: the Interior/Attic step becomes conditional on it (currently always-applies), and
the submit gate's "≥1 damage flag" rule now counts four.

---

## 1. Property Profile — new step *(net-new: `propertySummary` + `constructionDescription`)*

The contract needs a property/construction description block. **None of these fields exist
today** (verified against the schema). Recommend a new early step, **"Property Profile,"**
placed after Arrival Log — it is data-entry, no photos, and the rep is standing at the house.

Prefill from the CRM lead record where available; the rep confirms rather than retypes.

**`propertySummary`:**
- `propertyType` — single-family / townhome / condo / multi-family / commercial
- `stories` — 1 / 1.5 / 2 / 2.5 / 3+
- `roofType` — picker
- **`roofAgeYears`** — numeric, plus a **basis** field (homeowner-reported / permit record /
  product date code / estimated). The basis matters: roof age drives every depreciation and
  ACV argument, and an unsourced number is attackable.
- `roofSlopeCount` — **derive** from the facet count, don't ask twice
- `accessibilityNotes` — free text
- `temporaryRepairsCompleted` — **derive** from §4 below
- `projectStatus` — office/CRM-owned, not field capture

**`constructionDescription`:**
- `buildingType`, `attachedOrDetached`
- `roofCovering` — derive from slope material / product ID
- `roofGeometry` — gable / hip / mansard / gambrel / flat / complex (multi-select)
- **`deckType`** — plywood / OSB / plank / skip-sheathing / unknown. Observed from the attic;
  also feeds §16 (concealed conditions / sheathing), so it earns its place.
- `framingConditionNotes` — attic observation
- `flashingsAndPenetrations` — derive from existing components/penetrations
- `interiorAreasInspected` — derive from `interiorObservations` locations

Only the non-derived fields need UI. Derive everything marked *derive* rather than asking
the rep for data the app already holds.

## 2. Repairability Assessment — new conditional step *(net-new)*

**This is the highest-priority item in this order.** The proof package currently renders an
AI-authored repairability narrative with no underlying field determination; the contract
requires `repairabilityAssessment != null` as the trigger and states *"never fabricated as
a default."* Repairability is the crux of nearly every replace-vs-repair dispute and the
section a carrier's expert attacks hardest.

New step, shown when `roofDamageFound` (or siding). **Must be explicitly performed — never
defaulted, never auto-populated.** If the inspector doesn't complete it, the object stays
null and the section omits.

Capture, matching the contract field-for-field:
- `questionPresented` — prefilled standard phrasing, editable
- `methodology` — what was done to assess
- `materialsReviewed` — product/matching material examined
- `fieldTestFindings` — **the actual test**: was a repair attempt made, did adjacent shingles
  fracture (brittleness), could matching material be sourced, is the product discontinued
- `conditionScoring`
- `repairAttemptRisks`
- `determination` — repairable / not repairable *(required)*
- `recommendation`
- `assessorName`, `assessorCredentials` — **from the inspector profile (§6)**, not typed
- `supportingPhotoIds[]` — photos captured during the assessment

## 3. Existing / Unrelated Conditions — new capture *(net-new)*

`existingOrUnrelatedConditions: [{ location, note }]` — pre-existing or non-storm damage the
inspector observed and is **explicitly excluding** from the claim.

Small step placed before Declaration: the inspector reviews and records anything not
attributable to the storm.

Worth understanding *why* this is in the contract: voluntarily documenting what **is not**
storm damage is what makes the rest of the report credible. It is a credibility asset, not a
concession — a report that claims everything is storm damage reads as advocacy. Present it
to the rep that way in the UI copy, or it will get skipped.

## 4. Temporary Repairs & Mitigation — **Phase 1 AND Phase 2** *(net-new)*

`temporaryRepairs: null | { performed, tarpInvoiceRef, description, datePerformed,
materialsUsed, crewAndEquipment, beforeAfterPhotoIds[] }`

`performed` must be **explicitly true** — never inferred.

**This is the one item that must also exist in the Phase 1 preliminary flow.** Emergency
tarping most often happens at the *first* visit, when a rep finds an active leak. Phase-2-only
capture misses the common case entirely. Capture in Phase 1, carry forward into Phase 2 (the
inspection is one record advancing phases, so it persists naturally).

Before/after photos are the point of this section — make them prominent, not optional-looking.

## 5. Property-Protection Plan — new conditional capture *(net-new)*

`propertyProtectionPlan: null | { specializedRequired, featureProtected,
whyOrdinaryTarpingInsufficient, proposedEquipment, setupMethod, laborEstimate, rentalCost,
photoIds[] }`

The spec is emphatic: `specializedRequired` must be an **explicit flag, "not inferred from
'any protection exists'"** — this is for scaffold/specialized cases, *not* ordinary tarping.
Build the UI so the default is off and the rep must affirmatively flag it.

**Field captures the observation; the office fills the money.** `laborEstimate` and
`rentalCost` are estimate-stage data — leave them out of the app and let the CRM/Brain
populate them. Field capture:
- `specializedRequired` toggle (default off)
- `featureProtected` — pool/spa, solar panels, skylights, HVAC, satellite, specimen
  landscaping, detached structure, driveway/hardscape, septic field
- `whyOrdinaryTarpingInsufficient` — required when flagged
- `photoIds[]`

**Natural home: the Elevation Walk** — the rep is already circling the structure.

## 6. Inspector credential profile *(net-new, profile-level not per-inspection)*

The submission carries `inspector: { name, licenseNumber }` only. The contract needs
`assessorCredentials` (§2), and a forensic opinion's weight attaches to the individual, not
the company.

Add to the inspector profile: `certifications[]` (name, issuing body, number, expiry),
`yearsExperience`. Surface into the submission. Company-level credentials already live in
the Brain's company pack — this is the missing *individual* layer.

## 7. Photo `captureContext` — extend, don't rebuild

Contract wants `photos[].captureContext: overview | mid-range | close-up | measurement |
collateral`.

The app **already has** `PHOTO_TRIAD_ROLES = ['wide','mid','close']`
(`schema/inspections.ts:170`), enforced during forensic triad capture. That's a direct
3-of-5 map:

```
wide -> overview     mid -> mid-range     close -> close-up
```

**Add `measurement` and `collateral` to the enum.** Do not build a new tagging system.

Note Phase 1 photos use `preliminaryRole` and leave `triadRole` null (mutually exclusive,
per the schema comment at line 481) — the mapping must handle both, and Phase 1 roles need
their own mapping to `captureContext`.

## 8. Not in this order

- **Photo masters / unaltered originals** — separate spec,
  `evidence-master-derivative-architecture.md`. Feeds §20 Digital Documentation Index.
- **Submission contract v1 → v2** — Claude's, Brain-side. Note the app already emits
  `slopes[].areaSqft`, `damageType`, damage flags, siding facets, arrival block, and tie-in
  selections that the contract does not yet carry; that catch-up is a prerequisite on the
  Brain side and is being handled there.
- Report template/renderer — separate track.
- `laborEstimate` / `rentalCost` / `projectStatus` — office-side.

## 9. Verification

1. Four damage flags present; Interior/Attic step now conditional on the fourth; submit gate
   counts all four; setting only `interior` produces a valid submittable inspection.
2. Property Profile persists; derived fields (`roofSlopeCount`, `roofCovering`,
   `interiorAreasInspected`) populate without re-asking the rep.
3. `roofAgeYears` requires a basis selection.
4. Repairability: step is skippable and leaves the record **null**; when completed, all
   required fields present and `assessorCredentials` populated from the profile.
5. Temporary repairs captured in **Phase 1**, still present after advancing to Phase 2.
6. Property protection defaults to off; `whyOrdinaryTarpingInsufficient` required when flagged.
7. Existing/unrelated conditions save and survive submission.
8. `captureContext` emitted for every photo, both forensic (`triadRole`) and Phase 1
   (`preliminaryRole`) paths.
9. Inspector certifications appear in the submission payload.
10. Gate parity green across all three builders; workspace typecheck clean.
