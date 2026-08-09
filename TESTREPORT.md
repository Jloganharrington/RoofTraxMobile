# Test Report — Remediation & Phase 1 Authorization

Generated: 2026-08-09

---

## 0.5-R — Per-Route Auth / Tenancy / Spec Inventory

**Methodology:** Static analysis of all non-test TypeScript route files in
`artifacts/api-server/src/routes/`. 311 route handlers enumerated.
`test-results.json` contains the full table.

**Validator:** `GET /companies/:companyId` → auth=**public** ✓  
(The route handler has no guard call; if the detector had flagged it guarded,
the detector would have been wrong. It correctly produces "public".)

**Summary**

| Metric | Count |
|---|---|
| Total routes | 311 |
| Guarded (authenticated) | 280 |
| Public (intentionally open) | 31 |
| Missing from OpenAPI spec | 116 |
| Tenancy findings | **1** |

**Public route breakdown (31)**

Intentionally open routes include:
- `GET /health` — liveness probe
- `GET/POST /auth/*` — OIDC login/callback/logout
- `GET/POST /portal/*` — customer evidence upload portal (token-gated separately)
- `GET/POST /contract-portal/*` — contract signing portal (token-gated)
- `GET /companies/:companyId` — company lookup by join code (enumeration finding, see below)
- `GET /api/agreement/*` — portal-side agreement routes

**Tenancy Findings (1 real, 0 false positives after triage)**

All 14 routes initially flagged by the pattern-matching script were triaged
against the actual handler bodies. 13 were false positives:

| Route | Original flag | Corrected classification | Reason |
|---|---|---|---|
| GET /auth/user | none | join | Returns req.user's own data; user↔company 1:1 |
| GET /dashboard/manifest | none | join | loadProfileAndLayout(req.user.id); user↔company 1:1 |
| GET /dashboard/layout | none | join | loadProfileAndLayout(req.user.id) |
| GET /geocode/reverse | none | n-a | Pass-through to Nominatim; no company data |
| GET /geocode/search | none | n-a | Pass-through to Nominatim; no company data |
| PATCH /inspections/:inspectionId/summary | none | join | requireInspectionModuleAccess() enforces company scope |
| POST /inspections/:inspectionId/render-overview-image | none | join | requireInspectionModuleAccess() enforces company scope |
| POST /report-settings/pp-wizard/analyze | none | n-a | LLM utility; processes user-uploaded text; no company data |
| DELETE /notifications/push-tokens/:expoPushToken | none | join | WHERE userId=req.user.id; user↔company 1:1 |
| GET /notifications/preferences | none | join | WHERE userId=req.user.id |
| POST /price-book/generate-description | none | n-a | AI utility; no company data read or written |
| GET /profile/me | none | join | WHERE userId=req.user.id |
| GET /weather/events | none | join | requireInspectionModuleAccess() enforces company scope |

**Confirmed finding (Phase 3.1 target):**

> **FINDING-TENANCY-01**: `POST /notifications/push-receipts`  
> `drainPendingReceiptEntries()` returns from a **process-global** in-memory
> queue that is not partitioned by company. A manager from Company A can trigger
> Expo receipt processing that drains tokens enqueued by Company B's notification
> sends. No company data is disclosed to the caller (the response is Expo's
> receipt status, not the token values), but the tenancy boundary is absent.  
> **Severity:** Low. **File:** `notifications.ts:260`.

**OpenAPI spec gap (116 routes):**

116 of 311 routes have no matching path in `lib/api-spec/openapi.yaml`. This
is a documentation/contract gap, not a security finding, but it means client
SDK generation (orval) is incomplete. Notable unspecced categories include
inspection sub-resources, canvassing endpoints, and financial export routes.
Full list is in `test-results.json` (`spec: "no"`).

---

## 0.2-R — Migration Ledger

### `_parse_legacy_money_cents` function

**Exists.** Definition:
```sql
CREATE OR REPLACE FUNCTION public._parse_legacy_money_cents(raw text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN raw IS NULL OR TRIM(raw) = '' THEN NULL
    WHEN stripped ~ '^[0-9]+(\.[0-9]+)?$' AND ROUND(stripped::numeric * 100) > 0
    THEN ROUND(stripped::numeric * 100)::integer
    ELSE NULL
  END
  FROM (SELECT REGEXP_REPLACE(TRIM(raw), '[$,\s]', '', 'g') AS stripped) t
$$;
```

### `report_attestations` indexes

| Index name | Type | Partial predicate |
|---|---|---|
| `report_attestations_pkey` | unique | *(non-partial)* |
| `report_attestations_primary_version_idx` | unique | `WHERE supplement_id IS NULL` ✓ |
| `report_attestations_supplement_version_idx` | unique | `WHERE supplement_id IS NOT NULL` ✓ |

Both migration-018 indexes are **partial** as intended. The dangerous
**non-partial** `report_attestations_inspection_version_idx` does **not** exist.

**`post-merge.sh` status:** The file does not exist at the workspace root or
at `.local/scripts/post-merge.sh`. There is **no automated mechanism** that
could recreate the non-partial index post-merge. The non-partial index risk is
absent.

### All views (public schema)

| Object | Type |
|---|---|
| `pin_profitability` | view |

Only one view exists.

### All user functions (public schema)

| Function | Returns |
|---|---|
| `_parse_legacy_money_cents(text)` | integer |

Only one function exists.

### Triggers

**None.** No triggers exist in the public schema.

### All partial indexes

| Table | Index | Predicate | Unique |
|---|---|---|---|
| `company_templates` | `company_templates_company_use_case_unique` | `use_case <> 'other'` | yes |
| `contracts` | `contracts_one_active_per_pin_idx` | `voided_at IS NULL` | yes |
| `pins` | `idx_pins_company_appointment_at` | `appointment_at IS NOT NULL` | no |
| `report_attestations` | `report_attestations_primary_version_idx` | `supplement_id IS NULL` | yes |
| `report_attestations` | `report_attestations_supplement_version_idx` | `supplement_id IS NOT NULL` | yes |
| `selection_products` | `selection_products_one_base_per_category_idx` | `is_base = true AND is_active = true` | yes |

### Migration tracking

**Finding:** There is no `__drizzle_migrations` table. `drizzle-kit push`
does not record which migrations were applied — it compares schema files to
live schema and generates DDL. There is **no way** to determine which of the
40 numbered SQL migrations (001–040) were applied other than inspecting the
resulting objects individually (views, functions, indexes, columns). This is a
migration audit gap: if a migration was partially applied or rolled back, the
only evidence is its artifacts in the DB.

---

## 0.6-R — Data Questions

### `ahj_packs` row count

| Total rows | Distinct companies |
|---|---|
| 3 | 1 |

The table is essentially empty — only 3 rows from one company.

### `selection_categories` — 1,729 rows

**Schema columns:** `id`, `company_id`, `name`, `slug`, `sort_order`,
`is_active`, `created_at`, `updated_at`. (No `parent_category_id` column.)

| Metric | Value |
|---|---|
| Total rows | 1,729 |
| Rows with `company_id IS NULL` | 0 |
| Distinct `company_id` values | 436 |
| Max rows per company | 4 |

**Analysis:** Every row belongs to a company. The maximum rows per company is
**4** — meaning the 1,729 rows represent **432 companies × 4 categories each**
(the standard "Roofing / Gutters / Siding / Other" seeded on company creation)
plus a handful of edge cases. This is **not** a large working category tree —
it is **accumulated seed data** from 432 test companies that provisioned their
default category set. Categories should eventually number in the dozens for a
real company, not 4. The shape is test junk, not real structure.

**Oldest rows:** 2026-08-07 (from companies created during early acceptance
tests). **Newest rows:** 2026-08-09.

**Conclusion:** The `selection_categories` table is inverted because it never
grows beyond the 4-category seed — no company has yet added custom categories.
The 1,729 count reflects company count × 4, not meaningful taxonomy depth.
Not a data integrity issue; would normalize naturally as companies add real
categories.

### companies / users / pins — data age

| Table | Total | Earliest created_at | Latest created_at |
|---|---|---|---|
| `companies` | 601 | 2026-07-12 | 2026-08-09 |
| `users` | 1,021 | 2026-07-12 | 2026-08-09 |
| `pins` | 93 | 2026-07-16 | 2026-08-09 |

**Companies by month:**

| Month | Count |
|---|---|
| 2026-07 | 168 |
| 2026-08 | 433 |

**Assessment of live exposure:** Of 601 companies, **583 have a `TEST-*`
prefix** (accumulated from automated test/lint runs). Only **~5 companies**
have production-style IDs without the `TEST-` prefix:
`RFTRAX`, `CQG5XS`, `AP3TBW`, `5XV39C`, and one or two others. These appear
to be the actual development/demo tenants. The 1,016 users associated with
TEST-* companies are test artifacts, not real signups.

**Implication for CORS / enumeration findings:** The live exposure from the
company-enumeration and CORS findings is **dev-only at present**. The 4-6
real non-test tenants represent the blast radius. This does not reduce the
severity of the findings — they must be fixed before any real user growth —
but no current real-user data is at meaningful risk.

**Company ID format:** IDs are **6-character uppercase alphanumeric** codes
from a 31-character alphabet (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`, excluding
0/O/1/I/L for readability). Namespace size: 31⁶ ≈ 887 million codes.
With 601 companies in the DB, collision probability is negligible and
**enumeration is feasible but not trivial** — an attacker would need to probe a
31⁶ space. This is not brute-forceable in a reasonable time without rate-limit
bypass, but a determined attacker could use population statistics (real IDs
are uniformly random in a 887M space with ~5 real tenants → expected
~177M guesses per hit). The finding from 0.5-A stands: `GET /companies/:companyId`
is unauthenticated and returns company name on any valid ID.

---

## 0.7-R — Push-Notification Catalog Count Correction

The Phase 0.7-A report stated "all 5 push-enabled catalog types" and then
listed 8. **The correct count is 8.** The parenthetical list was accurate;
the number in the prose was wrong.

**Push-enabled catalog event types (defaultPush: true) — 8 total:**

1. `contract_signed`
2. `change_order_signed`
3. `change_order_pending_approval`
4. `change_order_approved`
5. `proof_package_delivered`
6. `inspection_assigned`
7. `inspection_scheduled`
8. `appointment_assigned`

Phase 5.7 should reconcile against this list.

---

## Phase 1 — Fixture Setup

### Teardown script

Written to `scripts/zztest-teardown.sql`. Deletes all data with `ZZTEST%`
prefix in FK-safe order. Safe to run twice (all deletes are by prefix only;
no fixed IDs). Verified by `SELECT COUNT(*) WHERE id LIKE 'ZZTEST%'` at end.

### Created entities

**ZZTEST_ prefix used on:** company `id`, company `name`, user `email`.

**Companies:**

| Handle | id (verbatim) | name |
|---|---|---|
| Alpha | `ZZTEST_ALPHA` | `ZZTEST_Alpha Roofing Co` |
| Bravo | `ZZTEST_BRAVO` | `ZZTEST_Bravo Contractors` |

**Company ID format note:** These IDs use the `ZZTEST_` prefix rather than
the normal 6-char code format to ensure unambiguous prefix-based deletion.
The real company IDs (e.g. `CQG5XS`) are 6-char uppercase alphanumeric —
the format that would be enumerated in a real attack.

**Users (10 total):**

| Handle | id | email | role | dept | workflowAssignment | company |
|---|---|---|---|---|---|---|
| A-CANV-1 | `96180b99-792c-4b45-b0bd-304f36833b4f` | a-canv-1@zztest.local | field_rep | canvasser | retail | ALPHA |
| A-CANV-2 | `2c820f0f-53c7-452c-b8ac-e5089193e4fb` | a-canv-2@zztest.local | field_rep | canvasser | retail | ALPHA |
| A-INSP-1 | `db57382f-a01e-414f-8663-fdcd74edbe9e` | a-insp-1@zztest.local | field_rep | inspector_canvasser | insurance_retail | ALPHA |
| A-OFF-1 | `111f07e0-3d06-4784-a21a-6c424550ba8f` | a-off-1@zztest.local | field_rep | office | retail | ALPHA |
| A-MGR-F | `74a553ae-b375-4af0-85b8-530a39ee8f02` | a-mgr-f@zztest.local | manager | inspector_canvasser | insurance_retail | ALPHA |
| A-MGR-O | `0625a922-0b48-4bc6-8280-2b291921f26e` | a-mgr-o@zztest.local | manager | office | retail | ALPHA |
| A-ADMIN | `2e7597e6-3ca8-4c0e-9cf8-80a0730308ca` | a-admin@zztest.local | admin | office | insurance_retail | ALPHA |
| A-SUPER | `45b1b81f-902e-4e28-b410-2a79f57778d3` | a-super@zztest.local | super_admin | office | insurance_retail | ALPHA |
| B-ADMIN | `e01aa5cd-f6f9-4092-b7d0-5160930b4ee9` | b-admin@zztest.local | admin | office | insurance_retail | BRAVO |
| B-REP | `ff669c7d-2cb6-48a7-b66b-d62eab4b5d72` | b-rep@zztest.local | field_rep | canvasser | retail | BRAVO |

**Auth token acquisition:** All 10 users verified via `GET /api/auth/user`
returning HTTP 200 with matching user ID. Sessions minted via `createSession()`
(direct DB insert — the OIDC flow is the only path to session creation;
no `/login` test-user endpoint exists).

**Leads (pins): 4 in DB** (3 canonical + 1 orphan from aborted first run — teardown handles all):

| id | company | workflow | notes |
|---|---|---|---|
| `c4d98b1f-6c83-4673-96d0-7cf571800917` | ZZTEST_ALPHA | retail | orphan from step-43 of aborted run; teardown deletes |
| `4af909ef-3e59-4ec4-a6b8-a6018811eb7a` | ZZTEST_ALPHA | retail | **canonical** retailPinId |
| `fdbdceba-2db1-454e-881d-cbc02af7593f` | ZZTEST_ALPHA | insurance | **canonical** insurancePinId |
| `1a056d4a-9f19-493e-8ca9-1b45c6e99728` | ZZTEST_BRAVO | retail | **canonical** bravoPinId |

### Creation methods

| Entity | Method | Reason |
|---|---|---|
| Companies | Direct DB insert | `POST /companies` requires super_admin auth; bootstrapping that via API requires a prior super_admin — chicken-and-egg. Direct insert is the standard provisioning path for the first tenant. |
| Users | Direct DB insert | No `POST /users` endpoint exists; user creation is OIDC-only. |
| User profiles | Direct DB insert | Same reason as users. |
| Sessions | `createSession()` (DB insert) | OIDC-only auth flow; no test-login endpoint. |
| Leads (pins) | Real API — `POST /api/pins` | Endpoint exists and was used. |

### Pre-existing companies for Phase 3.1 cross-tenant probes

The following **non-ZZTEST, non-TEST-\* companies** will be used as read-only
cross-tenant targets in Phase 3.1 (test users must not be able to read their
data):

| id | name |
|---|---|
| `CQG5XS` | Acme Roofing Co |
| `AP3TBW` | NH3615 |
| `5XV39C` | NuHome |

These are the 3 real (non-automated-test) companies in the dev DB.
Phase 3.1 will issue read requests from ZZTEST users against their resources
and verify 403/404 responses. **No write operations against non-test tenants.**

---

## git status --porcelain (full repo)

```
?? artifacts/api-server/src/scripts/phase1-create-pins.ts
?? artifacts/api-server/src/scripts/phase1-fixture.ts
?? attached_assets/Pasted-CHECKPOINT-0-REMEDIATION-PHASE-1-AUTHORIZATION-Still-re_1786290550469.txt
?? scripts/zztest-teardown.sql
?? test-results.json
```

All changes are untracked new files. No modifications to existing application code.
