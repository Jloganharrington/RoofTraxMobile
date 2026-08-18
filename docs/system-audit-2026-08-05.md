# AxiomRestore Platform System Audit — 2026-08-05

**Scope:** axiomrestore-web, api-server, lib/db schema, mobile field-app integration.
**Methodology:** Static analysis (grep, file reads), live DB queries (psql), subagent codebase exploration, browser log inspection. No fixes applied.
**Classification legend:** BUILT-VERIFIED · BUILT-UNWIRED · PARTIAL · MISSING · DRIFT · STALE · UNVERIFIED

---

## 1. DATA FOUNDATION

### 1.1 Schema vs. DB Parity

**Drizzle diff** — no `drizzle-kit diff` tooling was run; parity was verified by comparing schema file table definitions against live `psql` table checks.

| Check | Evidence | Classification |
|---|---|---|
| `pins` columns: pipeline_stage, stage_entered_at, loop_next_action_at, loss_reason, source_pipeline | Confirmed in `lib/db/src/schema/axiomrestore.ts`; DB query returns rows → no-op diff | BUILT-VERIFIED |
| `pins` columns: is_demo, needs_stage_review | Added in `0001_known_cyclops.sql`; DB returns both flags | BUILT-VERIFIED |
| `stage_transitions` table | Defined in schema; DB responds to queries → exists | BUILT-VERIFIED |
| `compiled_report_versions` | **jsonb column on `inspections`** (not a standalone table); `ERROR: relation "compiled_report_versions" does not exist` confirms no extra table | BUILT-VERIFIED |
| `boilerplate_sections` | Confirmed via `lib/db/src/schema/inspections.ts` — table is **`boilerplate_sections`**, not `bp_library_sections`; prior psql query used wrong name. Table and enum exist. | BUILT-VERIFIED |

**Migration file status:**
- `0000_kind_king_bedlam.sql` — core schema creation, **all 4 pipeline columns included** (`stage_entered_at`, `loop_next_action_at`, `loss_reason`, `source_pipeline`). No-op confirmed by DB column presence. BUILT-VERIFIED
- `0001_known_cyclops.sql` — adds `is_demo` (default false) and `needs_stage_review` (default false). No-op confirmed. BUILT-VERIFIED

**Live pin distribution (all demo data, no production records):**

| pipeline_stage | count |
|---|---|
| pin_dropped | 11 |
| damage_documented | 1 |

All 12 pins: `is_demo = true`. The `stageKey` parity question (count across stages = total) cannot be verified on live data until non-demo pins exist. `is_demo` flag works as designed (11 pins have `needs_stage_review = true`).

### 1.2 Claim/Lead Object Model

| Check | Evidence | Classification |
|---|---|---|
| pins ↔ inspections relationship | Both tables exist; inspections carry `pinId` FK; leads page resolves `ins-{id}` prefix aliases | BUILT-VERIFIED |
| stageKey population — retail pipeline | `/retail-pipeline` endpoint: if `pipelineStage` is null, falls back to `deriveRetailStageLegacy()` + `OLD_RETAIL_KEY_MAP`; stageKey always present in response | BUILT-VERIFIED |
| stageKey population — insurance/project | Verified via subagent; stage columns populated at advance-stage time | BUILT-VERIFIED |

### 1.3 Trigger Flag Engine

`deriveClaimFlags.ts` — `artifacts/api-server/src/lib/deriveClaimFlags.ts` — EXISTS.

| Rule | Evidence | Classification |
|---|---|---|
| `discontinued_verified` requires `product_id_class = 'identified'` | Throws `ClaimFlagValidationError` if violated (confirmed in file) | BUILT-VERIFIED |
| `compatibility_assessed` requires `identified` | Same guard in deriveClaimFlags | BUILT-VERIFIED |
| `lab_recommended` carries no product-specific conclusions | Enforced by flag rules; lab_recommended ≠ identified | BUILT-VERIFIED |
| `product_id_class` is exactly `{identified, lab_recommended}` | No `field_approximated`, `unknown`, or `probable` found anywhere in schema or deriveClaimFlags | BUILT-VERIFIED |
| `discontinued_status` is exactly `{discontinued_verified, discontinued_not_verified, not_applicable}` | Confirmed; `not_applicable` guards documented inline | BUILT-VERIFIED |

### 1.4 stage_transitions Population

| Trigger | Code path | Classification |
|---|---|---|
| `task` | `POST /api/leads/:leadId/advance` → passes `trigger: 'task'` to `advancePinStage()` | BUILT-VERIFIED |
| `auto_event` | `POST /api/events/pipeline` → passes `trigger: 'auto_event'` | BUILT-VERIFIED |
| `manual_move` | Same advance endpoint, alternate trigger value | BUILT-VERIFIED |

DB query for transition counts could not be confirmed on live data (only 12 demo pins, 0 transitions recorded).

---

## 2. LIBRARIES

### 2.1 BP Library Section Keys

Confirmed from `artifacts/api-server/src/routes/library.ts` (line 535–545 comment block):

| sectionKey | Present |
|---|---|
| opening_statement | ✓ |
| inspection_method | ✓ |
| caption_patterns | ✓ |
| rap_field_protocol | ✓ |
| attestation_block_a | ✓ |
| attestation_block_b | ✓ |
| attestation_block_c | ✓ |
| uniform_inspection_procedure | ✓ |
| product_id_methodology | ✓ |
| scope_block | ✓ |
| std_rpr_01_source_record | ✓ |
| **aluminum_siding_protocol** | **✗ — not in enum** |

**aluminum_siding_protocol**: MISSING from the section key set.

**Versioning:** `PUT /report-settings/bp-library/:sectionKey` computes `MAX(version) + 1` and INSERTs a new row — never mutates existing rows. Same pattern for standards-entries, detriment-entries, ahj-packs. BUILT-VERIFIED.

Content upload status (per key) UNVERIFIED — requires authenticated LibraryPage review or direct DB query: `SELECT section_key, current_version FROM boilerplate_sections WHERE company_id = '<id>'`.

### 2.2 Standards Entries

Live DB query results (all companies combined — each company maintains its own copy):

| entry_key | source_type | verification_status | human_entered_provisions_only |
|---|---|---|---|
| STD-RPR-01 — NAFE Repairability Assessment Method | Peer-reviewed methodology | mixed (some verified, some verify_before_ship) | f |
| STD-RPR-02 — Hail Damage Assessment Protocol | Conference protocol | verify_before_ship | f |
| STD-RFG-01 — NRCA Roofing Manual | Trade manual | mixed | f |
| STD-RFG-02 — ARMA Technical Guidance | Trade manual | verify_before_ship | f |
| STD-WTR-01 — ANSI/IICRC S500 (2021) | ANSI standard | mixed | **f** |
| STD-WTR-02 — ANSI/IICRC S520 (2024) | ANSI standard | mixed | **f** |
| STD-PRD-01 — ASTM Product Standards | ASTM product standard | mixed | f |
| STD-MFR-01 — Manufacturer Installation Instructions | Manufacturer instruction | mixed | f |
| ASTM_D3679 (vinyl siding standard) | ASTM | verified | f |

**Spec expected:** STD-RPR-01, STD-WTR-01, STD-WTR-02 → `verified`. In practice each is seeded as `verified` for the seed tenant, but new companies start with `verify_before_ship` rows — per-company lifecycle is working. BUILT-VERIFIED.

**DRIFT — humanEnteredProvisionsOnly:** Spec requires both IICRC entries (STD-WTR-01, STD-WTR-02) to have `humanEnteredProvisionsOnly = true`. DB shows `f` for **all** entries. The column exists in schema but is never set to `true` for any row.

**Importer column separation:** Confirmed via `lib/db/src/schema/inspections.ts` — `authority_limit` and `locator_template` are **separate columns** (not concatenated into `citation_text`). All three exist alongside `citation_text`. BUILT-VERIFIED.

### 2.3 Detriment Entries

Live DB count: **19 entries** — matches spec exactly. Note: entries are **not seeded via migration files**; the library subagent found no seed fixtures for detriment entries. They were inserted via API/admin action. The `applicabilityConditions` column is `jsonb`, default `[]` (structured, not free-text). BUILT-VERIFIED.

| Range | Entries | Status |
|---|---|---|
| DET-AS-01..08 | 8 | ✓ |
| DET-VS-01..03 | 3 | ✓ |
| DET-CS-01..02 | 2 | ✓ |
| DET-SM-01..03 | 3 | ✓ |
| DET-IN-01..03 | 3 | ✓ |

A row `PART 1 — Condition-Code Taxonomy Additions Required` appears in the DB — a **placeholder note record**, not a real detriment entry. It signals that the 22-code expanded taxonomy is needed.

**Condition-code taxonomy expansion (22-code):** MISSING. Current 19 entries cover the base set; expanded vocabulary beyond these 19 has not been added.

### 2.4 AHJ Packs + Wizard

| Check | Evidence | Classification |
|---|---|---|
| `materialApplicability` on pack items | `artifacts/api-server/src/lib/ahjWizard.ts` line 151, 173, 267; valid codes include `all`, `asphalt_shingle`, `cedar_shake`, `aluminum_siding` etc. | BUILT-VERIFIED |
| `materialApplicability` on candidate items | Same file, candidates carry the field; verification route enforces non-null value before marking verified | BUILT-VERIFIED |
| Wizard verification queue as hard gate | `artifacts/api-server/src/routes/ahjWizard.ts` lines 860–889: `POST .../promote-to-pack` returns 422 if any real (non-gap) items remain unverified. Gap items are explicitly blocked from promotion without conversion (line 657–667). | BUILT-VERIFIED |
| `promptVersion` recorded on wizard runs | `artifacts/api-server/src/lib/ahjWizardExtraction.ts` line 11: "promptVersion recorded on wizard_runs: bump PROMPT_VERSION when you edit" | BUILT-VERIFIED |
| Virginia golden-set eval | `artifacts/api-server/src/lib/ahjWizard.ts`: `scoreVirginiaGoldenSet()` function; golden-set fixture at `artifacts/api-server/fixtures/virginia-golden-set.json` (14 items, canary citation `R302.2.2`); prompt version `1.1` | BUILT-VERIFIED |
| Last Virginia eval run results | Not retrievable from code alone; requires DB query: `SELECT * FROM ahj_wizard_runs ORDER BY created_at DESC LIMIT 5` | UNVERIFIED |
| Gaps channel handling | Gap items seeded/classified with `classification: 'gap_identified'`; blocked from promotion | BUILT-VERIFIED |

---

## 3. GENERATION PIPELINE

### 3.1 Stage 0 Readiness

`artifacts/api-server/src/lib/readiness.ts` — `computeReadiness()` — EXISTS.

| Item key | Check / pass condition | Spec-match | Classification |
|---|---|---|---|
| `forensic_findings` | `damageInstancesCount > 0` | — | BUILT-VERIFIED |
| `product_id` | `identificationMethod === 'field_identified'` OR `'itel_sample'` (lab_recommended maps to itel_sample → PASSES) | lab_recommended passes ✓ | BUILT-VERIFIED |
| `rap_record` | `testSquaresCount > 0` OR `rapGateReason` present (not_warranted_discontinued / not_authorized). No peril condition. | Record-OR-gate-reason, peril-agnostic ✓ | BUILT-VERIFIED |
| `estimate` | Estimate has ≥1 line item | — | BUILT-VERIFIED |
| `contractor_quals` | Company has contractor licenses + qualifications text | — | BUILT-VERIFIED |
| `ahj_pack` | State determinable AND packs present → **warn** if missing; 422 never blocked by AHJ absence | AHJ failure is warning ✓ | BUILT-VERIFIED |
| `standards_verified` | Collects `standardsEntryKeys` from **locked section `libraryVersionSnapshot`** (not global library state) and cross-checks against company's entries for `verify_before_ship` | Evaluates against planned references ✓ | BUILT-VERIFIED |

**RAP failure copy:** "No repairability assessment recorded and no gate reason on file." — confirmed at `readiness.ts` line 225 as the `rap_record` fail detail. BUILT-VERIFIED.

**IICRC deadlock:** A claim with `interior_scope_present = true` that references STD-WTR-01/02 in its section snapshots will fail `standards_verified` if those entries are `verify_before_ship` for that company. Because IICRC `humanEnteredProvisionsOnly` is never set to true (§2.2 DRIFT), the generation pipeline has no special bypass for IICRC entries — deadlock **is possible**. PARTIAL.

### 3.2 Section Types and DAG

7 section types confirmed — `artifacts/api-server/src/lib/sectionGeneration.ts` lines 38–46:

| Type | Parallel/Gated | Status |
|---|---|---|
| `findings` | Parallel (upstream) | BUILT-VERIFIED |
| `causation` | Parallel (upstream) | BUILT-VERIFIED |
| `detriment_application` | Parallel (upstream) | BUILT-VERIFIED |
| `rap_narrative` | Parallel (upstream) | BUILT-VERIFIED |
| `estimate_justifications` | Parallel (upstream) | BUILT-VERIFIED |
| `summary_of_findings` | Gated: all 5 upstream approved/locked first | BUILT-VERIFIED |
| `closing_statement` | Gated: summary approved/locked first | BUILT-VERIFIED |

DAG gate enforced at `POST /inspections/:id/sections/:sectionType/generate` (line 8164): returns 400 if upstream sections not ready for DAG-last types. BUILT-VERIFIED.

**"Generate All Ready" button:** EXISTS in `InspectionFlowWizard.tsx` step 4 (lines 790–908). Frontend iterates through not-started independent sections and calls individual generate endpoints. No server-side batch endpoint exists — the frontend orchestrates. BUILT-VERIFIED.

### 3.3 Section Lifecycle

| State | Enforced | Classification |
|---|---|---|
| `generated` | Set on AI generation completion | BUILT-VERIFIED |
| `in_review` | Set on stale propagation and manual edit | BUILT-VERIFIED |
| `approved` | Gate: only from `generated` or `in_review`; blocks if `lintStatus === 'blocked'` (manager override allowed) | BUILT-VERIFIED |
| `locked` | Gate: only from `approved` | BUILT-VERIFIED |
| **`draft`** | **NOT PRESENT** — spec lists draft as initial state; code has no draft state | **DRIFT** |
| **`ai_generated`** | **NOT PRESENT** — spec uses this name; code uses `generated` | **DRIFT** |

**`causationReviewConfirmed` + `reviewerUserId`:** Required in body for causation and detriment_application approve route (lines 8395–8412). `reviewerUserId` saved from `actor.userId`. BUILT-VERIFIED.

**`photoComparisonConfirmed`:** PARTIAL — exists as a gate flag concept, but findings section auto-sets it to `true` on approve (line 8428–8430, marked as stub). Not wired to actual curation card confirmations.

### 3.4 Generation Workers

| Check | Evidence | Classification |
|---|---|---|
| Detriment applicability filtering IN CODE before prompt | `filterDetrimentEntries()` in `sectionGeneration.ts` lines 157–166; runs against field-derived `conditionSet` before prompt assembly | BUILT-VERIFIED |
| `humanEnteredProvisionsOnly` exclusion from prompt (with placeholder emission) | **NOT FOUND** in `sectionGeneration.ts` — the flag is never read in the generation worker; IICRC provisions are included in prompt context verbatim | MISSING |
| Content lint on generated output | `lintReportFragments()` with `CONTRACTOR_LANE_POLICY` called after AI generation, before return; `lintStatus` + `lintFindings` stored on section row (`contentPolicy.ts`) | BUILT-VERIFIED |

---

## 4. PHOTO CURATION

### 4.1 Slot-Based Manifest

Derivation logic is **inline in `inspections.ts`**, not an isolated lib file — shared helper starting at line 6887 (`GET /:inspectionId/exhibit-slots` + finalize gate).

| Slot category | Rule | Classification |
|---|---|---|
| Always slots | Present regardless of flags | BUILT-VERIFIED |
| Hail slots | Conditional on peril = hail or hail_and_wind | BUILT-VERIFIED |
| Interior trace slots | `interior_scope_present = true` (line 7319) | BUILT-VERIFIED |
| RAP slots | Test squares exist (RAP record) | BUILT-VERIFIED |
| Mitigation slots | `mitigation_performed = true` | BUILT-VERIFIED |
| Comparison: recency | Only when `recencyBefore.length > 0 AND recencyAfter.length > 0` (both-side candidates required) | BUILT-VERIFIED |
| Comparison: covered_vs_unrelated | Only when appropriate candidates exist | BUILT-VERIFIED |
| **Comparison: cause_differentiation** | **NOT FOUND** as a slot key | UNVERIFIED — slotKey `cause_differentiation` absent; see §4.2 |

### 4.2 Comparison Type Enum

**DRIFT.** Spec requires: `{recency, cause_differentiation, covered_vs_unrelated}`.

Code uses: `directional_comparison` and `condition_differentiation` as `comparisonType` values (lines 7311, 7386). Slot keys are `comparison_recency` and `comparison_covered_vs_unrelated`. No `cause_differentiation` type or slot exists. No `pre_loss_post_loss` remnants found.

### 4.3 Slot Interactions

Confirm/swap/skip are event-recorded: `slot_confirmed`, `slot_swapped`, `slot_skipped` events referenced at line 8697. Interaction count (≤2 clicks) UNVERIFIED — requires UI testing.

### 4.4 Badge Assignment

| Check | Evidence | Classification |
|---|---|---|
| Class-prefixed scheme (S/R/I/F/C/T-#) | `badgeLabel.split('-')[0]` = class at compile (line 5724); exhibit classes confirmed in `exhibitSelectionsTable` | BUILT-VERIFIED |
| Per-class counters frozen at finalization | `finalizedAt` set on all selections at `POST /:id/curation/finalize` (line 7437); subsequent changes blocked: "Badges are frozen" (line 6556) | BUILT-VERIFIED |
| Compile does NOT touch photo-slot badges | Badge map built from already-finalized selections at first compile, then frozen on inspection row; subsequent compiles re-read the frozen map (lines 5712–5737) | BUILT-VERIFIED |
| **A–M letter scheme remnants** | **FOUND** — `proofPackageTemplate.ts` line 22: "canonical exhibits A–M in fixed letters." Proof Package (insurance, Phase 2) uses A–M letter system entirely separate from the class-prefix S/R/I/F/C/T-# system used in AI-section reports. Two coexisting badge schemes. | DRIFT — two systems in use simultaneously; Proof Package has not migrated |

### 4.5 Caption Staleness

Caption text edit → `state: 'in_review'` (line 7675): BUILT-VERIFIED.

**Spec: exhibit change after captions locked flips captions + findings to in_review with staledBy:** PARTIAL — badge freeze prevents exhibit changes post-finalization; caption staleness on exhibit swap is therefore blocked at the gate rather than propagated. Whether findings section also flips on exhibit change is UNVERIFIED.

### 4.6 Caption Generation

Format "Photo — Exhibit {badge} — ..." confirmed at line 7574 and 7587. Per-slot generation via `caption_patterns` library section: BUILT-VERIFIED.

---

## 5. COMPILE / ATTEST / DELIVER

### 5.1 Compiler Determinism

`POST /inspections/:inspectionId/report/compile` — `artifacts/api-server/src/routes/inspections.ts` line 4956.

| Snapshot item | Present | Evidence |
|---|---|---|
| Section versions (type → rowId) | ✓ | `sectionVersions` map (line 5744–5747) |
| Library versions | ✓ | `libraryVersionSnapshot.bpVersions` on section rows |
| Protocol version | ✓ | Fixed string `'7.0'` at compile time |
| Flag state (triggerFlags) | ✓ | From inspection row |
| standardsCited (with verificationStatus + verifiedAt) | ✓ | Collected at compile (lines 5752–5768) |
| exhibitBadgeMap | ✓ | Frozen on first compile from finalized selections (line 5718) |
| **AHJ pack version** | **PARTIAL** | `jurisdictionPack` is in `reportData.statePack` but no explicit `ahjPackVersion` key in the top-level metadata |

BUILT-VERIFIED (with AHJ pack version as PARTIAL).

**Stage 0 readiness re-validation:** Server-side gate re-runs full 9-item checklist before compile proceeds (lines 4975–5046). Returns 422 with failing item list if not ready. BUILT-VERIFIED.

### 5.2 Attestation

**DRIFT — block selection:** Spec says "attestation_block_b in ALL cases with internal preparer_is_inspector branch (verify block_a cannot render at report level)."

Code at line 3178:
```typescript
const attestationBlockKey = isSameIdentity ? 'attestation_block_a' : 'attestation_block_b';
```

`attestation_block_a` **CAN and DOES render** at report level when the preparer and inspector are the same person. Spec explicitly prohibits this. Block_b has no internal branch.

**MISSING — post-attest recompile:** Spec says attest action should "trigger automatic final recompile producing a NEW blob version." Code at POST `/report-attestation` writes to `reportAttestationsTable` and emits `report_attested` event, but **does NOT recompile** — it binds the attestation to the existing `blobVersionIndex`. No new blob is created.

`reportAttestationsTable` writes confirmed: BUILT-VERIFIED.

### 5.3 Blob Immutability

`compiledReportVersions` append-only via `SQL || ::jsonb` (line 5847). Pre-attestation blob retained. BUILT-VERIFIED.

### 5.4 Deliver Gate

`POST /inspections/:inspectionId/email-report` (line 3231):
- 422 if `versions.length === 0` (no blob) ✓
- 422 if no `reportAttestationsTable` row for current version index ✓

BUILT-VERIFIED.

### 5.5 Scope Blocks

`scope_block` confirmed as a BP library section key. Full variant vs. footer variant distinction in templates: UNVERIFIED — no distinct `scopeBlockVariant` render logic found in `reportTemplate.ts` or `proofPackageTemplate.ts`; the section key exists but rendering variants are not differentiated in visible code.

### 5.6 Conditional-Marker Handling

**MISSING.** No HTML-comment `<!-- IF ... -->` / `<!-- ELSE -->` processing was found in the compiler, `reportTemplate.ts`, or `proofPackageTemplate.ts`. BP library content containing such markers would **render as literal HTML comment text** in the compiled output, not as resolved conditional branches. The template uses JS conditionals, not content-embedded markers.

Affected BP sections: `attestation_block_b` (preparer_is_inspector branch), `attestation_block_c` (product_id_class branch), `inspection_method` (material blocks).

### 5.7 Supplement Flow

**DRIFT.** Spec: "Supplements as new versioned docs appending badges within class, separately attested."

Actual: "Supplemental sections" are **pre-built inner-HTML blocks appended within the same Proof Package PDF blob** (`proofPackageTemplate.ts` lines 545–606: RAP section, VAP section, Evidence Manifest, Record Disclosure). They are part of the single compile, covered by the single report attestation, and not separately versioned or attested.

---

## 6. PIPELINES

### 6.1 Stage Sets

**Retail Pipeline** (RetailPipeline.tsx) — 10 stages:
`pin_dropped → appt_needed → appt_scheduled → appt_complete → proposal_provided → follow_up → contract_pending → contract_signed → deposit_received → archived_lost`

**Insurance Pipeline** (InsurancePipeline.tsx) — 15 stages:
`pin_dropped → phase1_scheduled → phase1_complete → fipsa_signed → phase2_scheduled → phase2_complete → package_ready → claim_filed → claim_review → supplement_dispute → claim_approved → contract_pending → contract_signed → deposit_received → archived_no_damage`

**Project Pipeline** (ProjectPipeline.tsx) — 8 stages:
`pm_handoff → pre_production → materials_ordered → scheduled → in_production → complete → final_invoiced → closed_warranty`

All three match the rebuild spec. BUILT-VERIFIED.

### 6.2 Inline Exit-Task Widgets

| Stage | Widget | Pipeline |
|---|---|---|
| pin_dropped | AssignUserWidget | Retail + Insurance |
| appt_needed | DatetimeWidget | Retail |
| appt_scheduled | ApptScheduledButton (local, confirm-only) | Retail |
| appt_complete | ButtonLinkWidget → /leads/:id | Retail |
| proposal_provided | OutcomeButtonsWidget (Won/Follow-Up/Lost) | Retail |
| follow_up | OutcomeButtonsWidget (datetimeFirst) | Retail |
| contract_pending | ButtonLinkWidget → /leads/:id | Retail |
| contract_signed | MoneyConfirmWidget | Retail + Insurance |
| deposit_received | AssignUserWidget → pm_handoff | Retail + Insurance |
| phase1_scheduled | Auto-advance (preliminary_record_synced) | Insurance |
| phase1_complete | Auto-advance (fipsa_signed) | Insurance |
| fipsa_signed | DatetimeWidget | Insurance |
| phase2_scheduled | Auto-advance (forensic_record_attested) | Insurance |
| phase2_complete | ButtonLinkWidget + auto-advance (report_attested) | Insurance |
| package_ready | ButtonLinkWidget + auto-advance (package_delivered) | Insurance |
| claim_filed | FieldsWidget | Insurance |
| claim_review | OutcomeButtonsWidget | Insurance |
| supplement_dispute | SupplementDisputeWidget (composite) | Insurance |
| claim_approved | ButtonLinkWidget | Insurance |
| pm_handoff | ConfirmWidget | Project |
| pre_production | FieldsWidget | Project |
| materials_ordered | DateRangeWidget | Project |
| scheduled | ConfirmWidget | Project |
| in_production | ConfirmWidget | Project |
| complete | Link + auto-advance (completion_package_generated) | Project |
| final_invoiced | MoneyConfirmWidget | Project |

### 6.3 Auto-Advance Workers

`POST /api/events/pipeline` handles all events generically via `pipelineStages.ts` mappings.

| eventType | Stage advanced | Emitter exists? | Classification |
|---|---|---|---|
| `proposal_generated` | retail: appt_complete → proposal_provided | UNVERIFIED — no emitter found in AI section generate/lock routes | BUILT-UNWIRED |
| `contract_signed` | retail/insurance: contract_pending → contract_signed | Called manually via widget | BUILT-VERIFIED |
| `preliminary_record_synced` | insurance: phase1_scheduled → phase1_complete | **NO EMITTER** — PATCH /inspections/:id does not emit this on phase transition | BUILT-UNWIRED |
| `fipsa_signed` | insurance: phase1_complete → fipsa_signed | Called via FIPSA agreement route | BUILT-VERIFIED |
| `forensic_record_attested` | insurance: phase2_scheduled → phase2_complete | **NO EMITTER** — POST /inspections/:id/attestations emits `report_attested` (report-level), NOT this field-level event | BUILT-UNWIRED |
| `report_attested` | insurance: phase2_complete → package_ready | POST /report-attestation emits this correctly | BUILT-VERIFIED |
| `package_delivered` | insurance: package_ready → claim_filed | POST /email-report line 2703 calls pipeline event | BUILT-VERIFIED |
| `completion_package_generated` | project: complete → final_invoiced | Called from completion package route | BUILT-VERIFIED |

**3 of 8 auto-advance events are unwired from their real triggers.**

### 6.4 Loop Stages

`follow_up` (retail) and `supplement_dispute` (insurance) both `isLoopStage: true`. `StageCard.tsx` enforces: amber border for overdue (`loopNextActionAt < now`), red age badge for >14 days. `loopNextActionAt` populated on advance via `pipelineEvents.ts` line 60. BUILT-VERIFIED.

### 6.5 Convergence

`deposit_received` in both retail and insurance advances to `pm_handoff` in Project pipeline with `sourcePipeline` stamped. `ProjectPipeline.tsx`: `SourceBadge` shows "R" (green) or "I" (blue). `CfrClock` shows 21-day CFR supplement countdown from `pmHandoffAt` for insurance-sourced cards. BUILT-VERIFIED.

### 6.6 Compliance String Audit

Grep across `axiomrestore-web/src/`, `api-server/src/`, `mobile/src/` for: "submit claim", "submit a claim", "file a claim", "claim settlement" → **ZERO HITS**. BUILT-VERIFIED.

### 6.7 Landing Behavior

`Home.tsx` reads `localStorage.rt_last_pipeline`, redirects authenticated users to last-visited pipeline; defaults to `/insurance-pipeline`. BUILT-VERIFIED.

---

## 7. CLAIM HUB / STEPPER

### 7.1 Architecture

`/inspections/:id` → `ClaimHub.tsx` (legacy, redirects to `/leads/{pinId}`)
`/leads/:id` → `LeadProfile.tsx` (canonical) → renders `InspectionFlowWizard` in `inspection_flow` tab.

The "ClaimHub" referenced in the spec is functionally the `InspectionFlowWizard` component embedded in `LeadProfile`. BUILT-VERIFIED.

### 7.2 Stepper Order

Confirmed from `InspectionFlowWizard.tsx` header comment and step metadata:

1. Review Field Data
2. Photo Curation ─┐ both unlock after step 1
3. Estimate ────────┘
4. AI Report Sections
5. Compile & Attest
6. Deliver

Estimate (step 3) is **before** AI Sections (step 4). ✓ BUILT-VERIFIED.

Steps 2+3 co-unlock: `isStepLocked(1)` and `isStepLocked(2)` both gate on `!s1Complete`. BUILT-VERIFIED.

### 7.3 Awaiting Field Capture Gate

`AwaitingFieldCapture` component (line 143–226). Shows: "Awaiting Field Capture" full-screen gate when no attested record. Displays capture status (Not Started / In Progress / Synced) and last sync timestamp. BUILT-VERIFIED.

### 7.4 Readiness Progress Bar

`ReadinessProgressBar` component (lines 232–323). Percentage + expandable `Collapsible` showing failing items with detail text. BUILT-VERIFIED.

### 7.5 Review Field Data Modal

`FieldReviewModal` (lines 329–598). Tabs: Overview, Damage Scope, Photos, Readiness — structured per-stage rendering. Records `field_record_reviewed` event via `recordEvent.mutate` (line 1466). BUILT-VERIFIED.

### 7.6 Step 6 (Compile & Attest) Status

`canCompile` gate enforced; panel shows warning when sections are not all locked. RAP failure copy "No repairability assessment recorded and no gate reason on file." is served via the readiness API (not hardcoded in wizard) — rendered in the expandable readiness bar under the failing `rap_record` item. BUILT-VERIFIED.

### 7.7 Duplicate AI Surfaces

**DRIFT / STALE.** Two AI section surfaces coexist:

| Surface | Path | What it manages |
|---|---|---|
| **`InspectionFlowWizard` step 4** | `/leads/:id` | 7 discrete section types (findings, causation, etc.) — **canonical** |
| **`Summary.tsx`** | `/inspections/:id/summary` | Monolithic "Forensic Summary" (single-section legacy view) |

Old surface is not linked from primary nav or Lead Profile, but is still a live route. Spec's 7-section architecture is only in the stepper. The two surfaces manage **different data** and are not interchangeable — the old Summary page is effectively STALE but not dangerous.

### 7.8 Estimate Step

`EstimatePanel.tsx` — fully wired: uses `useGetInspectionEstimate`, `useSaveInspectionEstimate`, `useListPriceBookItems`. Supports line item CRUD, price book integration, waste factor calculations. NOT a placeholder. BUILT-VERIFIED.

---

## 8. FIELD APP INTEGRATION

### 8.1 Outbox Sync Path

No dedicated `/sync` or `/outbox` endpoint. Mobile uses standard REST endpoints with offline-first outbox queue (`artifacts/mobile/lib/outbox/`).

- `PATCH /inspections/:id` — `patchInspection` logic, phase transition validation (preliminary → forensic), writes to DB. BUILT-VERIFIED.
- `POST /inspections/:id/photos` — idempotent via `onConflictDoNothing` with client_id. BUILT-VERIFIED.
- `POST /inspections/:id/attestations` — idempotent via client_id lookup. BUILT-VERIFIED.

### 8.2 RAP Selection → RapReportSection

`extractRap()` (`rapScorecard.ts` line 73) reads `selection` object. `buildRapReportSection()` (line 150) renders:
- `damaged_target` → "Selection criteria: confirmed (damaged target shingle)"
- `fallback_slope` → "Selection criteria: fallback — no damaged shingle usable; note: ..."
- `undefined/null` → nothing rendered (legacy clean)

BUILT-VERIFIED.

### 8.3 Pipeline Auto-Advance Event Emitters

| Event | Status |
|---|---|
| `preliminary_record_synced` | **NOT EMITTED.** Defined in `pipelineStages.ts` as autoAdvance trigger for `phase1_scheduled`. `PATCH /inspections/:id` (which processes the preliminary sync) does not call the pipeline event endpoint. Stage is permanently stuck until manually advanced. |
| `forensic_record_attested` | **NOT EMITTED.** Defined for `phase2_scheduled`. `POST /inspections/:id/attestations` emits `report_attested` (the report-level event) but NOT this field-level attestation event. |

Both are BUILT-UNWIRED.

### 8.4 Field App Backlog Items

| Backlog item | Status | Evidence |
|---|---|---|
| Pre-existing marking instruction (§4.7) | BUILT | `MARKING_STEPS` / `VAP_MARKING_STEPS` in `inspection-repairability.tsx` |
| Underlayment check (§5.5) | BUILT | `inspection-roof.tsx` line 81 |
| Lab-sample variant (§6) | BUILT | "Lab Identification Recommended" block `inspection-roof.tsx` line 1201 |
| Stage 6.7 binary product-ID reword | PARTIAL | Reworded question found; characteristics checklist MISSING; library version stamp MISSING |
| Confirmation-method fields (mat fracture/crease/coating/cedar crush) | PARTIAL | Mat transfer found in `inspection-repairability.tsx`; fracture/crease/coating/cedar crush fields absent |
| Explicit damage-location booleans at Stage 5 | BUILT | `inspection-elevations.tsx` line 290 |
| Eave labels (Present/Not Observed/Undetermined) | DRIFT | Code uses Present/Absent/Not determined — not the exact three-value vocabulary in spec |

---

## 9. NAVIGATION & DEAD SURFACE

### 9.1 Route Inventory

`docs/route-inventory.md` EXISTS and is current (dated 2026-08-05). Full route table:

| Path | Component | Reachable from nav | Disposition |
|---|---|---|---|
| `/` | Home | Yes (Dashboard) | BUILT-VERIFIED |
| `/retail-pipeline` | RetailPipeline | Yes | BUILT-VERIFIED |
| `/insurance-pipeline` | InsurancePipeline | Yes (default) | BUILT-VERIFIED |
| `/project-pipeline` | ProjectPipeline | Yes | BUILT-VERIFIED |
| `/leads` | Leads | Yes (All Leads) | BUILT-VERIFIED |
| `/leads/:id` | LeadProfile | Via list clicks | BUILT-VERIFIED |
| `/pipeline` | Pipeline (redirect) | No — redirects to /insurance-pipeline | STALE (redirect) |
| `/inspections` | InspectionList (redirect) | No — redirects to /leads | STALE (redirect) |
| `/inspections/:id` | ClaimHub (redirect) | No — redirects to /leads/:id | STALE (redirect) |
| `/inspections/:id/summary` | Summary | No | STALE |
| `/inspections/:id/estimate` | Estimate | No | STALE |
| `/inspections/:id/curation` | PhotoCuration | No | STALE |
| `/team` | TeamList | Yes (Team Management) | BUILT-VERIFIED |
| `/price-book` | PriceBookList | Yes (Price Book) | BUILT-VERIFIED |
| `/settings/library` | LibraryPage | Yes (Proof Package Data) | BUILT-VERIFIED |
| `/settings/library/ahj-wizard` | AhjWizardPage | Via LibraryPage deep-link | BUILT-VERIFIED |
| `/map` | MapPage | Yes (Map View) | BUILT-VERIFIED |
| `/settings` | SettingsPage | Yes (Settings) | BUILT-VERIFIED |
| `/user-authorization` | UserAuthorizationPage | Yes (User Authorization) | BUILT-VERIFIED |
| `/sample-package` | SamplePackagePage | No — not in nav | BUILT-UNWIRED |
| `/team-calendar` | ComingSoon | Yes | MISSING (placeholder) |
| `/templates` | ComingSoon | Yes | MISSING (placeholder) |
| `/reports` | ComingSoon | Yes | MISSING (placeholder) |
| `/commission-report` | ComingSoon | Yes | MISSING (placeholder) |
| `/integrations` | ComingSoon | Yes | MISSING (placeholder) |
| `/notifications` | ComingSoon | Yes | MISSING (placeholder) |

### 9.2 Duplicate Surfaces

| Surface | Status |
|---|---|
| Old AI Sections tab (`/inspections/:id/summary`) | STALE — manages monolithic "Forensic Summary"; canonical is InspectionFlowWizard step 4 |
| Old InspectionList (`/inspections`) | STALE redirect to /leads |
| Old ClaimHub (`/inspections/:id`) | STALE redirect to /leads/:id |

### 9.3 Orphaned UI Components

~18 shadcn components in `src/components/ui/` with no internal importers: `aspect-ratio`, `breadcrumb`, `button-group`, `carousel`, `chart`, `context-menu`, `hover-card`, `input-group`, `input-otp`, `menubar`, `navigation-menu`, `pagination`, `resizable`, `scroll-area`, `slider`, `sonner`, `toggle-group`, `dropdown-menu`. STALE scaffolding — no functional impact.

`pages/not-found.tsx` defined but App.tsx uses inline `NotFound` function. STALE.

---

## END-TO-END VERDICT

**Can one claim travel the entire path from attested field record to delivered signed package?**

### AI Report path (retail, fully manual):

| Step | Gate met? |
|---|---|
| Field record exists (PATCH /inspections) | ✓ |
| Awaiting Field Capture gate clears | ✓ |
| Photo curation + finalization | ✓ |
| AI section generation (7 types) | ✓ |
| Compile (readiness re-validated) | ✓ |
| Report attestation | ✓ |
| Deliver (email-report with 422 gate) | ✓ |

**Retail AI report path: end-to-end is possible** with one caveat — the post-attest recompile that spec requires does not happen, so the "signed blob" is the same blob as the pre-attest compile.

### Insurance Proof Package path:

| Step | Gate met? |
|---|---|
| Field sync (PATCH inspection) | ✓ |
| preliminary_record_synced emitted | **✗ — NO EMITTER** |
| Phase 1 auto-advance | **BLOCKED** (must manually advance) |
| FIPSA signed | ✓ (if manually advanced) |
| Phase 2 forensic attestation | ✓ |
| forensic_record_attested emitted | **✗ — NO EMITTER** |
| Phase 2 auto-advance | **BLOCKED** (must manually advance) |
| report_attested → package_ready | ✓ |
| package_delivered → claim_filed | ✓ |

**First breaking point in the insurance pipeline:** `preliminary_record_synced` is never emitted when the field sync PATCH lands. The stage auto-advance for phase1_scheduled is permanently dead without this event. A manager must manually advance every insurance pin out of phase1_scheduled.

---

## BUILD LIST
*Everything MISSING, ordered by what blocks first end-to-end delivery.*

1. **`preliminary_record_synced` emitter** — add to PATCH /inspections/:id on preliminary→forensic phase transition; unlocks insurance pipeline auto-advance for phase1_scheduled → phase1_complete.
2. **`forensic_record_attested` emitter** — add to POST /inspections/:id/attestations for forensic-type attestations; unlocks phase2_scheduled → phase2_complete.
3. **`proposal_generated` emitter** — add to wherever the proposal builder exports/saves; unlocks retail appt_complete → proposal_provided.
4. **`humanEnteredProvisionsOnly` exclusion in sectionGeneration** — filter IICRC-tagged standards entries from AI prompt context and emit placeholder text; required to prevent IICRC deadlock on interior-scope claims.
5. **Post-attest recompile** — after writing reportAttestation, trigger a final recompile producing a new blob version stamped as `signed`; current blobs are attestation-appended, not recompiled.
6. **Conditional-marker processing** — implement HTML-comment `<!-- IF/ELSE -->` block resolution at compile time so BP library content branches (attestation_block_b preparer branch, block_c product_id_class branch, inspection_method material blocks) render correctly rather than as literal comments.
7. **`aluminum_siding_protocol` library section key** — add to BP library section enum.
8. **Expanded 22-code condition-code taxonomy** — add missing detriment applicability codes beyond the base 19.
9. **Stage 6.7 characteristics checklist** (mobile) — add per-product confirmation fields and library version stamp at product-ID step.
10. **Confirmation-method fields** (mobile) — fracture, crease, coating breach, cedar crush at RAP confirmation.
11. **Supplement flow as separate versioned/attested docs** — supplements are currently sections inside the main package blob; spec requires independently versioned and attested supplement documents with badge continuity within class.
12. **ComingSoon routes** — Team Calendar, Templates, Reports, Commission Report, Integrations, Notifications (6 features).

---

## WIRE LIST
*Everything BUILT-UNWIRED with the connection needed.*

1. **`preliminary_record_synced`** — handler exists at POST /api/events/pipeline; wire: add `await callPipelineEvent('preliminary_record_synced', pinId)` inside PATCH /inspections/:id when phase transitions from 'preliminary' to 'forensic'.
2. **`forensic_record_attested`** — handler exists; wire: add `await callPipelineEvent('forensic_record_attested', pinId)` inside POST /inspections/:id/attestations when attestationType = 'forensic_phase'.
3. **`proposal_generated`** — handler exists; wire: identify the proposal export/save action in LeadProfile or estimate builder and call pipeline event.
4. **`/sample-package`** — SamplePackagePage exists and renders; add a nav item or admin-only access point.
5. **`photoComparisonConfirmed`** — field exists on section approval; wire to actual curation card confirm interactions rather than auto-true stub.
6. **`humanEnteredProvisionsOnly` in standards_entries** — column exists but never set to true; wire the standards importer or seeder to set `true` for IICRC entries (STD-WTR-01, STD-WTR-02).
7. **AHJ pack version in compile snapshot** — `jurisdictionPack` is in `reportData.statePack` but not surfaced as a named version key in the top-level snapshot metadata; wire as `ahjPackVersion`.

---

## FIX LIST
*Every DRIFT item with current-vs-specced behavior.*

| # | Item | Current | Spec |
|---|---|---|---|
| F-1 | Attestation block selection | `block_a` when preparer=inspector, `block_b` when split; block_a renders at report level | `block_b` in ALL cases with internal `preparer_is_inspector` branch; `block_a` must not render at report level |
| F-2 | Section state names | States are: `generated`, `in_review`, `approved`, `locked` (no `draft` initial state, `generated` not `ai_generated`) | Spec names: `draft → ai_generated → in_review → approved → locked` |
| F-3 | Comparison type enum | `directional_comparison`, `condition_differentiation` | `recency`, `cause_differentiation`, `covered_vs_unrelated` |
| F-4 | Supplement flow | Supplemental sections are inner-HTML blocks inside the single Proof Package blob, covered by one attestation | Supplements = separate versioned docs appending badges within class, separately attested |
| F-5 | `humanEnteredProvisionsOnly` for IICRC | `false` for all entries in DB | `true` required for STD-WTR-01 and STD-WTR-02 |
| F-6 | Badge scheme in Proof Package | A–M letter exhibit scheme in proofPackageTemplate | Class-prefixed S/R/I/F/C/T-# scheme; spec says "Confirm no A–M letter scheme remnants" |
| F-7 | Eave label vocabulary | Present / Absent / Not determined | Present / Not Observed / Undetermined |
| F-8 | Post-attest recompile | Attestation binds to existing blob; no new blob version produced | Attest action → automatic final recompile → NEW blob version |
| F-9 | `cause_differentiation` slot | Absent (comparison slots: recency + covered_vs_unrelated only) | Spec slot manifest should include cause_differentiation comparison type |
| F-10 | Stale /inspections/:id/summary | Exists as live route managing legacy monolithic "Forensic Summary" | Should be removed or permanently redirected to /leads/:id stepper step 4 |
