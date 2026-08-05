# RoofTrax Web — Route Inventory

Generated from audit on 2026-08-05. Diff this file against itself on the next audit instead of starting from scratch.

---

## Legend

| Field | Values |
|---|---|
| **Entry point** | `nav` = sidebar nav item · `lead-profile` = Lead Profile tab · `deep-link` = URL only · `none` = unreachable from UI |
| **Disposition** | `active` · `redirect` · `coming-soon` · `flagged-stale` |

---

## Routes

### Core Navigation

| Path | Component | Purpose | Entry point | Data hooks / endpoints | Disposition |
|---|---|---|---|---|---|
| `/` | `Home` | Marketing landing page; authenticated users are redirected to their last-visited pipeline (localStorage `rt_last_pipeline`, default `/insurance-pipeline`) | nav → Dashboard | `useGetCurrentAuthUser` | active |
| `/retail-pipeline` | `RetailPipeline` | 10-stage kanban for retail restoration leads. Exit tasks inline per card. | nav → Retail Pipeline | `useGetRetailPipeline` → `GET /api/retail-pipeline` | active |
| `/insurance-pipeline` | `InsurancePipeline` | 15-stage kanban for insurance restoration leads, including loop stages and auto-advance. | nav → Insurance Pipeline | `useGetPipeline` → `GET /api/pipeline` | active |
| `/project-pipeline` | `ProjectPipeline` | 8-stage kanban for active projects converted from retail or insurance. | nav → Project Pipeline | `useGetProjectPipeline` → `GET /api/project-pipeline` | active |
| `/leads` | `Leads` | Unified read-only list of all pins/leads across all three pipelines. | nav → All Leads | `useGetLeads` → `GET /api/leads` | active |
| `/leads/:id` | `LeadProfile` | Full lead record with tabs: Dashboard, Proof Package Builder, Insurance, Financials, Communication, Selections & Scope, Files. | row click from `/leads`; pipeline cards → "Open" | `useGetLead`, `useGetLeadFiles`, `useGetSamplePackageInfo`, `useRecheckAhj`, `useUpdateLead` | active |
| `/map` | `MapPage` | Territory map showing all pins as dots; managers see rep GPS locations. | nav → Map View | `GET /api/pins`, `GET /api/team/locations` | active |
| `/team` | `TeamList` | Team roster with role/department management and access level editing. | nav → Team Management | `useListTeamUsers`, `PATCH /api/team/:userId` | active |
| `/user-authorization` | `UserAuthorizationPage` | Read-only permissions matrix showing which capabilities each role has. | nav → User Authorization | `useListTeamUsers` (display only) | active |
| `/price-book` | `PriceBookList` | Company price book — view and manage line-item catalog. | nav → Price Book | `GET /api/price-book` | active |
| `/settings` | `SettingsPage` | Company profile, branding (report colors, logo), and preferences. | nav → Settings | `GET/PATCH /api/settings` | active |
| `/settings/library` | `LibraryPage` | Proof Package Data — boilerplate, AHJ packs, and the AI bulk-import wizard. | nav → Proof Package Data | `GET /api/library/*`, `ProofPackageWizard` (child component) | active |
| `/settings/library/ahj-wizard` | `AhjWizardPage` | Step-by-step AHJ pack builder. | deep-link from LibraryPage | `GET/POST /api/ahj` | active |

### Coming-Soon Placeholders

| Path | Component | Nav label | Disposition |
|---|---|---|---|
| `/team-calendar` | `ComingSoon` | Team Calendar | coming-soon |
| `/templates` | `ComingSoon` | Templates | coming-soon |
| `/reports` | `ComingSoon` | Reports | coming-soon |
| `/commission-report` | `ComingSoon` | Commission Reports | coming-soon |
| `/integrations` | `ComingSoon` | Integrations | coming-soon |
| `/notifications` | `ComingSoon` | Notifications | coming-soon |

### Legacy / Redirect Routes

| Path | Component | Behaviour | Disposition |
|---|---|---|---|
| `/pipeline` | `Pipeline` | Redirects to `/insurance-pipeline` | redirect |
| `/inspections` | `InspectionList` | Redirects to `/leads` (old entry point, kept for backward compat) | redirect |
| `/inspections/:id` | `ClaimHub` | Fetches inspection, redirects to `/leads/:pinId`; shows spinner while resolving | redirect |
| `/inspections/:id/summary` | `Summary` | Legacy sub-page; navigable via direct link only | flagged-stale |
| `/inspections/:id/estimate` | `Estimate` | Legacy sub-page; navigable via direct link only | flagged-stale |
| `/inspections/:id/curation` | `PhotoCuration` | Legacy sub-page; navigable via direct link only | flagged-stale |

### Internal / Not in Nav

| Path | Component | How reached | Disposition |
|---|---|---|---|
| `/sample-package` | `SamplePackagePage` | Deep-link (testing/demo only); not in sidebar | active (internal) |

---

## Lead Profile Tabs

The Lead Profile (`/leads/:id`) renders tabs conditionally:

| Tab | Condition | Key components |
|---|---|---|
| Lead Dashboard | Always | Summary cards, pipeline stage, rep info |
| Proof Package Builder | Has linked inspection | `InspectionFlowWizard` |
| Insurance | `workflow === 'insurance'` | Claim fields, adjuster info |
| Financials | Always | Contract, deposit, RCV/ACV amounts |
| Communication | Always | Notes, contact log |
| Selections & Scope | Always | Material selections |
| Files | Always | `FilesTab` — presigned GCS upload/download |

---

## Removed Hooks (2026-08-05)

These hooks were removed from `src/lib/claimHubApi.ts` as they had zero callers:

| Hook | Reason |
|---|---|
| `useGetSamplePackage` | Deprecated; superseded by `useGetSamplePackageInfo` |
| `useAdvanceLeadStage` | Never called; advance-stage done via pipeline widget hooks |

---

## Data Dependencies by Endpoint

| Endpoint | Callers |
|---|---|
| `GET /api/retail-pipeline` | `useGetRetailPipeline` (RetailPipeline) |
| `GET /api/pipeline` | `useGetPipeline` (InsurancePipeline) |
| `GET /api/project-pipeline` | `useGetProjectPipeline` (ProjectPipeline) |
| `GET /api/leads` | `useGetLeads` (Leads, LeadProfile sidebar count) |
| `GET /api/leads/:id` | `useGetLead` (LeadProfile) |
| `PATCH /api/leads/:id/advance-stage` | `useAdvanceRetailStage`, `useAdvanceInsuranceStage`, `useAdvanceProjectStage` |
| `GET /api/leads/:id/files` | `useGetLeadFiles` (LeadProfile → FilesTab) |
| `POST/PATCH/DELETE /api/leads/:id/files` | `useRegisterLeadFile`, `useRenameLeadFile`, `useDeleteLeadFile` |
| `GET /api/leads/my-pin-updates` | `useMyPinUpdates` (mobile DashboardScreen) |

---

## Schema Notes

### Pins table — pipeline-specific columns added 2026-08-05

| Column | Type | Purpose |
|---|---|---|
| `stage_entered_at` | `timestamptz` | When pin entered current pipelineStage |
| `loop_next_action_at` | `timestamptz` | Due date for loop-stage action |
| `loss_reason` | `varchar` | Why a lead was archived as lost |
| `source_pipeline` | `varchar` | 'retail' or 'insurance' (for project-pipeline provenance) |
| `needs_stage_review` | `boolean` | Set when null pipelineStage was auto-mapped to pin_dropped |
| `is_demo` | `boolean` | Seeded/demo data — hideable via "Hide demo" toggle |

### Tables added 2026-08-05

| Table | Purpose |
|---|---|
| `stage_transitions` | Append-only log of every pipeline stage advance; powers `my-pin-updates` feed |
| `lead_files` | Pin-scoped file attachments (presigned GCS) |
