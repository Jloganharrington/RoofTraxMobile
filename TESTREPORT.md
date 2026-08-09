# Full Configuration & Behavioral Conformance Test Report

**Date:** 2026-08-09  
**Mode:** Report-only. No application code, schema, or config was modified. All findings are observations only.  
**Status:** CHECKPOINT 0 complete. Phases 1–6 pending.

---

## Phase 0 — Configuration Completeness

### 0.1 Environment Variable Inventory

| Variable | Set? | Artifact(s) | Classification | Absent behavior |
|---|---|---|---|---|
| `DATABASE_URL` | ✓ SET | api-server, lib/db | **Required** | lib/db throws on import: `"DATABASE_URL is not set"` — fails fast ✓ |
| `SESSION_SECRET` | ✓ SET (88 chars) | api-server | **Required** | smtpCrypto throws `"SESSION_SECRET is not set"` at call time — NOT on boot. Runtime-deferred. ⚠ |
| `PORT` | UNSET in shell | api-server | **Required** | index.ts throws immediately: `"PORT environment variable is required"` — fails fast ✓ (workflow injects it) |
| `ISSUER_URL` | UNSET | api-server | Classified required but **not enforced** | lib/auth.ts: `process.env.ISSUER_URL ?? 'https://replit.com/oidc'` — server boots with the Replit fallback. **FINDING 0.1-A** |
| `REPLIT_DEV_DOMAIN` | ✓ SET | api-server, web apps | Optional | auth.ts mobile-origin list silently omits the dev domain — functional degradation only |
| `REPLIT_EXPO_DEV_DOMAIN` | ✓ SET | api-server | Optional | Same as above |
| `REPL_ID` | ✓ SET | all web apps | Optional | Used for Object Storage path prefixes — storage calls fail at runtime |
| `LOG_LEVEL` | UNSET | api-server | Optional | Defaults to `info` ✓ |
| `NODE_ENV` | UNSET | all | Optional | Defaults to `production` in Express, `undefined` in Vite (uses `development`) |
| `AI_INTEGRATIONS_GEMINI_API_KEY` | ✓ SET | api-server, lib/integrations-gemini-ai | Required for AI | lib throws on import if absent ✓ |
| `AI_INTEGRATIONS_GEMINI_BASE_URL` | ✓ SET | same | Required for AI | same ✓ |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | ✓ SET | api-server, lib/integrations-anthropic-ai | Required for AI | lib throws on import if absent ✓ |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | ✓ SET | same | Required for AI | same ✓ |
| `PRIVATE_OBJECT_DIR` | ✓ SET | api-server | Required for storage | objectStorage calls fail at runtime |
| `PUBLIC_OBJECT_SEARCH_PATHS` | ✓ SET | api-server | Required for storage | public-objects endpoint returns 404 for all files |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | ✓ SET | (Replit-managed) | Required for storage | — |
| `VISUALCROSSING_API_KEY` | ✓ SET | api-server | Required for weather | weather/events returns error at runtime |
| `BRAIN_MACHINE_TOKEN` | ✓ SET | — | **Unknown** | No usage found in any source file. **FINDING 0.1-B** |
| `EXPO_PUBLIC_ISSUER_URL` | UNSET | mobile | Required for mobile auth | OIDC flow in mobile fails at launch |
| `EXPO_PUBLIC_DOMAIN` | UNSET | mobile | Required for mobile API base | all API calls from mobile fail |
| `EXPO_PUBLIC_REPL_ID` | UNSET | mobile | Required for mobile | storage paths break |
| `BASE_PATH` | UNSET in shell | all web frontends | Required | Set by Replit proxy at runtime — dev only concern ✓ |
| `BASE_URL` | UNSET (import.meta.env) | web frontends | Optional | Vite injects it from `base` config ✓ |

**FINDING 0.1-A (P2 — silent degradation):** `ISSUER_URL` is classified as required in auth.ts (used directly in OIDC discovery URL) but has a fallback of `'https://replit.com/oidc'`. Server boots successfully without it and uses the Replit OIDC provider. This is likely intentional for the dev environment but is not documented as optional.

**FINDING 0.1-B (Informational):** `BRAIN_MACHINE_TOKEN` is provisioned as a secret but has zero references in the codebase (`grep` across all artifacts and libs found nothing). Either a relic of a removed integration or a placeholder for a future one.

**FINDING 0.1-C (P2 — session cookie not signed):** `SESSION_SECRET` is only consumed by `lib/smtpCrypto.ts` for AES-256 encryption of stored SMTP passwords. `cookieParser()` in `app.ts` is called with no secret argument, so the session cookie (`rt_sid`) is a plain unsigned UUID stored in a DB row. The cookie value is unguessable (UUID v4 entropy ~122 bits) but is not HMAC-signed. A stolen session ID is valid without any cryptographic check. Standard risk for DB-backed sessions; document explicitly.

---

### 0.2 Migration Ledger vs. Reality

**Migration tracking:** No `__drizzle_migrations` table exists. Migrations are applied manually; there is no automated ledger. Applied state must be inferred from live schema.

**`drizzle-kit check` result:** `Everything's fine 🐶🔥` — Drizzle schema files match the live database schema exactly.

**40 migration files on disk** (001–040). Key column spot-checks against live DB:

| Migration | Key column | DB status |
|---|---|---|
| 018b claim_supplements | `claim_sections.supplement_id` | EXISTS ✓ |
| 018b claim_supplements | `report_attestations.supplement_id` | EXISTS ✓ |
| 019 lead_source_and_pm | `pins.external_lead_source` | EXISTS ✓ |
| 020 wave2b_user_profile | `user_profiles.theme` | EXISTS ✓ |
| 020 wave2b_user_profile | `user_profiles.dashboard_layout` | EXISTS ✓ |
| 023 payments_ledger | `payments.payment_date` | EXISTS ✓ |
| 028 change_orders | `change_orders.amount_cents` | EXISTS ✓ (column is `amount_cents`, not `approved_amount_cents`) |
| 030 change_order_line_items | `change_order_line_items.unit_price_cents` | EXISTS ✓ |
| 036 contracts | `contracts.document_sha256` | EXISTS ✓ |
| 037 retail_appointments | `pins.appointment_at` | EXISTS ✓ |
| 038 claim_status_history | `claim_status_history.to_status` | EXISTS ✓ |
| 039 notification_preferences | `notification_preferences.notification_type` | EXISTS ✓ (column is `notification_type`, not `event_type`) |
| 040 user_push_tokens | `user_push_tokens.expo_push_token` | EXISTS ✓ |

**`pin_profitability` view (029) — formula match:**
Live view formula:
```sql
COALESCE(_parse_legacy_money_cents(p.contract_amount), 0) AS base_contract_cents
(agg.base_contract_cents + agg.approved_co_cents)        AS revised_contract_cents
(revised_contract_cents - total_cost_cents)               AS net_project_margin_cents
WHEN revised_contract_cents > 0 THEN (revised - total_cost) / revised AS net_project_margin_pct
GREATEST(revised_contract_cents, approved_rcv_cents) [insurance] OR revised [retail] AS expected_total_cents
```
This matches `029_profitability_view_step5.sql` — formula is correct as built. ✓

**Tables without `company_id` column** (cross-tenant risk surface):

| Table | Tenancy mechanism |
|---|---|
| `sessions` | Keyed by session UUID; scoped via `users.company_id` at auth read time |
| `stage_transitions` | `lead_id` → `pins.id` → `pins.company_id` (join-enforced) |
| `user_profiles` | `user_id` → `users.id` → `users.company_id` (join-enforced) |
| `price_book_package_items` | `package_id` → `price_book_packages.company_id` (join-enforced) |
| `roof_facets` | `inspection_id` → `inspections.company_id` (join-enforced) |
| `companies` | Is the tenant root; `id` IS the company_id |

None of these represent a direct tenancy bypass — each is enforced via its parent join. The risk concentrates at query sites that fetch without joining; Phase 3 will verify empirically.

---

### 0.3 Generated-Client Drift

```
cd lib/api-spec && npx orval  →  🎉 api-client-react - complete
                                  🎉 zod - complete
git diff --exit-code -- lib/api-client-react lib/api-zod
EXIT CODE: 0
```

**Result: No drift.** Generated files in-repo are identical to what orval produces from the current spec.

---

### 0.4 Root Typecheck

```
pnpm -w tsc --build --force
Errors: 0
```

**Result: Clean.** All packages compile with zero type errors under a forced full rebuild.

---

### 0.5 Route Inventory vs. Spec vs. Auth

**Summary counts:**

| Metric | Count |
|---|---|
| Total registered route handlers | 311 |
| Unique paths in app (params stripped) | ~137 |
| Paths in openapi.yaml | 149 (196 operationIds) |
| Unspecced route groups (in app, not in spec) | 15 groups (see below) |
| Routes with no auth check in file | 4 files: `contractPortal`, `health`, `portal`, `index` (all intentionally public) |
| Routes lacking auth NOT on public allowlist | 1 — `GET /companies/:companyId` (see below) |
| Tables scoped by join (no direct company_id) | 5 (see 0.2) |

**Public allowlist (intentional):**
- `GET /healthz` — health check
- `GET /login`, `GET /callback`, `GET /logout` — OIDC flow
- `GET /auth/user` — returns `null` if unauthenticated (safe)
- `GET /mobile-auth/web-login`, `POST /mobile-auth/logout` — mobile OIDC relay
- `GET /portal/:accessCode`, `GET /portal/:accessCode/reports/:versionIndex` — Evidence Portal (rate-limited 30/min/IP)
- `GET /portal/contract/:code`, `GET /portal/contract/:code/document`, `POST /portal/contract/:code/select/:pkgId`, `POST /portal/contract/:code/generate-document`, `POST /portal/contract/:code/sign` — Contract Signing Portal
- `GET /storage/public-objects/*` — explicitly documented as unconditionally public

**FINDING 0.5-A (P2 — unauthenticated disclosure given a known ID):** `GET /companies/:companyId` has no authentication check. Any unauthenticated request that knows a company ID receives `{ company: { id, name } }`. The OpenAPI spec documents this as "Public — used to confirm a company exists before joining it." Company IDs are **6-char codes from a 31-char alphabet (31⁶ ≈ 887M)**; enumeration is not practical without sustained probing. Severity downgraded to P2: this is unauthenticated disclosure given a known ID, not practical enumeration. The finding stands: an attacker who obtains a code (e.g. via phishing) can confirm company name without authentication.

*(Updated from P1 post Checkpoint-1 review: 31⁶ ≈ 887M namespace makes brute-force enumeration infeasible.)*

**Unspecced route groups (in app, not in openapi.yaml):**
`/agreements`, `/ahj-wizard/*` (6 routes), `/admin` (stats + user management), `/canvassing/*`, `/discontinued-products`, `/documents`, `/events/pipeline`, `/geocode/*`, `/pipeline`, `/project-pipeline`, `/retail-pipeline`, `/search`, `/sample-package/*`, `/report-settings/*`, `/price-book/*`

Total unspecced path groups: **15** covering ~60 route handler registrations. These are fully functional endpoints consumed by the app but not contract-tested via the generated client.

---

### 0.6 Reference Data Row Counts

| Entity | Table | Row count | Status |
|---|---|---|---|
| Price book items | `price_book_items` | 17 | ✓ Data present |
| Company templates | `company_templates` | **0** | ⚠ Data gap |
| Selection categories | `selection_categories` | 1,729 | ✓ |
| Selection brands | `selection_brands` | 5 | ✓ (sparse) |
| Selection products | `selection_products` | 5 | ✓ (sparse) |
| AHJ jurisdiction packs | `ahj_packs` | 3 (1 company) | ✓ sparse |
| Proof Package library | N/A | TABLE DOES NOT EXIST | Not a DB table — baked into code |
| Notification catalog | Defined in `lib/authz/src/notifications.ts` | 16 types (code) / **0** DB preference rows | ⚠ Data gap |
| Claim status history types | N/A | TABLE DOES NOT EXIST | Enum in application code, not a table |
| Pins | `pins` | 93 | — |
| Companies | `companies` | 600 | — |
| Users | `users` | 1,021 | — |
| Stage transitions | `stage_transitions` | 51 | — |

**Notes:**
- `ahj_jurisdiction_packs` named in the work order does not exist; the table is `ahj_packs`. Row count per 0.6-R: 3 rows, 1 company. *(Corrected from Phase 0 "not checked".)*
- `company_templates` at 0 rows: any feature that serves templates to a company will return empty. Not a code defect; templates must be seeded per company.
- `notification_preferences` at 0 rows: all notification preference lookups return no results; default behavior applies (from catalog `defaultEmail`/`defaultPush` flags). Not a breakage.

---

### 0.7 Third-Party Integration Config

| Service | Status | Notes |
|---|---|---|
| AI — Gemini | **Configured** | Key + base URL set (Replit-managed proxy). lib fails fast on import if absent. |
| AI — Anthropic | **Configured** | Key + base URL set (Replit-managed proxy). lib fails fast on import if absent. |
| Geocoding (Nominatim) | **Configured** | Public API, no key required. Biased to US + viewbox. |
| Weather (VisualCrossing) | **Configured** | `VISUALCROSSING_API_KEY` SET. |
| Object Storage | **Configured** | Replit App Storage. `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`, `DEFAULT_OBJECT_STORAGE_BUCKET_ID` all SET. |
| Email (SMTP) | **Per-user** | No global key. Each rep configures their own SMTP credentials, stored AES-encrypted in `user_profiles`. No global outbound email. |
| SMS | **Not configured** | No SMS integration found in codebase. |
| Push notifications (Expo/FCM/APNs) | **Not configured** | `app.json → extra.eas.projectId = "REPLACE_WITH_EAS_PROJECT_ID"` — literal placeholder string. `getExpoPushTokenAsync` will throw on any EAS/production build. Push notifications are non-functional until EAS project is initialized. **FINDING 0.7-A** |

**FINDING 0.7-A (P1 — push notifications dead in production):** `artifacts/mobile/app.json` has `extra.eas.projectId = "REPLACE_WITH_EAS_PROJECT_ID"`. Mobile code reads this value and passes it to `getExpoPushTokenAsync`, which requires the real EAS project UUID. All push notification registrations will fail silently on production builds. `user_push_tokens` table will remain empty; all **8** push-enabled catalog types will never deliver push.

*(Corrected from Phase 0 prose which said "5" — the correct count is 8. See 0.7-R correction below.)*

Push-enabled types: `contract_signed`, `change_order_signed`, `change_order_pending_approval`, `change_order_approved`, `proof_package_delivered`, `inspection_assigned`, `inspection_scheduled`, `appointment_assigned`.

---

### 0.8 Transport & Hardening Config

| Property | Value | Assessment |
|---|---|---|
| CORS origin | `origin: true` (reflect all origins) | **FINDING 0.8-A** |
| CORS credentials | `credentials: true` | Combined with `origin: true` — any domain can make credentialed requests |
| Cookie — HttpOnly | `true` ✓ | — |
| Cookie — Secure | `true` ✓ | — |
| Cookie — SameSite | `'lax'` ✓ | Appropriate for OIDC redirect flows |
| Cookie — signing | **None** | Session cookie is a plain UUID. `cookieParser()` takes no secret. See FINDING 0.1-C |
| Session TTL | 7 days (sliding renewal) | Renewal deferred 1h per active session |
| SESSION_SECRET use | AES-256 key for SMTP password encryption only | Not used for cookie HMAC |
| Rate limiting | Auth routes (20/min) + portal (30/min) in-memory per-IP | *Updated: 0.8-B remediated by baseline commit a635a2c* |
| Body size limits | email-report: 15mb / ahj-sources: 10mb / sign: 5mb / default: 100kb | ✓ Appropriate per-route sizing |
| Helmet.js | **Absent** | No security header middleware (X-Frame-Options, CSP, HSTS, etc.) |
| HTTPS | Enforced by Replit proxy | Not handled in application code |

**FINDING 0.8-A (P1 — CORS wildcard with credentials):** `app.ts` uses `cors({ credentials: true, origin: true })`. With `origin: true`, every incoming `Origin` header is reflected back as `Access-Control-Allow-Origin`. Combined with `credentials: true`, this means any domain can make cross-origin requests with the user's session cookie attached. Should be restricted to `process.env.REPLIT_DEV_DOMAIN` and the production domain. **Status: OPEN.**

**FINDING 0.8-B (P1 — no rate limiting on auth routes): REMEDIATED** by baseline commit a635a2c (see Baseline Changes section). Auth routes now limited to 20/min/IP; portal routes use the shared `RateLimiter` class at 30/min/IP. Single-process deployment, so per-instance limit = effective limit.

**Absent security headers (Informational):** No `helmet()` or equivalent. Missing: `X-Frame-Options`, `Content-Security-Policy`, `X-Content-Type-Options`, `Strict-Transport-Security`. These are handled by Replit's proxy for the dev domain but will be absent in custom-domain deployments.

---

## Baseline Changes

The following code changes were applied **during** this test run (before Phase 2). Per the work order, fixes applied during negative-test phases silently invalidate those tests. These changes occurred before Phase 2 and are recorded here.

| Commit | SHA | What changed | Effect on findings |
|---|---|---|---|
| Add per-IP rate limits to auth routes with trust proxy and tests | `a635a2c` | Created `lib/rateLimit.ts` (shared `RateLimiter` class, fixed-window per-IP); added `trust proxy 1` to `app.ts`; applied `authLimiter` (20/min/IP) to `/login`, `/callback`, `/mobile-auth/token-exchange`; migrated portal inline rate-limit to shared class (30/min/IP); 8 unit tests added | **FINDING 0.8-B remediated.** Phase 3.8 (50 wrong portal codes) will trip the 30/min limiter; assert HTTP 429 after the 30th attempt rather than treating it as a test failure. |

**API process model:** The API runs as a **single Node.js process** (`node ./dist/index.mjs` — no cluster, no PM2, no worker threads in `index.ts`). The `RateLimiter` is an in-memory fixed-window store. Under a single process, the effective limit equals the configured limit. Under N processes the effective limit is N × limit; this is not a current concern but must be noted for any horizontal-scaling deployment.

---

## Phase 1 Corrections (post Checkpoint-1 review)

### 1-R.1 — Report Restoration
This document is the restored cumulative report. Phase 0 content recovered from commit `3d9bcc0`. Finding 0.5-A severity changed to P2 (see above). Baseline Changes section added.

### 1-R.2 — Seeding Path Analysis

**Question:** How does a new tenant get its default 4 selection categories?

**Finding — onboarding gap:** `POST /companies` (companies.ts:80) inserts only the company row. `upsertUserOnLogin` (lib/onboarding.ts) creates users and grants the first user `admin` role but seeds **no** reference data. There is no API endpoint that provisions default selection categories, brands, products, price-book items, or templates for a newly created company.

The 436 companies in the DB that each have exactly 4 categories (`Roofing`, `Siding`, `Gutters`, `Interior`) received them from **automated test fixtures** that call `POST /selections/categories` four times per run, not from a bootstrap endpoint. A real new tenant provisioned through the UI would see an empty selections screen.

**FINDING 1-R.2-A (P2 — new tenant provisions into unusable state):** There is no onboarding flow that seeds a company's reference data (categories, brands, products, price-book items, templates). A new company must manually build its entire selection hierarchy and price book before any contract or estimate flow can proceed. This is a product gap, not a security issue.

**Seed created for ZZTEST_ALPHA** (Phase 2 enablement, direct API calls where endpoint exists, direct DB insert for company_templates only):

| Entity | Method | Count |
|---|---|---|
| Selection categories | `POST /selections/categories` | 2 (Roofing, Gutters) |
| Selection brands | `POST /selections/brands` | 2 per category (4 total) |
| Selection products | `POST /selections/products` | 3 per brand (12 total), 1 is_base per category |
| Price-book items | `POST /price-book/items` | 6 |
| Company templates | Direct DB insert (API requires object storage pre-upload; objectPath placeholder used) | 1 (useCase: 'contract') |

All seeded rows carry company_id = `ZZTEST_ALPHA` and are covered by `scripts/zztest-teardown.sql`.

### 1-R.3 — OIDC Coverage Gap

Sessions for all 10 ZZTEST users were minted via `createSession()` (direct DB insert). The OIDC login path (`GET /login` → identity provider → `GET /callback` → `upsertUserOnLogin`) was **not exercised** by this test run.

**What this leaves untested:**

| Component | Untested behavior |
|---|---|
| `GET /callback` | OIDC code exchange, token validation, claims extraction |
| `upsertUserOnLogin` (new user branch) | `companyId` assignment on first login (taken from query param), company existence check, founder detection, `role: 'admin'` grant to first user |
| `upsertUserOnLogin` (returning user) | Fill-only-when-null logic for firstName/lastName/profileImageUrl on re-login |
| Company-join URL format | Whether the join code (`?companyId=XXXX`) is correctly forwarded through OIDC state and back |

**Are any of `companyId`, `role`, `department`, or `workflowAssignment` derived from OIDC claims at login?**
No. These fields are NOT derived from OIDC claims:
- `companyId` is set from the query param `?companyId=...` passed to `/login`, carried through OIDC state, and applied only at first-login (`upsertUserOnLogin`). Subsequent logins ignore it (tenancy is fixed at account creation).
- `role` is set to `'admin'` for the founding user only; subsequent users get no profile row from OIDC — they remain with the DB default (`field_rep`).
- `department` and `workflowAssignment` are never set by the OIDC flow; they use DB defaults.

The OIDC path requires separate manual testing of the full login/join flow including the companyId forwarding.

### 1-R.4 — Static Tenancy Classifier Caveat

The `tenancy: "direct"` classification in `test-results.json` is inferred by detecting `req.user.companyId` or `actor.companyId` in the handler body. This cannot distinguish a correctly scoped query from a handler that references `companyId` for logging or a secondary purpose while querying without it. **The static column is a targeting aid, not evidence of correct scoping.** Phase 3.1 must cover all 275 routes classified `direct` or `join` empirically — 100% coverage, not a sample. Empirical beats inference.

---

## Phase 1 — Fixture Setup

*(Full Phase 1 content from prior checkpoint retained below.)*

### Teardown script
`scripts/zztest-teardown.sql` — deletes all rows with `company_id LIKE 'ZZTEST%'` in FK-safe order. Safe to run twice.

### Companies

| id (verbatim) | name |
|---|---|
| `ZZTEST_ALPHA` | `ZZTEST_Alpha Roofing Co` |
| `ZZTEST_BRAVO` | `ZZTEST_Bravo Contractors` |

**Company ID format note:** Production IDs are 6-char codes from a 31-char alphabet (31⁶ ≈ 887M). ZZTEST_ prefix IDs are longer intentionally.

### Users (10)

| Handle | id | email | role | dept | wfAssignment | Co |
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

### Leads / Pins

| id | Co | workflow | notes |
|---|---|---|---|
| `c4d98b1f-6c83-4673-96d0-7cf571800917` | ALPHA | retail | orphan from aborted first run |
| `4af909ef-3e59-4ec4-a6b8-a6018811eb7a` | ALPHA | retail | **canonical retailPinId** (Phase 2B) |
| `fdbdceba-2db1-454e-881d-cbc02af7593f` | ALPHA | insurance | **canonical insurancePinId** (Phase 2A) |
| `1a056d4a-9f19-493e-8ca9-1b45c6e99728` | BRAVO | retail | bravoPinId |

All 10 auth tokens verified: `GET /api/auth/user` → HTTP 200 with matching user ID for each handle.

### Creation methods

| Entity | Method | Reason |
|---|---|---|
| Companies | Direct DB insert | POST /companies requires super_admin auth — bootstrap chicken-and-egg |
| Users / profiles | Direct DB insert | No user-create endpoint; OIDC-only |
| Sessions | `createSession()` (DB insert) | OIDC-only auth flow |
| Leads (pins) | Real API `POST /api/pins` | Endpoint exists |

### Pre-existing companies for Phase 3.1 cross-tenant probes (read-only)

| id | name |
|---|---|
| `CQG5XS` | Acme Roofing Co |
| `AP3TBW` | NH3615 |
| `5XV39C` | NuHome |

---

## Phase 2 — Positive Lifecycle Runs

### Checkpoint 2 — Method

Both lifecycles executed via `supertest` against the live Express app (same process, real DB).  
Sessions minted via `createSession()` (same helper used in E2E tests) — no mock auth.  
All pipeline-event-driven stage advances verified against `stage_transitions` table with `trigger = 'auto_event'`.  
No application code, schema, or config was modified during this phase.

Scripts:
- `artifacts/api-server/src/scripts/phase2b-retail-lifecycle.ts`
- `artifacts/api-server/src/scripts/phase2a-insurance-lifecycle.ts`
- `artifacts/api-server/src/scripts/phase2a-continuation.ts`

---

### 2B — Retail Positive Lifecycle

**Pin:** `4af909ef-3e59-4ec4-a6b8-a6018811eb7a` (ZZTEST_ALPHA, `workflow='retail'`)  
**Actors:** A-CANV-1 → A-MGR-O → A-ADMIN

#### 2B HTTP Call Log

| Step | Actor | Method | Path | Status | Note |
|---|---|---|---|---|---|
| 1 | A-CANV-1 | PATCH | `/api/leads/{pin}/advance-stage` | 200 | pin_dropped → appt_needed |
| 2 | A-CANV-1 | PATCH | `/api/leads/{pin}/advance-stage` | 200 | appt_needed → appt_scheduled (loop) |
| 3 | A-CANV-1 | PATCH | `/api/leads/{pin}/advance-stage` | 200 | appt_scheduled → appt_complete (appt. done) |
| 4 | A-MGR-O | POST | `/api/events/pipeline` | 200 | `proposal_generated` event → appt_complete → proposal_provided |
| 5 | A-MGR-O | PATCH | `/api/leads/{pin}/advance-stage` | 200 | outcome 'won' → proposal_provided → contract_pending |
| 6 | A-ADMIN | POST | `/api/pins/{pin}/contracts` | 201 | Create contract $12,000 (id: `0db8e2ef`) |
| 7 | A-ADMIN | POST | `/api/contracts/{id}/scope-packages` | 201 | Roofing 25 SQ, $12,000 |
| 8 | A-ADMIN | POST | `/api/contracts/{id}/send` | 200 | status → sent; accessCode exposed |
| 9 | (portal) | POST | `/api/portal/contract/{code}/select/{pkg}` | 200 | Select Landmark TL product |
| 10 | A-ADMIN | POST | `/api/contracts/{id}/generate-document` | 200 | PDFKit render → sha256 stored |
| 11 | (portal) | POST | `/api/portal/contract/{code}/sign` | 200 | Sign; fires `contract_signed` event (void/async) |
| 12 | A-ADMIN | GET | `/api/pins/{pin}` | 200 | Verify (pipelineStage not top-level in shape) |
| 13 | A-ADMIN | POST | `/api/pins/{pin}/payments` | 201 | `type=deposit`, $3,600 |
| 14 | A-ADMIN | PATCH | `/api/leads/{pin}/advance-stage` | 200 | → deposit_received |

#### 2B Stage Transitions

| # | from_stage | to_stage | trigger | event |
|---|---|---|---|---|
| 1 | pin_dropped | appt_needed | manual_move | — |
| 2 | appt_needed | appt_scheduled | task | — |
| 3 | appt_scheduled | appt_complete | task | — |
| 4 | appt_complete | proposal_provided | **auto_event** | `proposal_generated` |
| 5 | proposal_provided | contract_pending | manual_move | — |
| 6 | contract_pending | contract_signed | **auto_event** | `contract_signed` |
| 7 | contract_pending | deposit_received | task | — |

> **Note on row 7:** Two rows originate from `contract_pending`. See FINDING 2-B below.

#### 2B pin_profitability

| Column | Value | Formula |
|---|---|---|
| `base_contract_cents` | $0.00 | (no estimate — see OBS 2-C) |
| `approved_co_cents` | $0.00 | no change orders |
| `revised_contract_cents` | $12,000.00 | from `contracts.total_contract_cents` |
| `total_cost_cents` | $0.00 | no cost entries |
| `net_project_margin_cents` | $12,000.00 | revised − cost |
| `net_project_margin_pct` | 100.00% | net / revised |
| `expected_total_cents` | $12,000.00 | max(revised, approved_rcv) |
| `payment_total_cents` | $0.00 | (see OBS 2-D) |
| `workflow` | (null/undefined) | view column not returning |
| **Arithmetic** | `revised − cost = net` ✓ | `base + co ≠ revised` ✗ (OBS 2-C) |

**Final pin state:** `pipelineStage = deposit_received`, `contractAmount = $12,000.00`

---

### 2A — Insurance Positive Lifecycle

**Pin:** `fdbdceba-2db1-454e-881d-cbc02af7593f` (ZZTEST_ALPHA, `workflow='insurance'`)  
**Actors:** A-INSP-1 → A-MGR-F → A-ADMIN

#### 2A HTTP Call Log

| Step | Actor | Method | Path | Status | Note |
|---|---|---|---|---|---|
| 1 | A-MGR-F | PATCH | `/api/leads/{pin}/advance-stage` | 200 | pin_dropped → phase1_scheduled |
| 2 | A-INSP-1 | POST | `/api/inspections` | 201 | Create preliminary inspection (id: `4b5effad`) |
| 3 | A-INSP-1 | PATCH | `/api/inspections/{id}` | 200 | Set `preliminaryCompletedAt` → fires `preliminary_record_synced` |
| 4 | A-INSP-1 | PATCH | `/api/inspections/{id}` | 200 | Switch `phase → forensic` (required gate before FIPSA sign) |
| 5 | A-INSP-1 | POST | `/api/inspections/{id}/agreement/sign` | 201 | Sign FIPSA → fires `fipsa_signed` event |
| 6 | A-MGR-F | PATCH | `/api/leads/{pin}/advance-stage` | 200 | fipsa_signed → phase2_scheduled |
| 7 | A-INSP-1 | POST | `/api/inspections/{id}/attestations` | 201 | `attestationType=stage_signoff` → fires `forensic_record_attested` |
| 8 | A-MGR-F | POST | `/api/inspections/{id}/report/compile` | **400** | **AI BLOCKER** — no photos/measurements/estimates; Gemini rejected |
| 9 | — | — | — | SKIP | `report_attested` event not exercised (compile blocked) |
| 10 | A-ADMIN | PATCH | `/api/leads/{pin}/advance-stage` | 200 | Manual proxy: phase2_complete → claim_filed (`trigger=task`) |
| 11 | A-ADMIN | PATCH | `/api/leads/{pin}/advance-stage` | 200 | claim_filed → claim_review |
| 12 | A-ADMIN | POST | `/api/events/pipeline` | 200 | `approved` event → **200 no-op** (claim_review outcomes-only) |
| 13 | A-ADMIN | PATCH | `/api/leads/{pin}/advance-stage` | 200 | claim_review → contract_pending (skipped claim_approved) |
| 14 | A-ADMIN | POST | `/api/pins/{pin}/contracts` | 201 | Create contract $18,000 covered / $1,500 deductible (id: `0a011c64`) |
| 15 | A-ADMIN | POST | `/api/contracts/{id}/scope-packages` | 201 | Roofing 30 SQ |
| 16 | A-ADMIN | POST | `/api/contracts/{id}/send` | 200 | status → sent |
| 17 | (portal) | POST | `/api/portal/contract/{code}/select/{pkg}` | 200 | Select Landmark TL |
| 18 | A-ADMIN | POST | `/api/contracts/{id}/generate-document` | 200 | PDFKit render → sha256 stored |
| 19 | (portal) | POST | `/api/portal/contract/{code}/sign` | 200 | Sign; fires `contract_signed` event |
| 20 | A-ADMIN | POST | `/api/pins/{pin}/payments` | 201 | `type=acv`, $16,500 |
| 21 | A-ADMIN | PATCH | `/api/leads/{pin}/advance-stage` | 200 | → deposit_received |

#### 2A Stage Transitions

| # | from_stage | to_stage | trigger | event |
|---|---|---|---|---|
| 1 | pin_dropped | phase1_scheduled | manual_move | — |
| 2 | phase1_scheduled | phase1_complete | **auto_event** | `preliminary_record_synced` |
| 3 | phase1_complete | fipsa_signed | **auto_event** | `fipsa_signed` |
| 4 | fipsa_signed | phase2_scheduled | manual_move | — |
| 5 | phase2_scheduled | phase2_complete | **auto_event** | `forensic_record_attested` |
| 6 | phase2_complete | claim_filed | task | — (AI blocker proxy) |
| 7 | claim_filed | claim_review | manual_move | — |
| 8 | claim_review | contract_pending | manual_move | — (see FINDING 2-A) |
| 9 | contract_pending | contract_signed | **auto_event** | `contract_signed` |
| 10 | contract_signed | deposit_received | task | — |

> **Row 8 note:** `claim_review → claim_approved` transition absent. The `approved` outcome advance (step 12) was a no-op via POST /events/pipeline; step 13 manually jumped to contract_pending.

#### 2A pin_profitability

| Column | Value | Note |
|---|---|---|
| `base_contract_cents` | $0.00 | No estimate (see OBS 2-C) |
| `approved_co_cents` | $0.00 | — |
| `revised_contract_cents` | $18,000.00 | From signed contract |
| `approved_rcv_cents` | $0.00 | No RCV estimate entered |
| `expected_total_cents` | $18,000.00 | max(revised, approved_rcv) |
| `total_cost_cents` | $0.00 | No cost entries |
| `net_project_margin_cents` | $18,000.00 | revised − cost |
| `net_project_margin_pct` | 100.00% | net / revised |
| `payment_total_cents` | $0.00 | (see OBS 2-D) |
| **Arithmetic** | `revised − cost = net` ✓ | `base + co ≠ revised` ✗ (OBS 2-C) |

**Final pin state:** `pipelineStage = deposit_received`, `contractAmount = $18,000.00`

---

### Push Notification Coverage

The 8 configured notification types and their expected firing in these runs:

| Type | 2B fired? | 2A fired? | Note |
|---|---|---|---|
| `appointment_assigned` | No | No | appointmentAssignedTo not set in either run |
| `contract_signed` | Yes (async) | Yes (async) | Fires from `void emitPipelineEvent` in portal sign |
| `change_order_signed` | No | No | No change orders |
| `change_order_pending_approval` | No | No | — |
| `change_order_approved` | No | No | — |
| `proof_package_delivered` | No | No | Package delivery event not reached (AI blocker in 2A; n/a in 2B) |
| `inspection_assigned` | No | Attempted | Inspection assigned to self; self-notify suppressed or no push token |
| `inspection_scheduled` | No | No | Not triggered |

**Actual delivery: 0 notifications delivered.** `user_push_tokens` table is empty; EAS project ID is a placeholder. All notification system calls completed without error but sent to void. This is expected in the local test environment.

---

### Phase 2 Findings

#### FINDING 2-A — P2: Outcome-stage pipeline events are silent no-ops

**Location:** `artifacts/api-server/src/routes/pipelineEvents.ts`, `processPipelineEvent()`

**Detail:** `processPipelineEvent` builds `matchingPipelineStageKeys` exclusively from stages where `stageDef.autoAdvance.eventType === emittedEvent`. Stages that carry only `outcomes[]` with no `autoAdvance` (retail: `proposal_provided`, `follow_up`; insurance: `claim_review`, `supplement_dispute`, `adjuster_review`, `appraisal`, `public_adjuster`) are never included. Consequently:

- `POST /api/events/pipeline { eventType: 'won' }` → HTTP 200, 0 pins advanced
- `POST /api/events/pipeline { eventType: 'approved' }` → HTTP 200, 0 pins advanced

Both calls return success with no observable effect. The caller has no way to distinguish a genuine "no pins matched" from a "this event type is architecturally incapable of firing outcomes". Outcomes are advanced exclusively via `PATCH /leads/:id/advance-stage`.

**Impact:** Any automation or integration that attempts to fire outcome transitions via the pipeline event bus will silently fail. The 200 response is misleading. This is observable both in the HTTP call log (steps 5 in 2B, 12 in 2A) and in the stage_transitions audit (claim_approved stage absent from 2A audit trail despite the 'approved' event firing).

**Recommendation:** Either (a) return 422/400 when `eventType` maps exclusively to an outcome-only stage, or (b) document that POST /events/pipeline is for autoAdvance events only. A `results.length === 0 && noMatchingStagesDefined` distinction would improve debuggability.

---

#### FINDING 2-B — P2: Async portal-sign auto-advance creates concurrent stage transitions

**Location:** `artifacts/api-server/src/routes/contractPortal.ts`, portal sign route (post-TX block)

**Detail:** After committing the sign transaction, the portal sign route fires:
```typescript
void (async () => {
  ...
  await emitPipelineEvent({ eventType: 'contract_signed', ... });
})();
```
The `void` keyword discards the promise. The HTTP response returns immediately. If the API caller then issues a `PATCH /advance-stage` before the event loop processes the emitted event, both operations read `pipelineStage = 'contract_pending'` from the DB and each write a stage_transitions row originating from `contract_pending`:

- `contract_pending → contract_signed` (trigger=auto_event) — from the async event
- `contract_pending → deposit_received` (trigger=task) — from the manual advance

Both rows are written. Final `pinsTable.pipelineStage` is last-writer-wins. In Phase 2B, `deposit_received` won (step 14 committed last). This is confirmed by the 7-row stage_transitions audit showing two rows from `contract_pending`.

**Impact:** Stage transition audit log contains orphaned transitions (contract_pending → contract_signed) that do not reflect the pin's actual final state. Automated reconciliation logic that reads stage_transitions to reconstruct history could derive an incorrect current stage. In a clustered environment this race would widen.

**Recommendation:** `await` the pipeline event emission before returning, or use a DB-level pessimistic lock on the pin row during advance-stage to serialize concurrent updates.

---

#### FINDING 2-E — P2: AI compile blocks two insurance pipeline events from API-only testing

**Location:** `artifacts/api-server/src/routes/inspections.ts`, `POST /inspections/:id/report/compile`

**Detail:** The compile endpoint returned HTTP 400 for inspection `4b5effad` (no photos, no slope/measurement data, no carrier estimate). The compile calls Gemini (`gemini-2.5-flash`) and requires sufficient structured inspection data before the AI call. Because compile failed:

- `report_attested` event (`phase2_complete → package_ready`) — **not exercised**
- `package_delivered` event (`package_ready → claim_filed`) — **not exercised**

These two auto_event hops were replaced by a manual `trigger=task` advance in the audit run, and the stage_transitions shows `phase2_complete → claim_filed (task)` instead of the two-hop event chain.

**Impact:** Insurance lifecycle test coverage has a mandatory gap at compile unless the test inspection is pre-populated with photos, measurements, slope data, and carrier estimate. The Phase 2A audit demonstrates only 3 of 5 insurance auto_event transitions.

**Recommendation for Phase 3:** Seed a minimal measurement report (PDF upload + slope data) for the insurance test inspection so the compile endpoint has enough data to proceed. This would complete the `report_attested` and `package_delivered` coverage.

---

#### FINDING 2-F — P3 (note): FIPSA sign requires `phase='forensic'` — ordering constraint not surfaced

**Location:** `artifacts/api-server/src/routes/agreement.ts` line ~115

**Detail:** `POST /inspections/:id/agreement/sign` gates on `inspection.phase === 'forensic'` and returns 409 if the inspection is still in preliminary phase. The phase switch must be performed (PATCH inspection `{ phase: 'forensic' }`) before the homeowner can sign the FIPSA. This ordering constraint is not reflected in the advance-stage UI hints or in any API error preview — the 409 is the first signal a caller gets.

**Observation:** The preliminary→forensic phase switch and the FIPSA signing are two separate API calls. A field inspector who sets `preliminaryCompletedAt` (firing `preliminary_record_synced`) and immediately attempts FIPSA signing without first switching the phase will receive a 409 with no advance warning.

---

#### OBSERVATION 2-C: `pin_profitability.base_contract_cents` = $0 when no estimate exists

Both pins showed `base_contract_cents = $0.00` despite active signed contracts ($12,000 / $18,000). The view derives `base_contract_cents` from the estimate/price-book scope, not from `contracts.total_contract_cents`. Since no estimate was created in these lifecycle runs, base = $0. The formula `revised_contract_cents = base + approved_co` therefore does not hold ($12,000 ≠ $0). This is expected behaviour when contracts are created without a prior estimate — not a bug — but should be noted when reading profitability reports for leads without estimates.

---

#### OBSERVATION 2-D: `pin_profitability.payment_total_cents` = $0 despite recorded payments

Both pins had payments recorded (deposit $3,600 in 2B; ACV $16,500 in 2A) but `payment_total_cents` showed $0. The profitability view aggregates payments from a source that does not include the records written by `POST /pins/:pinId/payments`. This warrants investigation in a future phase — possible causes include: the view using a different ledger table, a missing join, or payments requiring an approval step before being counted.

---

## git status (as of Checkpoint 2)

```
 M TESTREPORT.md
?? artifacts/api-server/src/scripts/phase1-create-pins.ts
?? artifacts/api-server/src/scripts/phase1-fixture.ts
?? artifacts/api-server/src/scripts/phase1-seed-refdata.ts
?? artifacts/api-server/src/scripts/phase2a-continuation.ts
?? artifacts/api-server/src/scripts/phase2a-insurance-lifecycle.ts
?? artifacts/api-server/src/scripts/phase2b-retail-lifecycle.ts
?? attached_assets/
?? scripts/zztest-teardown.sql
?? test-results.json
```

No modifications to existing application code. All new files are audit scripts and the report.
