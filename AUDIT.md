# ROOFTRAX — FULL DIAGNOSTIC AUDIT
Generated: 2026-08-09  
Auditor: automated seven-pass run per spec

---

## PASS 1 — API SURFACE

### Registration check

All **37** route implementation files are imported and registered via `router.use(…)` in `artifacts/api-server/src/routes/index.ts:2-76`. No implemented route module is unregistered. The notifications router is specifically registered at `:37` (push-tokens/receipts) and `:76` (preferences).

### Routes implemented but absent from OpenAPI spec

The spec (`lib/api-spec/openapi.yaml`) contains **137** path keys. The following implemented paths have no matching key — callers receive no generated hook and invalidation silently no-ops for these surfaces:

| METHOD | Path | Implemented at |
|--------|------|---------------|
| GET | `/documents` | `agreement.ts:745` |
| GET/POST/DELETE | `/agreements`, `/agreements/:id`, `/agreements/:id/send` | `agreement.ts:81,328,400,509` |
| GET | `/agreements` list | `agreement.ts:871` |
| GET/POST/DELETE | `/ahj-wizard/sources`, `/runs`, `/runs/:id`, `/runs/:id/items`, `/items/:id`, `/items/bulk-reject`, `/assemble`, `/seed-virginia` | `ahjWizard.ts:353-940` |
| GET/PATCH | `/companies/:id/ai-settings`, `/fipsa-settings`, `/report-branding`, `/report-settings`, `/jurisdiction-packs`, `/name`, `/platform-preferences`, `/lead-sources`, `/sample-package` | `companies.ts` (multiple) |
| GET | `/mobile-auth/web-login` | `auth.ts:259` |
| GET | `/bug-reports/export.csv` | `bugReports.ts:160` |
| GET/PATCH | `/leads`, `/leads/:id`, `/leads/:id/profile` | served by `crm.ts` or `pins.ts` |
| GET/POST/PATCH/DELETE | `/leads/:id/files`, `/leads/:id/files/:fileId` | `pins.ts` or `crm.ts` |
| GET | `/pipeline`, `/project-pipeline`, `/retail-pipeline` | `crm.ts` / `pipelineEvents.ts` |
| GET | `/search` | dedicated route |
| GET/PATCH | `/leads/:id/advance-stage` | `pipelineEvents.ts` |
| POST | `/inspections/:id/submission`, `/inspections/:id/events`, `/inspections/:id/sections/:type/generate`, `/inspections/:id/sections/:type/approve`, `/inspections/:id/sections/:type/lock`, `/inspections/:id/sections/:type/fill-iicrc-citations`, `/inspections/:id/ahj-check` | `inspections.ts` |
| GET | `/inspections/:id/readiness`, `/inspections/:id/sections`, `/inspections/:id/events`, `/inspections/:id/report-attestation` | `inspections.ts` |
| POST | `/inspections/:id/report-attestation` | `inspections.ts` |
| GET/POST | `/sample-package/info`, `/sample-package/provision` | `companies.ts` |

**Classification: MEDIUM** — No behaviour is broken, but these routes are invisible to spec consumers and `claimHubApi.ts` must maintain hand-written types for all of them (see Pass 2). Any schema drift goes undetected.

### Spec paths with no implementing route

None found. Every path key in `openapi.yaml` has a corresponding route handler.

### Notification routes — end-to-end check

| Route | file:line (impl) | spec line | generated hook |
|-------|-----------------|-----------|---------------|
| GET `/notifications/preferences` | `notifications.ts:76` | `openapi.yaml:3249` | `lib/api-client-react/src/generated/api.ts:6534` |
| PATCH `/notifications/preferences` | `notifications.ts:106` | `openapi.yaml:3285` | `api.ts:6582` |
| POST `/notifications/push-tokens` | `notifications.ts:186` | `openapi.yaml:3312` | `api.ts:6318` |
| DELETE `/notifications/push-tokens/:token` | `notifications.ts:230` | `openapi.yaml:3348` | `api.ts:6390` |
| POST `/notifications/push-receipts` | `notifications.ts:260` | `openapi.yaml` (present) | `api.ts:6462` |

**WIRED** end-to-end.

---

## PASS 2 — CLIENT WIRING

### 2a — customFetch calls (hand-written API layer)

**CALIBRATION ITEM 1 CONFIRMED.**

`rooftrax-web/src/lib/claimHubApi.ts` (911 lines) contains **~30 exported React Query hooks** all backed by `customFetch`. None of these endpoints are in the OpenAPI spec; consequently no generated hook or type exists for any of them. The file header (`:5-18`) explicitly acknowledges this and instructs future migration.

Selected hooks and their endpoint status:

| Hook | Path | In spec? | Generated hook? |
|------|------|----------|----------------|
| `useGetReadiness` | GET `/api/inspections/:id/readiness` | NO | NO |
| `useGetSections` | GET `/api/inspections/:id/sections` | NO | NO |
| `useGenerateSection` | POST `/api/inspections/:id/sections/:type/generate` | NO | NO |
| `useApproveSection` | POST `/api/inspections/:id/sections/:type/approve` | NO | NO |
| `useLockSection` | POST `/api/inspections/:id/sections/:type/lock` | NO | NO |
| `useFillIicrcCitations` | PATCH `/api/inspections/:id/sections/:type/fill-iicrc-citations` | NO | NO |
| `useCompileReport` | POST `/api/inspections/:id/report/compile` | **YES** (`openapi.yaml:3728`) | underlying fn at `api.ts:7215` — **no React mutation hook generated** |
| `useGetReportAttestation` | GET `/api/inspections/:id/report-attestation` | NO | NO |
| `useAttestReport` | POST `/api/inspections/:id/report-attestation` | NO | NO |
| `useGetPipeline`, `useGetProjectPipeline`, `useGetRetailPipeline` | GET `/api/pipeline`, `/project-pipeline`, `/retail-pipeline` | NO | NO |
| `useGetLead`, `useUpdateLead`, `useGetLeads` | GET/PATCH `/api/leads/:id`, `/api/leads` | NO | NO |
| `useSearch` | GET `/api/search` | NO | NO |
| `useGetLeadFiles`, `useRegisterLeadFile`, etc. | CRUD `/api/leads/:id/files` | NO | NO |
| `useGetLeadSources`, `useUpdateLeadSources` | GET/PATCH `/api/companies/:id/lead-sources` | NO | NO |

`useCompileReport` (`claimHubApi.ts:319-335`) is the one case where the endpoint is in spec, an underlying function exists in the generated client (`api.ts:7215`), but **no generated React mutation hook was emitted**. Cannot apply whitelist fix #4 — the generated React hook does not exist.

Additional `customFetch` call sites:
- `lib/curationApi.ts` — all curation/comparison/caption/exhibit-slot endpoints; not in spec
- `lib/priceBookApi.ts` — price-book package endpoints; uses generated `get*QueryKey()` for invalidation (`:55,75,96,108`) ✓
- `pages/settings/LibraryPage.tsx` — library/standards/detriment/ahj/agent-prompts endpoints; not in spec
- `pages/settings/AhjWizardPage.tsx` — AHJ wizard endpoints; not in spec
- `pages/leads/LeadProfile.tsx:3030,3194` — download/upload endpoints

### 2b — queryKey audit

**Properly using generated `get*QueryKey()`:**
`priceBookApi.ts:55,75,96,108` · `claimHubApi.ts` invalidations (`:129,147,163,186,198,227,303-304,329,333` etc.) · `SelectionsLibraryPanel.tsx` · `ContractBuilderTab.tsx` · `ExhibitManifest.tsx` · `InspectionFlowWizard.tsx` · `Dashboard.tsx:70-71` · `NotificationsTab.tsx:232` · `ActionRequiredWidget.tsx:33` (uses `getGetActionRequiredWidgetQueryKey()` ✓)

**Hand-written literal keys where no generated key can exist (endpoint not in spec — not fixable):**

| Site | Key | Endpoint in spec? |
|------|-----|-------------------|
| `claimHubApi.ts:721` | `['search', trimmed]` | NO |
| `SupplementsPanel.tsx:72,78,98` | `suppKey(inspectionId)` local factory | NO |
| `AssignUserWidget.tsx:27` | `['company-reps']` | NO |
| `LibraryPage.tsx:294,300,345,804,816,851,1020,1032,1070,1209,1335,1349,1358,1549` | bp-library / standards / detriment / ahj-packs / agent-prompts literals | NO |

All hand-written keys are for endpoints absent from the spec. There is no generated key to replace them with. **Not broken under the BROKEN definition** (which requires a generated hook to exist). However these surfaces carry the same drift risk as the rest of `claimHubApi.ts`.

### 2c — mutation invalidation completeness

`useCompileReport` (`claimHubApi.ts:323-333`) invalidates both `getGetInspectionQueryKey(inspectionId)` (`:329`) and `getGetSectionsQueryKey` (`:333`) — appropriate.

`useAttestReport` (`claimHubApi.ts:291-306`) invalidates `getGetInspectionQueryKey` (`:304`) — appropriate.

`useGenerateSection`, `useApproveSection`, `useLockSection`, `useFillIicrcCitations` all invalidate section-level keys — appropriate for the data they change.

No mutation was found that fails to refresh data it changes. **WIRED** for all reviewed cases.

### 2d — Portal surface isolation

Searched `artifacts/signing-portal/src` and `artifacts/photo-portal/src` for imports from `@workspace/authz`, session auth modules, and CRM surface:

- **No** `@workspace/authz` imports found in either portal. **WIRED.**
- **No** session/auth middleware imports found. **WIRED.**
- Only false-positive `crm` hits are from `class-variance-authority` (`cva`) imports in UI components. **WIRED.**

---

## PASS 3 — TENANCY & AUTHORIZATION

### 3a — Tables without direct company_id

| Table | company_id? | Tenancy mechanism | file:line |
|-------|-------------|-------------------|-----------|
| `user_profiles` | NO | Joined via `users` → `companies` FK; profile rows scoped by userId. No cross-tenant query guard at table level. | `rooftrax.ts:59` |
| `price_book_package_items` | NO | Child of `price_book_packages` which has `company_id`. No direct route queries this table standalone — always accessed via parent. | `rooftrax.ts:428` |
| `stage_transitions` | NO | Dashboard scopes via `pinsTable.companyId` join (`dashboard.ts:220-250`). | `rooftrax.ts:523` |

`user_profiles` is the only one that warrants attention: routes query it by `userId` and assume the authenticated user's ID implies tenancy. There is no explicit company-scope guard in the `user_profiles` query. This design is intentional (profile is 1:1 with user), but means any route that resolves a profile row by an arbitrary userId without verifying same-company membership could expose cross-tenant data. **Reviewed routes (`dashboard.ts:38,755`, `contracts.ts:54,515`, `inspections.ts:3364,3647`) all use the authenticated actor's own userId, not an arbitrary one — no observed cross-tenant leak. UNCERTAIN** for cases where userId is caller-supplied.

### 3b — Role gate patterns

`isManagerOrAdmin` is imported from `@workspace/authz` and used consistently in high-security routes: `payments.ts:38`, `contracts.ts:44`, `changeOrders.ts:60`, `inspections.ts:119`, `invoices.ts:51`, `expenses.ts:39`, `financialsExport.ts:24`, `calendar.ts:32`, `notifications.ts:33`, etc.

**Raw string role comparisons (NOT using `roleRank`)** found at:

| Site | Pattern | Risk |
|------|---------|------|
| `companies.ts:69` | `actorProfile?.role !== 'super_admin'` | LOW — super_admin gate, correct in isolation, but inconsistent |
| `selections.ts:20,30` | `role !== 'admin' && role !== 'super_admin'` | MEDIUM — `requireAdminOrAbove` helper defined locally; does not use `roleRank` for ordering |
| `dashboard.ts:758,824` | `(profile?.role ?? 'field_rep') === 'field_rep'` | LOW — widget scoping, not a security gate |
| `templates.ts:71` | `actor.role !== 'super_admin' && actor.role !== 'admin'` | LOW |
| `inspections.ts:787` | `['manager', 'admin', 'super_admin'].includes(actor.role)` | MEDIUM — reinvents `isManagerOrAdmin` with an array literal |
| `inspections.ts:875` | `actor.role !== 'super_admin'` | LOW |
| `bugReports.ts:35-36` | `const isAdmin = role === 'admin' || role === 'super_admin'` | LOW |
| `library.ts:45`, `agreement.ts:414`, `ahjWizard.ts:55`, `priceBook.ts:25` | raw admin/super_admin equality | LOW |

None of these produce incorrect authorization today (the logic is equivalent to `roleRank`), but they create maintenance risk: if a new role is inserted into the ordering, inline arrays diverge from the canonical `roleRank` hierarchy.

### 3c — UI minRole vs server gate parity

UI gates (`Shell.tsx:74,81,82,84`; `App.tsx:108,131-133,139,145-147` via `ProtectedRoute`): Reports, Team Management, User Authorization, Integrations. All use `roleRank` via `Shell.tsx:241-251`.

Server-side: corresponding routes use `isManagerOrAdmin` from `@workspace/authz`. Spot-checked: dashboard manager+ comment at `dashboard.ts:1030` with a `isManagerOrAdmin` check present in the handler around line 758. **WIRED** for the checked cases.

**UNCERTAIN** for Integrations route — it renders `<ComingSoon />` on the client (`App.tsx:145-147`) with no backend route; no server-gate parity issue exists because there is no data endpoint yet.

### 3d — Public/unauthenticated endpoints

| Endpoint | Returns | Appropriate? |
|----------|---------|--------------|
| `GET /healthz` | health status string | YES |
| `GET /auth/user` | current user or null | YES |
| `GET /login`, `GET /callback`, `GET /logout` | auth lifecycle | YES |
| `GET /mobile-auth/web-login`, exchange, logout | mobile OIDC lifecycle | YES |
| `GET /portal/:accessCode` | inspection summary, company name, inspector name, non-archive photos, report version metadata — gated by access code | YES — access code is the bearer capability |
| `GET /portal/:accessCode/reports/:versionIndex` | compiled report HTML — gated by access code | YES |
| `GET /portal/contract/:code/*` | contract data, selections, document — gated by access code + rate limit | YES |
| `GET /storage/public-objects/*filePath` | files from PUBLIC_OBJECT_SEARCH_PATHS — **unconditionally public, no ACL** | Intentional per `storage.ts:75-76` comment. Appropriate only if no tenant data ever lands in the public bucket. **UNCERTAIN** — no enforcement prevents a future code path from writing tenant data to the public bucket. |
| `GET /storage/objects/*path` | private objects — requires `req.isAuthenticated()` + `ownership.companyId === req.user.companyId` | YES — `storage.ts:119-140` |

---

## PASS 4 — BUSINESS FLOW WIRING

### Chain A — Contract signature → pins → profitability → Claim Value Tracker

- `contractPortal.ts:519-548`: on signature, atomically writes `pins.contract_amount` (varchar) and `pins.betterments_amount_cents` (integer). **WIRED.**
- Profitability view (`data-migrations/029_profitability_view_step5.sql`) derives `revised_contract_cents` and related columns from pins + approved change orders. **WIRED.**
- `profitability.ts:54-75` exposes the view columns via REST. **WIRED.**
- Claim Value Tracker reads profitability endpoint. **WIRED.**

### Chain B — Contract void → reversal

- `contracts.ts:604-643`: `POST /contracts/:contractId/void` is manager+-gated (`isManagerOrAdmin` `:608`), reason required, atomic transaction. If `wasSigned`, sets `pins.contractAmount = ''` and `pins.bettermentsAmountCents = 0` (`:637-642`). **WIRED.**

### Chain C — Change order approved → revised_contract_cents

- `changeOrders.ts:556-596`: `POST /change-orders/:id/approve` sets `status = 'approved'`, `approvedAt`. **No direct `change_orders_cents` write** — this column is derived as the sum of `change_order_line_items.total_cents` (schema comment at `rooftrax.ts:776-778`).
- Profitability view includes approved COs in `revised_contract_cents`. Confirmed via `profitability.test.ts:466-552` (pending excluded, approved included, void removes). **WIRED.**

### Chain D — Selections → extended delta → betterments_cents → contract total → PDF schedule

- `contractPortal.ts:342`: each selection upsert computes `extendedDeltaCents = unitDeltaCents × quantity`.
- `contractPortal.ts:377`: calls `recomputeContractTotals(contract.id)` which aggregates to `betterments_cents` and `total_contract_cents`. **WIRED** through to DB total.
- PDF generation: the contract PDF is generated from stored selection snapshot rows. **WIRED** for the selections schedule.
- **UNCERTAIN**: whether the PDF schedule rendering accurately reflects `extended_delta_cents` vs `covered_amount_cents` from the scope package — no test traces the full PDF rendering output.

### Chain E — Payment → ledger → total_payments_cents → waterfall → deductible collected

- `payments.ts:159-171`: inserts into `paymentsTable` with `type`, `amount_cents`, `payment_date`. **WIRED.**
- Profitability view aggregates `SUM(amount_cents) WHERE type != 'deductible'` → `total_payments_cents`; `SUM WHERE type = 'deductible'` → `deductible_collected_cents`. **WIRED** (`profitability.test.ts:790-821`).
- `notify({ type: 'payment_recorded' })` fired at `payments.ts:175-182`. **WIRED.**

### Chain F — Invoice marked paid → exactly one ledger row

- Customer-invoice mark-paid endpoint creates/maintains exactly one payment row. Idempotency confirmed by `src/routes/__tests__/customer-invoices.test.ts:143-204`. **WIRED.**

### Chain G — Field submit → pre-flight → AI generation → compile → attest → deliver → evidence portal

- All steps are implemented via `inspections.ts` handlers wrapped by `claimHubApi.ts`.
- Pre-flight (readiness check) → section generation → section approval → report compile → report attestation → evidence portal (`GET /portal/:accessCode`) is the documented flow.
- Caption prerequisite guard before compile verified (IICRC citation placeholder gating). **WIRED** end-to-end, though unspecced.

### Chain H — FIPSA signed → pipeline auto-advance

- `agreement.ts` (the signing handler) was searched for calls to `advancePinStage`, `pipeline`, `stage`. **None found.**
- `advancePinStage` is defined and exported in `pipelineEvents.ts:36-40` and used by `POST /events/pipeline` and `PATCH /leads/:id/advance-stage`. It is NOT called from `agreement.ts`.
- **BROKEN.** When a FIPSA is signed, no pipeline stage advance fires. Stage advance is manual-only after FIPSA signing.

### Chain I — Business event → notify() → recipient resolution → email/push

- Four wired event sites:
  - `payment_recorded`: `payments.ts:175-182` → `notify(…)` **WIRED**
  - `contract_signed`: `contractPortal.ts:673-685` → `notify(…)` **WIRED**
  - `change_order_pending_approval`: `changeOrders.ts:541-543` → `notify(…)` **WIRED**
  - `claim_status_changed`: `insurance.ts:232` → `notify(…)` **WIRED**
- `notify.ts:56-96`: catalog lookup → recipient resolution (actor excluded) → SMTP + push dispatch. **WIRED.**
- Push: `sendPush()` via `push.ts`. **WIRED.**

### Chain J — Scheduling → Team Calendar → mobile scheduled feed

- `GET /calendar?from&to` (`calendar.ts:53`) reads from: `inspections.scheduledFor` (`:110-140`), `pins.appointmentAt` DB column `appointment_at` (`:143-175`), `pins.adjusterMeetingDate` (`:178-209`). **Does NOT use `retailData.appointmentDate`** (only falls back to `retailData.ownerName` at `:161`). **WIRED.**
- `TeamCalendar.tsx` (`App.tsx:121`) consumes the calendar endpoint. **WIRED.**
- Mobile scheduled feed: **NOT AUDITED** (mobile artifact excluded from this pass per spec).

### Chain K — Claim status change → claim_status_history → Live Activity

- `insurance.ts:232`: claim status PATCH writes a `claim_status_history` row in the same transaction. `from_status` nullable (first-ever set), `to_status` nullable (status cleared — see guard in memory). **WIRED.**
- Live Activity (mobile) consuming `claim_status_history`: **NOT AUDITED** (mobile excluded).

---

## PASS 5 — LEGACY, DEAD CODE, ORPHANS

### Calibration items (all eight confirmed independently)

**1. Hand-written API layer — CONFIRMED**
`rooftrax-web/src/lib/claimHubApi.ts` (911 lines): ~30 hooks via `customFetch` for unspecced routes. See Pass 2 for full inventory.

**2. Legacy varchar money columns on pins — CONFIRMED**
`lib/db/src/schema/rooftrax.ts:182-191`: `contract_amount`, `deposit_amount`, `deductible_amount`, `rcv_amount`, `acv_amount`, `supplement_amount`, `final_payment_amount` — all `varchar`, all nullable. Superseded by the payments ledger (`paymentsTable`, migration 023). Still read by: `LeadProfile.tsx:748-803` (display), `claimHubApi.ts:518-527` (typing). Legacy read confirmed by `src/routes/__tests__/legacy_money_read.test.ts`. **LEGACY — live readers exist.**

**3. pins.retailData.appointmentDate superseded — CONFIRMED**
`pins.appointment_at` (DB) / `appointmentAt` (Drizzle) added by migration 037. Still read: `LeadProfile.tsx:748-803`, `calendar.ts:143-175` (uses `appointmentAt` ✓ — does NOT read `retailData.appointmentDate`), `pins.ts:79,114,227`. `retailData` JSON blob still read in `inspections.ts:9600,10428,10498-10500` for legacy inspection context and `LeadProfile.tsx` display. **LEGACY — partial migration, legacy blob still consumed.**

**4. Migration numbering collisions — CONFIRMED**
```
017_comparison_set_captions.sql
017_standards_entries_title_column.sql    ← DUPLICATE prefix 017
018_backfill_comparison_set_captions.sql
018_claim_supplements.sql                  ← DUPLICATE prefix 018
```
Additionally: `0009_remediation_plan_vocab.sql` uses a 4-digit prefix while all other files use 3-digit. In lexicographic sort (which filesystem/shell uses), `0009_` sorts BEFORE `001_`, placing it out of its intended position if the runner orders by filename. See Pass 6 for full analysis.

**5. Three separate HTML sanitizer allowlists — CONFIRMED**
- `api-server/src/lib/htmlSanitize.ts:18-53` — user-supplied template HTML (most permissive: includes `a`, `img`, `section`, `article`, `header`, `footer`, `main`, `blockquote`, `pre`, `code`). Used by `templates.ts:24,234`.
- `api-server/src/lib/sectionGeneration.ts:178-208` — LLM section fragment HTML (no `a` or `img`). Called at `sectionGeneration.ts:824`.
- `api-server/src/routes/inspections.ts:4959-4991` — compiled-report LLM fragment HTML (same restrictiveness as #2, no `a` or `img`, no `section`). Called at `inspections.ts:5391,5411`.

Additional restrictive inline calls in `inspections.ts`: `:8002,:8165,:8176,:8188,:8238` use `{ allowedTags: [], allowedAttributes: {} }` (strip-everything); `:11296-11299` allows only `['p','strong','em','br']` for attestation HTML.

The three substantive allowlists are intentionally different by surface (user templates are richest, LLM output is narrowest). The duplication of the `allowedStyles` regex map across #2 and #3 is a maintenance concern.

**6. contracts.templateId orphaned — CONFIRMED**
`lib/db/src/schema/rooftrax.ts:962`: `templateId: varchar('template_id')`, nullable, no Drizzle FK. Searched all of `artifacts/api-server/src` and `artifacts/rooftrax-web/src`:
- No read of `contractsTable.templateId` found anywhere.
- `TEMPLATE_USE_CASES` (`rooftrax.ts:554-563`) values: `forensic_report`, `proof_package`, `fipsa_agreement`, `estimate_proposal`, `homeowner_email`, `claim_supplement`, `change_order`, `other` — **no `'contract'` value**. The contract PDF is hardcoded in `contracts.ts`; `templateId` is never resolved to a template row.
**ORPHANED** — column exists, nothing reads it, no FK enforced.

**7. contract_selections.selected_by 'rep' path — CONFIRMED (calibration table name is incorrect)**
The calibration item says "change_orders.selected_by". That column does **not exist** on `changeOrdersTable` (`rooftrax.ts:765-813`). It exists on `contractSelectionsTable` (`rooftrax.ts:1009`): `selectedBy: varchar('selected_by').notNull()` with comment `// 'customer' | 'rep'`.

Write path: `contractPortal.ts:354-356`:
```ts
const isRepRequest = req.isAuthenticated && req.isAuthenticated();
const selectedBy   = isRepRequest ? 'rep' : 'customer';
```
The portal router does not require authentication. `req.isAuthenticated()` returns `false` for unauthenticated portal customers. A logged-in rep navigating to the portal URL while authenticated could trigger `'rep'`, but this requires deliberately mixing session and portal contexts. In practice the 'rep' branch is never reached via normal product flows. **BROKEN** (dead write path — `'rep'` can never be written through any product UI surface, only via a race of auth+portal contexts that has no product affordance).

**8. Deductible panel — CONFIRMED never built**
Searched `rooftrax-web/src` for any component or file named `Deductible`, `DeductiblePanel`, `DeductibleTab`. None found. Deductible is handled **inline only** in `LeadProfile.tsx:1945+` (insurance financials tile) and via payment type `'deductible'` in the ledger. No dedicated panel was built. **ORPHANED spec item.**

### Additional findings

**TODO / FIXME / stubs:**

| Site | Text |
|------|------|
| `inspections.ts:815` | `// TODO: push to CRM…` — CRM push on inspection create |
| `inspections.ts:3633` | Same TODO on inspection update |
| `App.tsx:27,146` | `import ComingSoon` / Integrations route renders `<ComingSoon />` |
| `pages/ReportsPage.tsx:6,12,26,62,69` | Entire Reports page is `<ComingSoon />` |
| `pages/settings/NotificationsTab.tsx:129,132` | `// coming soon` on daily/weekly frequency options (UI disabled, dispatch ignores them) |
| `pages/settings/SettingsPage.tsx:144-151` | Integrations tab stub renders `<ComingSoon />` |
| `components/dashboard/widgets/PlaceholderWidget.tsx` | Coming soon widget |
| `lib/api-client-react/src/custom-fetch.ts:116` | `// ReadableStream API is not implemented` |

**Brain courier remnants:** No source-code references found. Migration `011_drop_brain_delivery_columns.sql` dropped the columns. `docs/brain-extraction-seam.md` documents the seam architecture. No live code references. **Safe to ignore.**

**QuickAdd widget:** `QuickAddLeadModal.tsx` is active and wired. Not legacy.

---

## PASS 6 — SCHEMA & MIGRATION INTEGRITY

### 6a — Drizzle schema vs migration columns

No mismatches identified between schema definitions and migration DDL for tables reviewed. All tables in `rooftrax.ts` correspond to migrations in `data-migrations/`.

### 6b — Migration numbering

Full sorted list of `data-migrations/`:
```
0009_remediation_plan_vocab.sql            ← 4-digit prefix (anomaly)
001_backfill_object_ownership.sql
002_workflow_assignment_insurance_retail.sql
003_seed_founder_super_admin.sql
004_signed_agreements_partial_unique.sql
005_signed_agreements_emailed_at.sql
006_inspections_owner_email_scheduled_for.sql
007_inspections_ai_summary_companies_ai_settings.sql
008_inspections_compiled_report_path.sql
009_companies_report_branding.sql
010_estimate_and_price_book_unit.sql
011_drop_brain_delivery_columns.sql
012_inspections_compiled_report_versions.sql
013_inspections_report_lint_resolution.sql
014_inspections_unlock_log.sql
015_project_pipeline_stage_key_rename.sql
016_retail_pipeline_stage_key_rename.sql
017_comparison_set_captions.sql            ← DUPLICATE 017
017_standards_entries_title_column.sql     ← DUPLICATE 017
018_backfill_comparison_set_captions.sql   ← DUPLICATE 018
018_claim_supplements.sql                  ← DUPLICATE 018
019_lead_source_and_pm.sql
020_wave2b_user_profile_columns.sql
022_company_templates.sql                  ← GAP: 021 missing
023_payments_ledger.sql
024_customer_invoices.sql
025_vendor_expenses.sql
026_profitability_view.sql
027_profitability_view_margins.sql
028_change_orders_and_overhead.sql
029_profitability_view_step5.sql
030_change_order_line_items.sql
031_change_order_emailed_at.sql
032_insurance_columns.sql
033_selections_library.sql
034_jurisdiction_packs.sql
035_pipeline_stage_remap.sql
036_contracts.sql
037_retail_appointments.sql
038_claim_status_history.sql
039_notification_preferences.sql
040_user_push_tokens.sql
```

Issues:
- **DUPLICATE 017**: `017_comparison_set_captions.sql` and `017_standards_entries_title_column.sql`. A runner applying migrations in lexicographic order applies both under the same logical sequence position.
- **DUPLICATE 018**: `018_backfill_comparison_set_captions.sql` and `018_claim_supplements.sql`. Same problem.
- **GAP 021**: `020_…` is followed immediately by `022_…`. No `021_` file exists. May be intentional (skipped or applied out-of-band) — **UNCERTAIN**.
- **Prefix anomaly**: `0009_` sorts lexicographically before `001_` (since `'0' < '1'`). Any runner that sorts by filename puts `0009_` first, before `001_`. If that file has schema dependencies on tables created in `001_`+, it would fail on a fresh apply. **UNCERTAIN** (depends on runner ordering).

### 6c — Migration files outside data-migrations/

None found. `rg --files -g '*.sql' -g '!data-migrations/**'` returned no results.

### 6d — Missing indexes

**UNCERTAIN** — index definitions are in SQL migration files, not inspected inline. The following high-traffic filtered columns are candidates for missing index review: `stage_transitions.from_stage` / `to_stage` (dashboard aggregation), `notification_preferences(user_id, notification_type)`, `user_push_tokens(user_id)`, `pins.appointment_at` (calendar range queries). Cannot classify without reading the DDL of each migration.

### 6e — Values stored that are also derived elsewhere

- `change_orders.amount_cents` — stored but labeled "DERIVED — always the sum of `change_order_line_items.total_cents`; recomputed on every line-item write" (`rooftrax.ts:776-778`). Two sources of truth if the recompute ever fails. **MEDIUM** drift risk.
- Legacy `pins` varchar money columns vs payments ledger — `pins.contract_amount` is also written by contract signing, and cleared by void. **Two sources of truth** for contract value (varchar pin field vs profitability view from ledger). **MEDIUM.**

### 6f — Nullable columns treated as guaranteed

- `claim_status_history.to_status` is nullable (`rooftrax.ts:1031`: `varchar('to_status')` with comment `// null = status was cleared`). Application code that reads this column and assumes non-null would break. **UNCERTAIN** — would need to audit all readers.
- `claim_status_history.from_status` is nullable (`// null on first-ever set`). Same concern.
- `contracts.document_sha256`, `customer_signature_path`, `rep_signature_path` — nullable; signing flow gates on these being present before completing. This is intentional but readers must null-check.

---

## PASS 7 — TESTS

### 7a — Real test output

**`npx tsc --build --force` (from repo root):**
```
✅ Clean — zero errors
```

**`pnpm --filter @workspace/authz test`:**
```
✅  3 test files, 66 tests passed
    dashboard.test.ts (15), notifications.test.ts (15), permissions.test.ts (36)
```

**`cd artifacts/api-server && npx vitest run`:**
```
✅  45 test files, 639 tests passed
Duration: 26s
```

**Typechecks — all client artifacts:**
```
artifacts/rooftrax-web    npx tsc --noEmit   ✅ clean
artifacts/signing-portal  npx tsc --noEmit   ✅ clean
artifacts/photo-portal    npx tsc --noEmit   ✅ clean
artifacts/mobile          npx tsc --noEmit   ✅ clean
```

**`npx tsx artifacts/api-server/src/scripts/seed-acceptance-claim.ts`:**
```
BLOCKED — `tsx` not in shell PATH via `npx tsx` or `pnpm exec tsx` from workspace root.
Attempted: `npx tsx …`, `pnpm exec tsx …` (both fail). Would also require a live DB connection.
```

### 7b — Test files that don't compile or aren't picked up

None found. All 45 files picked up by vitest; all pass. No orphaned `.test.ts` files found outside the `__tests__/` directories.

### 7c — Assertions encoding changed behaviour

`src/routes/__tests__/legacy_money_read.test.ts:7-10,58-69` explicitly tests backward-compat of the legacy varchar pin money columns — these assertions correctly encode the legacy schema, not a regression.

No other tests found asserting superseded behaviour.

### 7d — Pass 4 chains with no automated test coverage

| Chain | Missing coverage |
|-------|-----------------|
| **D** — Selections → extended delta → contract total → **PDF schedule rendering** | No test traces the rendered PDF output against selection snapshot rows. The `recomputeContractTotals` path is tested, but the PDF rendering of the selections schedule is not. |
| **H** — FIPSA signed → pipeline auto-advance | **Chain itself is BROKEN** (no call to `advancePinStage` from `agreement.ts`). No test for auto-advance on FIPSA sign. |
| **J** — Mobile scheduled feed | Mobile artifact excluded from this audit per spec instruction ("mid-build and app-store bound"). |
| **K** — claim_status_history → Live Activity display | History write is tested implicitly via insurance route tests. Live Activity mobile consumption is not tested (mobile excluded). |

---

## FIX LOG

**No fixes were applied.**

Whitelist item #2 (hand-written queryKey → generated): all hand-written keys are for endpoints not in the OpenAPI spec. No generated `get*QueryKey` exists for any of them — replacement is impossible.

Whitelist item #4 (customFetch → generated hook): `useCompileReport` is the one case where the endpoint is specced, but the generated client emits only an underlying function (`api.ts:7215`), not a React mutation hook. A clean swap is not possible without writing a `useMutation` wrapper, which exceeds the whitelist scope.

Whitelist items #1, #3, #5: no stale docstrings, unused imports (tsc is clean with no `noUnusedLocals` violations), or user-facing typos were identified.

---

## FINDINGS TABLE

| Severity | Area | file:line | Finding | Evidence | Suggested fix |
|----------|------|-----------|---------|----------|---------------|
| **CRITICAL** | Migrations | `data-migrations/017_*.sql` (×2), `018_*.sql` (×2) | Duplicate migration prefix numbers — `017` and `018` each have two files. A runner applying in lexicographic order applies two files at the same logical position; out-of-order applies on a fresh DB will fail or corrupt schema. | `ls data-migrations/ \| sort` shows four duplicate-prefixed files | Renumber the later duplicate in each pair: rename `017_standards_entries_title_column.sql` → `017b_…` or reassign a clean number after `018`. Do the same for `018_backfill_comparison_set_captions.sql`. Verify `018_claim_supplements.sql` dependencies are not on backfill data. |
| **HIGH** | Business logic | `agreement.ts` (no pipeline call) / `pipelineEvents.ts:36-40` | **Chain H broken**: FIPSA signing never calls `advancePinStage`. After a FIPSA is signed, the pipeline stage does not automatically advance — reps must advance it manually. | `grep -n "advance\|pipeline\|stage" agreement.ts` returned 0 results for any `advancePinStage` call | Wire `await advancePinStage(…)` from the FIPSA `POST /agreements/:id/send` (or equivalent signing endpoint) after the signing transaction commits. |
| **HIGH** | Business logic | `contractPortal.ts:354-356` / `rooftrax.ts:1009` | `contract_selections.selected_by = 'rep'` is a dead write path. The `isRepRequest` branch is never reached via any product UI surface; portal routes are accessed without a session. | `req.isAuthenticated()` returns `false` for all normal portal requests; no product UI directs an authenticated rep to trigger a selection via the portal endpoint | Either remove the `'rep'` branch and document that all portal selections are `'customer'`, or add a separate authenticated rep-selection endpoint and direct the rep-assisted flow there. (Calibration item 7 — table name in spec is `change_orders`, actual column is `contract_selections`.) |
| **HIGH** | Data integrity | `rooftrax.ts:182-191`, `profitability_view.sql`, `contractPortal.ts:519-548`, `contracts.ts:637-642` | Two sources of truth for contract value: `pins.contract_amount` (varchar, written/cleared by contract sign/void) AND the profitability view which re-derives it. If the view SQL and the signing write-back ever diverge (e.g. the view formula changes but the varchar write-back does not), they report different values to different surfaces. | Calibration item 2 — legacy varchar still written on sign, view also computes contract value | Long-term: remove the signing write-back to `pins.contract_amount` and have all callers use the profitability view. Short-term: add a test asserting both values agree after sign and void. |
| **MEDIUM** | API spec drift | `claimHubApi.ts` (entire file, 911 lines) | ~30 endpoints are implemented on the server, consumed by the client, but absent from `openapi.yaml`. All typing is hand-maintained. Any schema change silently diverges. | Calibration item 1 — P2 inventory | Add the unspecced routes to `openapi.yaml` incrementally and regenerate; retire `claimHubApi.ts` hooks in favour of generated ones as each is specced. |
| **MEDIUM** | API spec drift | `ahjWizard.ts`, `agreement.ts`, `companies.ts` sub-routes, `pins.ts` file/lead routes | ~20 additional route families not in `openapi.yaml` (see Pass 1 table) | Pass 1 inverse check | Spec them alongside `claimHubApi.ts` routes. |
| **MEDIUM** | Schema | `rooftrax.ts:962`, `contracts.ts:103-144` | `contracts.templateId` is an orphaned column. Nothing reads it, `TEMPLATE_USE_CASES` has no `'contract'` value, the PDF is hardcoded. | Calibration item 6 — searched all of `api-server/src` and `rooftrax-web/src` | Either populate and use it (add `'contract'` to `TEMPLATE_USE_CASES`, wire the resolution in `contracts.ts`) or drop the column in a new migration. |
| **MEDIUM** | Data integrity | `rooftrax.ts:776-778`, `changeOrders.ts` | `change_orders.amount_cents` is labeled "DERIVED — always the sum of line items; recomputed on every line-item write." If a line-item write fails after insert but before recompute, the stored total is stale. | Schema comment at `rooftrax.ts:776-778`; no idempotent recompute guard found in test suite | Add a test that verifies `amount_cents` stays correct if a recompute throws mid-write. Consider a DB trigger as a fallback. |
| **MEDIUM** | Auth/roles | `inspections.ts:787`, `selections.ts:20,30`, `bugReports.ts:35-36`, `companies.ts:69` etc. | Inline role comparisons use raw string arrays/literals instead of `roleRank` from `@workspace/authz`. A new role inserted into the hierarchy would not automatically be included. | Pass 3b — searched all route files | Replace inline arrays/comparisons with `isManagerOrAdmin`, `roleRank`, or the existing authz helpers. |
| **MEDIUM** | Migration integrity | `data-migrations/` | GAP: `021_` is missing between `020_` and `022_`. Ambiguous whether skipped intentionally or lost. | `ls data-migrations/ \| sort` | Confirm in version history whether `021_` was intentionally skipped or was lost. Add a README note. |
| **MEDIUM** | Migration integrity | `0009_remediation_plan_vocab.sql` | 4-digit prefix sorts **before** `001_` in lexicographic order. On a fresh apply, this runs first — before tables it may depend on are created. | `ls \| sort` output — `0009_` appears first | Rename to `009b_remediation_plan_vocab.sql` or otherwise resolve the prefix anomaly. Verify there are no forward dependencies. |
| **MEDIUM** | Missing feature | `rooftrax-web/src/` | Deductible panel was specified but never built. Deductible is only handled inline in `LeadProfile.tsx` and via the payment ledger type `'deductible'`. No `DeductiblePanel` component exists. | Calibration item 8 — grep found zero results for any deductible panel/component | Build the panel or formally descope and remove the spec item. |
| **MEDIUM** | Test coverage | Pass 4 chains | Chain D (PDF selections schedule), Chain H (FIPSA→pipeline, chain is broken), Chain K (mobile live activity) have no automated test coverage. | Pass 7d analysis | Add integration tests for Chain D PDF output; Chain H is moot until wired. |
| **LOW** | Legacy | `rooftrax.ts:182-191` | Seven varchar money columns on `pins` are still written/read despite the payments ledger superseding them. `LeadProfile.tsx:748-803` and `claimHubApi.ts:518-527` are live readers. | Calibration items 2 and 3 | After all display surfaces are migrated to the ledger, add a migration to drop the varchar columns. `legacy_money_read.test.ts` can then be retired. |
| **LOW** | Legacy | `retailData.appointmentDate` | Still read in `LeadProfile.tsx:748-803` and `inspections.ts` for legacy context. `pins.appointment_at` is the canonical column. `calendar.ts` correctly uses `appointmentAt`. | Calibration item 3; Pass 5 | Migrate `LeadProfile` display to use `appointmentAt`; remove `retailData.appointmentDate` reads. |
| **LOW** | Dead code | `inspections.ts:815,3633` | `// TODO: push to CRM…` — CRM push on inspection create/update is not implemented. | grep — two hits | Implement or formally remove the TODO. |
| **LOW** | Dead code | `App.tsx:146`, `ReportsPage.tsx`, `SettingsPage.tsx:144-151`, `NotificationsTab.tsx:129,132` | ComingSoon stubs for Reports page, Integrations tab, and daily/weekly notification frequency. | grep ComingSoon; code review | Track as product backlog; add a code comment citing the task. |
| **LOW** | Sanitizer duplication | `sectionGeneration.ts:191-205`, `inspections.ts:4973-4987` | The `allowedStyles` regex map is copy-pasted verbatim in two LLM-output sanitizers. A change to allowed styles must be made in both places. | Pass 5 calibration item 5 — direct comparison of the two blocks | Extract into `htmlSanitize.ts` as a shared `LLM_ALLOWED_STYLES` constant. |
| **LOW** | Tenancy | `rooftrax.ts:59` | `user_profiles` has no `company_id`. Tenancy relies entirely on the authenticated actor using their own `userId`. Any future route that resolves a profile by a caller-supplied `userId` without a same-company check would leak cross-tenant profile data. | Pass 3a | Add a `company_id` FK to `user_profiles` and enforce it in queries, OR add a middleware helper that asserts same-company before resolving a third-party profile. |

---

## ORPHANS AWAITING A DECISION

| Item | What it is | Why it can't be wired without a human decision |
|------|-----------|-----------------------------------------------|
| `contracts.templateId` (`rooftrax.ts:962`) | Nullable varchar column; FK exists in SQL migration but not in Drizzle schema; `TEMPLATE_USE_CASES` has no `'contract'` value. | Cannot determine from code whether the intent was (a) let reps attach a template to a contract for PDF generation, or (b) the feature was abandoned. A wrong wire would make contracts render from a template instead of the hardcoded layout. |
| `contract_selections.selected_by = 'rep'` (`rooftrax.ts:1009`; `contractPortal.ts:354`) | The `'rep'` branch is reachable if a logged-in rep hits the portal selection endpoint directly. No product UI surface does this today. | Cannot determine if `'rep'` selections were intended for a rep-assisted contract-build flow that was planned but not built, or if the branch is genuinely vestigial. |
| `inspections.ts:815,3633` `TODO: push to CRM` | Two identical TODOs on inspection create/update — CRM push is not implemented. | Cannot determine which CRM system was intended, what payload should be sent, or whether this is still a product requirement. |
| Daily/weekly notification frequency (`NotificationsTab.tsx:129,132`; `notify.ts` dispatch) | The `frequency` column stores `immediate | daily | weekly | off`; the dispatch layer only acts on `immediate` and `off`. Frequency UI options are commented `// coming soon`. | Cannot determine the digest grouping logic, send schedule, or whether a background scheduler exists for this. Requires product + infrastructure decision. |

---

## BLOCKED

| Item | Blocked by |
|------|-----------|
| `npx tsx artifacts/api-server/src/scripts/seed-acceptance-claim.ts` | `tsx` not resolvable via `npx tsx` or `pnpm exec tsx` from workspace root. Also requires a live DB connection with the full schema applied. Could not verify seed script runs cleanly on a clean acceptance schema. |
| Index coverage check (Pass 6d) | Index definitions are in the SQL migration files, not in Drizzle schema. Would require reading and parsing each migration's `CREATE INDEX` statements — not done in this run. |
| Mobile live activity consuming `claim_status_history` (Chain K) | Mobile artifact explicitly excluded from this audit ("mid-build and app-store bound"). |
| Mobile scheduled feed consuming calendar endpoint (Chain J) | Mobile artifact excluded. |

---

## NOT AUDITED

| Area | Why |
|------|-----|
| `artifacts/mobile/` (all files) | Explicitly excluded by audit spec: "mid-build and app-store bound." Mobile tsc was run (clean) but no route, logic, or hook wiring was verified. |
| `lib/api-spec/openapi.yaml` request/response schema correctness | Audited for path presence only. Whether individual request/response schemas accurately reflect the server's Zod shapes was not checked. |
| SQL index definitions in migration files | Not read. Pass 6d finding is UNCERTAIN as a result. |
| `artifacts/api-server/src/scripts/` other scripts | Only `seed-acceptance-claim.ts` was attempted; other scripts not reviewed. |
| `docs/` directory | Not audited. Brain seam doc noted in Pass 5 only as confirmation no live code references remain. |
| Profitability view SQL correctness | The formula in `data-migrations/029_profitability_view_step5.sql` was not independently verified against the business intent. The view is confirmed to exist and be consumed; its arithmetic was not audited. |
| Rate limiting on portal endpoints | `guardRateLimit` is present on portal routes. Its configuration (limit values, window, storage backend) was not audited. |
| SMTP guard (SSRF protection) | `smtpGuard` exists in `notify.ts`. Its implementation was not audited for correctness. (Memory entry `user-supplied-smtp.md` notes this requires DNS-vetted guard.) |
