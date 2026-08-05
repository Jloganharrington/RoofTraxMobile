---
name: Lead Source + PM Tracker
description: DB columns, API routes, and UI for the lead file-handler tracker (Lead Source / Sales Rep / PM).
---

## What was added

**DB columns** — `data-migrations/019_lead_source_and_pm.sql` (applied):
- `pins.external_lead_source` varchar nullable — null = canvassed lead; non-null = external source label
- `pins.project_manager_name` varchar nullable — denormalized PM display name
- `companies.lead_sources` jsonb nullable — array of company-configured source names; null means use built-in defaults

**lib/db schema** — `lib/db/src/schema/rooftrax.ts` (pinsTable) and `auth.ts` (companiesTable) updated; rebuilt with `tsc --build --force`.

**API routes**:
- `GET/PATCH /api/companies/:companyId/lead-sources` in `artifacts/api-server/src/routes/companies.ts`
  - Returns `{ leadSources: string[] }`; null DB value returns built-in defaults
  - PATCH requires manager+ role
  - Built-in defaults: `["Angi's", "Yelp", "Call-In", "Website"]`
- `POST /api/pins` — accepts `externalLeadSource` in body
- `PATCH /api/leads/:id/profile` (`LeadProfileBody`) — accepts `externalLeadSource` + `projectManagerName`

**Generated type files updated manually** (orval not run — no standalone config):
- `lib/api-zod/src/generated/api.ts` — `CreatePinBody` zod schema
- `lib/api-zod/src/generated/types/createPinInput.ts` — `CreatePinInput` TS interface
- `lib/api-client-react/src/generated/api.schemas.ts` — `CreatePinInput` TS interface
- Both lib packages rebuilt with `tsc --build --force` after edits

**Web — Lead Profile tracker** (`artifacts/rooftrax-web/src/pages/leads/LeadProfile.tsx`):
- `FormState` + `initForm` + `TAB_FIELDS.dashboard` include `externalLeadSource` + `projectManagerName`
- `DashboardTab` gains `isManager` prop + `useGetLeadSources(lead.companyId)` call
- "File Handlers" section rendered inside the info panel (below Lead Type): Lead Source (dropdown for managers, readonly for reps), Sales Rep (read-only from `lead.repName`), Project Manager (text input for managers)
- `isManager` derived from `userRole` in main LeadProfile component

**Web — Settings** (`artifacts/rooftrax-web/src/pages/settings/SettingsPage.tsx`):
- `Lead Sources` card added to `CompanyProfileTab`
- Uses `useGetLeadSources` / `useUpdateLeadSources` from `claimHubApi.ts`
- Add/remove/rename + Save Lead Sources button

**claimHubApi.ts** additions:
- `useGetLeadSources(companyId)` — GET `/api/companies/:companyId/lead-sources`
- `useUpdateLeadSources(companyId)` — PATCH same endpoint
- `DEFAULT_LEAD_SOURCES` exported constant
- `externalLeadSource` + `projectManagerName` added to `FullLead` interface

**Mobile — pin-new.tsx** (`artifacts/mobile/app/pin-new.tsx`):
- `companyId` added to `useProfile()` destructure
- `useQuery` fetches lead sources from `/api/companies/:companyId/lead-sources`
- Lead Source picker shows "Canvassing" (→ null) + company sources as chips, right after Workflow picker
- `externalLeadSource: leadSource ?? undefined` passed to `useCreatePin`

**Why:** externalLeadSource = null means "canvassed by the rep who dropped the pin"; non-null means the lead came from an external source. The tracker gives managers at-a-glance visibility of who owns each file from first contact through project management.

**How to apply:** When adding new fields to the file-handler chain, update FullLead, FormState, TAB_FIELDS, the API routes, and both generated type files (api-zod + api-client-react) manually, then rebuild both lib packages.
