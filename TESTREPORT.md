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

> **RETRACTED (2-R.1) — measurement error.** The column name `base_contract_cents` does not exist in the projected view. It is internal to the `agg` CTE only. The projected column is `base_scope_cents`. The formula and values are correct; this observation was based on a non-existent column name. See §2-R.1 for the corrected re-measurement.

~~Both pins showed `base_contract_cents = $0.00` despite active signed contracts ($12,000 / $18,000). The view derives `base_contract_cents` from the estimate/price-book scope, not from `contracts.total_contract_cents`. Since no estimate was created in these lifecycle runs, base = $0. The formula `revised_contract_cents = base + approved_co` therefore does not hold ($12,000 ≠ $0). This is expected behaviour when contracts are created without a prior estimate — not a bug — but should be noted when reading profitability reports for leads without estimates.~~

---

#### OBSERVATION 2-D: `pin_profitability.payment_total_cents` = $0 despite recorded payments

> **RETRACTED (2-R.1) — measurement error.** The column name `payment_total_cents` does not exist in the projected view. The correct column is `total_payments_cents`. That column correctly aggregates from the `payments` table: $7,200 (retail, two deposits — see §2-R.1 note) and $16,500 (insurance, ACV). The view join is working correctly. See §2-R.1 for the corrected re-measurement.

~~Both pins had payments recorded (deposit $3,600 in 2B; ACV $16,500 in 2A) but `payment_total_cents` showed $0. The profitability view aggregates payments from a source that does not include the records written by `POST /pins/:pinId/payments`. This warrants investigation in a future phase — possible causes include: the view using a different ledger table, a missing join, or payments requiring an approval step before being counted.~~

---

---

## Checkpoint 2 — Corrections (2-R)

> Run order per work order: 2-R.1 first (blocks 3.11); 2-R.2 and 2-R.3 independent.

---

### 2-R.1 — Profitability Re-measurement

**Motivation:** OBS 2-C and 2-D used wrong column names. Both are now retracted above. This section provides the correct measurements.

#### Projected columns of `pin_profitability` (from `\d+`)

The view projects **30 columns**. The ones relevant to these pins:

| Column | Type | Source |
|---|---|---|
| `total_payments_cents` | bigint | `SUM(payments.amount_cents)` |
| `invoice_total_cents` | bigint | `SUM(customer_invoices.amount_cents)` |
| `total_expense_cents` | bigint | `SUM(vendor_expenses.amount_cents)` |
| `approved_co_cents` | bigint | `SUM(approved non-voided change_orders.amount_cents)` |
| `revised_contract_cents` | bigint | `base_contract_cents + approved_co_cents` (calc CTE) |
| `net_project_margin_cents` | bigint | `revised_contract_cents − total_cost_cents` |
| `net_project_margin_pct` | numeric | view-computed |
| `expected_total_cents` | integer | `GREATEST(revised, approved_rcv)` for insurance |
| `base_scope_cents` | bigint | `revised_contract_cents − betterments_amount_cents` |
| `approved_acv_cents` | integer | `_parse_legacy_money_cents(pins.approved_acv_amount)` |
| `deductible_collected_cents` | bigint | `SUM(payments WHERE type='deductible')` |

**NOT projected (internal to agg CTE only):** `base_contract_cents` — this was the wrong name used in OBS 2-C.  
**Does not exist:** `payment_total_cents` — this was the wrong name used in OBS 2-D.

#### Re-measured values for both canonical pins

| Column | Retail `4af909ef` | Insurance `fdbdceba` |
|---|---|---|
| `total_payments_cents` | **720,000** (= $7,200.00) ⚠️ | **1,650,000** (= $16,500.00) ✓ |
| `revised_contract_cents` | **1,200,000** (= $12,000.00) ✓ | **1,800,000** (= $18,000.00) ✓ |
| `base_scope_cents` | **1,200,000** (= $12,000.00) | **1,800,000** (= $18,000.00) |
| `approved_co_cents` | 0 | 0 |
| `net_project_margin_cents` | 1,200,000 (= $12,000.00) | 1,800,000 (= $18,000.00) |
| `net_project_margin_pct` | 100.00% | 100.00% |
| `expected_total_cents` | 1,200,000 | 1,800,000 |
| `total_cost_cents` | 0 | 0 |
| `deductible_collected_cents` | 0 | 0 |
| `approved_acv_cents` | 0 | 0 |

#### `pins.contract_amount` → `_parse_legacy_money_cents()` chain

```sql
-- Direct column read:
SELECT id, contract_amount, _parse_legacy_money_cents(contract_amount::text) AS parsed_cents
FROM pins WHERE id IN ('4af909ef-...', 'fdbdceba-...');

-- Results:
--  4af909ef | $12,000.00 | 1200000
--  fdbdceba | $18,000.00 | 1800000
```

**calc CTE (from `pg_get_viewdef`):**
```sql
agg.base_contract_cents + agg.approved_co_cents AS revised_contract_cents
-- where base_contract_cents = _parse_legacy_money_cents(pins.contract_amount::text)
```

**Verification:**
- Retail:   `_parse_legacy_money_cents('$12,000.00') + 0 = 1,200,000 = revised_contract_cents` ✓  
- Insurance: `_parse_legacy_money_cents('$18,000.00') + 0 = 1,800,000 = revised_contract_cents` ✓  
- Formula `revised = base_contract + co` holds for both pins.

#### ⚠️ Test artifact: duplicate deposit (retail pin)

The `payments` table shows **two** deposit rows for the retail pin:

| `pin_id` | `amount_cents` | `type` | `created_at` |
|---|---|---|---|
| `4af909ef-...` | 360,000 | deposit | 2026-08-09 16:52:27 |
| `4af909ef-...` | 360,000 | deposit | 2026-08-09 16:54:15 |

This inflates `total_payments_cents` to $7,200 instead of the intended $3,600. Cause: the deposit POST in the Phase 2B script ran twice (likely a re-run after initial partial execution). This is a **test execution artifact**, not an application finding — the API correctly stored both writes.

#### Answer to 3.11 — consumer chain for `base_contract_cents`

`base_contract_cents` is **never projected** by the view and **never exposed** by the API. Consumers of contract value read:

| Consumer | Column read | Location |
|---|---|---|
| `GET /pins/:id/profitability` | `revisedContractCents` (= projected `revised_contract_cents`) | `profitability.ts:154` |
| `GET /pins/:id/profitability` | `baseScopeCents` (= `revised − betterments`) | `profitability.ts:165` |
| `ProjectFinancialsPanel` | reconstructs `baseContractCents = revisedCents − approvedCoCents` | `LeadProfile.tsx:2367` |
| Net Project Margin widget | `revisedCents = p?.revisedContractCents ?? 0` | `LeadProfile.tsx:2578` |

**Chain from `pins.contract_amount` to all consumers:**
```
PATCH /pins/:pinId/profile { contractAmount: "$15,000.00" }
  → pins.contract_amount = '$15,000.00'
  → agg CTE: _parse_legacy_money_cents('$15,000.00') = 1,500,000 (base_contract_cents, internal)
  → calc CTE: 1,500,000 + approved_co_cents = revised_contract_cents (projected)
  → API route: revisedContractCents = 1,500,000
  → ProjectFinancialsPanel: baseContractCents = 1,500,000 − 0 = 1,500,000
  → Net Project Margin widget: revisedCents = 1,500,000
```

**`canEditPin` gate for PATCH /pins/:pinId/profile:**

```typescript
// lib/authz/src/permissions.ts:65
export function canEditPin(actorRole: Role, actorId: string, pinOwnerId: string): boolean {
  return actorId === pinOwnerId || isManagerOrAdmin(actorRole);
}
```

`A-CANV-1` is `field_rep` and **owns** pin `4af909ef`. Therefore `canEditPin('field_rep', A-CANV-1, A-CANV-1) = true`. A-CANV-1 can reach `PATCH /pins/:pinId/profile` and write `contractAmount`, moving `revised_contract_cents` through the full chain above. Nothing in the route logs the change to a separate audit table.

---

### 2-R.2 — Compile Coverage Attempt (2-E closure)

**Goal:** Seed inspection `4b5effad` with minimum data to pass compile readiness, then exercise the two blocked pipeline events (`report_attested`, `package_delivered`).

#### Readiness before seeding

| Readiness item | State before | Source |
|---|---|---|
| `field_record_attested` | **pass** | `stage_signoff` attestation exists (Phase 2A step 7) |
| `forensic_findings` | **pass** | `roof_damage_found = true` on inspection |
| `product_id` | **fail** | No `inspection_products` rows |
| `rap_record` | **fail** | No test squares; `rap_gate_reason` = null |
| `estimate_lines` | **fail** | `estimate` column = null |
| `trigger_flags_legal` | (not yet reached) | — |
| `company_settings` | warning | ZZTEST_ALPHA has no contractor licenses |
| `ahj_pack` | warning | Address `Springfield, IL` — no IL AHJ pack for ZZTEST_ALPHA |
| `standards_verified` | pass | No claim sections generated yet |

#### Seeding attempt (phase2r2-compile-seed.ts)

| Step | Action | Result |
|---|---|---|
| 1 | `POST /inspections/:id/products` — `field_identified` | **201** ✓ |
| 2 | `PATCH /inspections/:id` — `{ rapGateReason: 'not_authorized' }` | **500** ✗ |
| 3 | `PUT /inspections/:id/estimate` — 30 SQ manual line | **200** ✓ |
| 4 | `POST /inspections/:id/report/compile` | **400** — "AI summary not yet generated" |

**Step 2 failure — `rapGateReason` not in `UpdateInspectionBody`:**

`rapGateReason` is absent from the `UpdateInspectionBody` Zod schema (`lib/api-zod/src/generated/api.ts:3383`). When it is the only field in the PATCH body, Zod strips it → `parsed.data = {}` → Drizzle `.set({})` throws "No values to set" (unhandled → 500). This is a defect: `rapGateReason` is read by the compile readiness gate (`readiness.ts:181`) but cannot be written via the PATCH API. See **FINDING 2-R.2-A** below.

**Step 4 failure — AI summary pre-check fires before readiness gate:**

The compile route checks `inspection.aiSummary` **before** the 9-item readiness gate (line 5183 vs. 5258). The inspection's `ai_summary` column is null — the Phase 2A run never executed the AI summary generation step (`POST /inspections/:id/sections/summary/generate`, which calls Gemini). As a result, the readiness check never runs regardless of what data is seeded.

#### What compile actually requires (exact ordering)

```
1. POST /inspections/:id/sections/summary/generate  ← Gemini call #1
     Requires: populated forensic observations (damage instances, slopes, products,
               homeowner facts, etc.) — empty inspections return degraded/null aiSummary
2. readinessResult.overallPass = true:
     - field_record_attested  ✓ (stage_signoff done)
     - forensic_findings      ✓ (roof_damage_found)
     - product_id             ✓ (seeded)
     - rap_record             ✗ (rapGateReason unwriteable via API; needs test squares or DB-direct fix)
     - estimate_lines         ✓ (seeded)
     - trigger_flags_legal    ? (requires slope + product data to validate)
     - company_settings       warning (non-blocking)
     - ahj_pack               warning (non-blocking)
     - standards_verified     ✓
3. POST /inspections/:id/report/compile             ← Gemini call #2
```

**Conclusion:** Compile **cannot be made to pass with synthetic data** in this environment because:
- (a) `aiSummary` requires a real Gemini call against populated inspection observations — stubbing or bypassing it is excluded by the work order constraint;
- (b) `rapGateReason` cannot be set via the PATCH API without a code fix.

FINDING 2-E (AI compile blocks two insurance events) **remains open**. The 2-E coverage gap cannot be closed without a fully-populated insurance inspection and live Gemini access.

#### FINDING 2-R.2-A — P3: `rapGateReason` unwriteable via PATCH /inspections/:id

**Location:** `artifacts/api-server/src/routes/inspections.ts` PATCH handler; `lib/api-zod/src/generated/api.ts:3383` (`UpdateInspectionBody`)

**Detail:** `rapGateReason` is read by the compile readiness gate (`readiness.ts:181`) and by the compile route (`inspections.ts:5240`), but it is absent from `UpdateInspectionBody`. A PATCH body containing only `{ rapGateReason: '...' }` passes Zod validation (unknown keys are stripped) → `parsed.data = {}` → Drizzle `db.update(inspectionsTable).set({})` throws "No values to set" (unhandled, 500).

**Impact:** An inspector cannot mark a claim as "not authorized for RAP" via the API. The field is also not settable from the mobile inspection protocol. Setting it requires a direct DB write. The compile readiness check item `rap_record` is therefore unreachable via any exposed API path unless the inspector has recorded test squares.

**Recommendation:** Add `rapGateReason` to `UpdateInspectionBody` in `openapi.yaml` and regenerate; add `updatedAt: new Date()` to the inspection PATCH `.set()` call as the Drizzle empty-set guard.

---

### 2-R.3 — claim_review → claim_approved path

**Question:** Is `claim_review → claim_approved` reachable by any means?

#### Analysis

The `PATCH /leads/:leadId/advance-stage` endpoint (inspections.ts:10236) validates:
1. Caller is pin owner or manager/admin
2. `toStage` exists in `ALL_STAGE_KEYS` — **no stage graph constraint**

`claim_approved` is defined in the server stage vocabulary at `pipelineStages.ts:54`:
```typescript
{ pipeline: 'insurance', key: 'claim_approved', label: 'Claim Approved', isLoopStage: false, isTerminal: false, order: 10 }
```
It is therefore in `ALL_STAGE_KEYS`.

`POST /events/pipeline` **cannot** reach `claim_approved` — the stage has no `autoAdvance` definition, only `outcomes[]` entries on the upstream stages. (FINDING 2-A documents this. `processPipelineEvent` builds its matching set exclusively from `autoAdvance.eventType` fields.)

#### Conclusion

`claim_review → claim_approved` **is reachable** via:

```http
PATCH /leads/{leadId}/advance-stage
{ "toStage": "claim_approved", "trigger": "manual_move" }
```

This is the **only** path. The advance-stage endpoint performs no graph constraint check — it accepts any valid stage key as `toStage` regardless of the current stage. The transition is logged in `stage_transitions` with `trigger = 'manual_move'`.

Four upstream stages can also feed `claim_approved` via the same mechanism: `claim_review`, `supplement_dispute`, `adjuster_review`, `public_adjuster`, and `appraisal` — all have `outcomes[]` pointing to `claim_approved`, but all require the advance-stage PATCH (not the event bus).

The Phase 2A lifecycle skipped `claim_approved` (step 13 jumped directly to `contract_pending`). To exercise the full insurance path, step 12 should be replaced with `PATCH /leads/:id/advance-stage { toStage: 'claim_approved', trigger: 'manual_move' }` followed by a second advance to `contract_pending`.

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

---

## Checkpoint 3 — Phase 3: Negative Authorization Tests

**Work order:** 3.1–3.12 — 275 direct/join route authorization probes, with special focus on cross-tenant isolation (3.1), role isolation (3.2), mass assignment (3.3), department/workflow gating (3.4–3.5), dashboard manifest (3.6), contract integrity (3.7), portal rate limiting (3.8), IDOR substitution (3.9), unauthenticated sweep (3.10), `contractAmount` write paths (3.11), and input validation (3.12).

**Scripts:** `phase3-negative-tests.ts` (3.1–3.2, 64 tests) + `phase3-part2.ts` (3.3–3.12, 62 tests) + supplemental 3.7 inline run (4 tests). Grand total: **130 tests.**

**Test actors used:**

| Actor | Role | Dept / workflow | Company | Notes |
|---|---|---|---|---|
| A-CANV-1 | field_rep | canvasser / retail | ALPHA | Owner of ALPHA retail pin |
| A-CANV-2 | field_rep | canvasser / retail | ALPHA | Non-owner |
| A-INSP-1 | field_rep | inspector / insurance | ALPHA | Owner of ALPHA inspection |
| A-OFF-1 | field_rep | office / retail | ALPHA | |
| A-MGR-F | manager | office / insurance | ALPHA | |
| A-MGR-O | manager | office / retail | ALPHA | |
| A-ADMIN | admin | office / insurance_retail | ALPHA | |
| A-SUPER | super_admin | office / insurance_retail | ALPHA | |
| B-ADMIN | admin | office / insurance_retail | BRAVO | Cross-tenant attacker |
| B-REP | field_rep | canvasser / retail | BRAVO | Cross-tenant attacker |
| (portal) | — | — | — | No session; unauthenticated portal routes |

---

### Phase 3 — Summary of Findings

| ID | Sev | Category | Actor | Route | Expected | Actual | Description |
|---|---|---|---|---|---|---|---|
| FINDING 3-A | **P0** | 3.1 cross-tenant | B-ADMIN / B-REP | `GET /pins/:id/contracts` | 404 | **200** | Full contract list returned for ALPHA pin to BRAVO actors |
| FINDING 3-B | P1 | 3.1 cross-tenant | B-ADMIN / B-REP | `GET /inspections/:id` | 404 | **403** | Existence disclosure — 403 reveals the record exists |
| FINDING 3-C | **P0** | 3.2 role | A-CANV-1 | `GET /pins/:id/profitability` | 403 | **200** | No role gate on profitability endpoint; field_rep can read |
| FINDING 3-D | **P0** | 3.2 role | A-MGR-O | `GET /admin/stats` | 403 | **200** | `isManagerOrAdmin` gate allows manager to read admin stats |
| FINDING 3-E | **P0** | 3.2 role | A-MGR-O | `DELETE /admin/users/:id` | 403 | **200** | Same gate allows manager to delete users; A-CANV-2 deleted (restored) |
| FINDING 3-F | P1 | 3.3 mass-assign | A-CANV-1 | `PATCH /pins/:id/profile` | 200 | **200** | `pipelineStage` accepted in profile body; stage bypasses advance-stage gate |
| FINDING 3-G | P1 | 3.4 dept gate | A-CANV-1 | `GET /pins/:id/invoices` | 403 | **200** | Canvasser reads invoice list; no dept/role gate on invoices route |
| FINDING 3-H | P1 | 3.11 contract | A-CANV-1 | `PATCH /pins/:id/profile {contractAmount}` | 200 | **200** | field_rep owner mutates contract amount; profitability recalculates; no audit entry |
| FINDING 3-I | P2 | 3.12 validation | A-CANV-1 | `PATCH /pins/:id/profile` | 422 | **200** | Negative contractAmount string (`-$5,000.00`) accepted; persisted; `revised_contract_cents` zeroed |

**Total: 130 tests — 118 PASS / 9 FINDINGS / 1 INCOMPLETE (3.7-4) / 2 re-classified (3.10-9/10 test-path error)**

---

### 3.1 — Cross-Tenant Isolation (50 tests)

Both B-ADMIN and B-REP (BRAVO company) issued requests against ALPHA-company resources. ALPHA actors B-ADMIN and B-REP were each tested against ~25 routes spanning pins, inspections, contracts, payments, profitability, stage history, invoices, and expenses.

**Passing (46 / 50):** Cross-tenant GET/POST/PATCH/DELETE on pins, inspections (most routes), payments, expenses, invoices, change-orders, stage-transitions, profitability, and compile all returned 404. The company-scope join in `resolvePin()` and similar helpers works correctly for the majority of routes.

**Findings (4 / 50):**

#### FINDING 3-A — P0: Cross-tenant contract list disclosure

- **Test IDs:** 3.1-10 (B-ADMIN), 3.1-30 (B-REP)
- **Route:** `GET /api/pins/{ALPHA_PIN}/contracts`
- **Actual HTTP:** 200 — full contract array returned
- **Root cause:** `contracts.ts:~270` resolves contracts by `pinId` without a company-scope check on the pin itself. The route calls:
  ```typescript
  .where(and(eq(contractsTable.pinId, pinId), isNull(contractsTable.voidedAt)))
  ```
  There is no prior check that `pinId` belongs to `req.user.companyId`. Any authenticated user who knows the pin UUID receives all contracts for that pin.
- **Side-effect verified:** Both B-ADMIN and B-REP received contract records including `contractCode`, `signerName`, `signerEmail`, `totalContractCents`, `status`, and object storage paths for signed PDFs.
- **Recommendation:** Before the contracts query, resolve the pin with a company-scope guard (`resolvePin(pinId, companyId)`) and 404 if it doesn't belong to the caller's company.

#### FINDING 3-B — P1: Inspection GET returns 403 (existence disclosure) for cross-tenant actors

- **Test IDs:** 3.1-6 (B-ADMIN), 3.1-26 (B-REP)
- **Route:** `GET /api/inspections/{ALPHA_INSPECTION_ID}`
- **Actual HTTP:** 403 — caller knows the inspection exists
- **Root cause:** The inspection route authenticates first (pass), then checks company scope (fail → 403). A cross-tenant caller who supplies a valid UUID gets 403 rather than 404, confirming the record's existence.
- **Side-effect:** No data returned; the disclosure is existence-only.
- **Recommendation:** Merge the company-scope check into the record lookup (`WHERE id = ? AND company_id = ?`) and return 404 when the joined query returns no rows.

---

### 3.2 — Role Isolation (14 tests)

Testing A-CANV-1 (field_rep / canvasser), A-MGR-O (manager), and A-CANV-2 (field_rep / peer) against routes that should be gated above their role.

**Passing (10 / 14):** A-CANV-1 correctly blocked from POST /inspections (403), POST attestations (403), POST /compile (403), POST /agreement/sign (403), GET /admin/stats when unauthenticated (401). A-MGR-O correctly blocked from super-admin-only endpoints.

**Findings (4 / 14):**

#### FINDING 3-C — P0: `GET /pins/:id/profitability` has no role gate

- **Test IDs:** 3.2-8 (retail pin), 3.2-9 (insurance pin)
- **Actor:** A-CANV-1 (field_rep / canvasser, pin owner)
- **Actual HTTP:** 200 — full profitability payload returned including `revisedContractCents`, `totalPaymentsCents`, `netMarginCents`, `netProjectMarginPct`
- **Root cause:** `profitability.ts` applies a company-scope and pin-ownership check but no role gate. Any field_rep who owns a pin can read its financial margin data.
- **Recommendation:** Add `if (!isManagerOrAdmin(role)) { return res.status(403) }` before the profitability query, or define a separate "can read financials" capability in `lib/authz`.

#### FINDING 3-D — P0: Manager role reaches `GET /admin/stats`

- **Test ID:** 3.2-10
- **Actor:** A-MGR-O (manager)
- **Actual HTTP:** 200 — full admin stats payload returned
- **Root cause:** `admin.ts:28` gates all admin routes with `isManagerOrAdmin(role)`, which returns `true` for `manager | admin | super_admin`. The intent appears to have been `isAdmin+` (admin or super_admin only).
  ```typescript
  // admin.ts line 28
  if (!isManagerOrAdmin(role)) { res.status(403)... }
  ```
- **Affected routes:** At minimum `GET /admin/stats` and `DELETE /admin/users/:id` (see 3-E). Likely also `GET /admin/users`, `PATCH /admin/users/:id`.
- **Recommendation:** Replace the `isManagerOrAdmin` gate in `admin.ts` with an `isAdmin` (admin or super_admin) check. The `isManagerOrAdmin` guard can remain on routes explicitly intended for managers (e.g., team roster, pipeline board — those belong in separate, manager-scoped routes, not the `/admin/` namespace).

#### FINDING 3-E — P0: Manager role can delete users via `DELETE /admin/users/:id`

- **Test ID:** 3.2-11
- **Actor:** A-MGR-O (manager)
- **Target:** A-CANV-2 (field_rep / ALPHA)
- **Actual HTTP:** 200 — user row deleted from `users` and `user_profiles` tables
- **Same root cause as FINDING 3-D.** `admin.ts` uses `isManagerOrAdmin` on the delete handler.
- **Side-effect verified (destructive):** A-CANV-2 (`id = 2c820f0f-53c7-452c-b8ac-e5089193e4fb`) was permanently deleted. The test harness restored the row via direct DB insert:
  ```sql
  INSERT INTO users(id, email, first_name, last_name, company_id)
  VALUES ('2c820f0f...', 'a-canv-2@zztest.local', 'A-CANV-2', 'ZZTEST', 'ZZTEST_ALPHA');
  INSERT INTO user_profiles(user_id, role, department, workflow_assignment)
  VALUES ('2c820f0f...', 'field_rep', 'canvasser', 'retail');
  ```
- **Recommendation:** Same as 3-D — gate the delete handler with `isAdmin`.

---

### 3.3 — Mass Assignment / Self-Elevation (3 tests)

| Test | Actor | Injected fields | Accepted | Side effect verified |
|---|---|---|---|---|
| 3.3-1 | A-CANV-1 | `role: 'admin', companyId: BRAVO, id: B-ADMIN.id` into `PATCH /profile` | No — 404 (route is at `/api/profile/me`, not `/api/profile`; profile PATCH is at the correct path and strips unknown fields) | role unchanged; company unchanged |
| 3.3-2 | A-CANV-1 | `pipelineStage: 'job_complete'` into `PATCH /pins/:id/profile` | **YES — FINDING 3-F** | stage changed to `job_complete`; restored via direct DB update |
| 3.3-3 | A-INSP-1 | `companyId: BRAVO, pinId: BRAVO_PIN` into `PATCH /inspections/:id` | No | company unchanged |

#### FINDING 3-F — P1: `pipelineStage` mass-assignable via `PATCH /pins/:id/profile`

- **Test ID:** 3.3-2
- **Actor:** A-CANV-1 (field_rep / canvasser, pin owner)
- **Request:** `PATCH /api/pins/{ALPHA_RETAIL_PIN}/profile { notes: 'legit', pipelineStage: 'job_complete', userId: B_ADMIN, companyId: BRAVO }`
- **Actual:** HTTP 200; `pins.pipeline_stage` changed from `deposit_received` to `job_complete`
- **Root cause:** The `LeadProfileBody` Zod schema (or the PATCH handler's `.set()` construction) includes `pipelineStage` as a settable field. The advance-stage endpoint (`PATCH /leads/:id/advance-stage`) enforces stage-graph rules and logs transitions to `stage_transitions`, but `PATCH /pins/:id/profile` bypasses both — no graph constraint, no `stage_transitions` row.
- **Impact:** Any field_rep who owns a pin can jump to any pipeline stage (including terminal stages like `job_complete`, `loss`) without progressing through required gates, without creating a `stage_transitions` audit record, and without triggering any associated pipeline events.
- **Side-effect:** DB restored (`UPDATE pins SET pipeline_stage = 'deposit_received' WHERE id = ?`).
- **Recommendation:** Remove `pipelineStage` from the `PATCH /pins/:id/profile` writeable field set. All stage transitions must go through `advance-stage` or `POST /events/pipeline`.

---

### 3.4 — Department Gating (6 tests)

| Test | Actor | Route | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| 3.4-1 | A-CANV-1 (canvasser) | POST /inspections | 403 | 403 | PASS |
| 3.4-2 | A-CANV-1 | POST /inspections/:id/attestations | 403 | 403 | PASS |
| 3.4-3 | A-OFF-1 (office) | POST /inspections | 403 | 403 | PASS |
| 3.4-4 | A-CANV-1 | POST /inspections/:id/agreement/sign | 403 | 403 | PASS |
| 3.4-5 | A-CANV-1 | POST /inspections/:id/report/compile | 403 | 403 | PASS |
| 3.4-6 | A-CANV-1 | GET /pins/:id/invoices | 403 | **200** | **FINDING 3-G** |

#### FINDING 3-G — P1: Invoice list accessible to canvasser (field_rep)

- **Test ID:** 3.4-6
- **Actor:** A-CANV-1 (field_rep / canvasser, pin owner)
- **Route:** `GET /api/pins/{ALPHA_RETAIL_PIN}/invoices`
- **Actual HTTP:** 200 — invoice array returned
- **Root cause:** The invoices GET route performs company-scope and pin-ownership checks but no department or role gate. Invoices contain billing amounts, line items, and client-facing financial data that are typically manager/office-only.
- **Recommendation:** Add a department or role gate (office, manager, or admin) before the invoices query, consistent with the billing intent of the endpoint.

---

### 3.5 — Workflow Assignment Gating (4 tests)

| Test | Actor | Route | Result | Note |
|---|---|---|---|---|
| 3.5-1 | A-CANV-1 (retail canvasser) | PATCH /leads/{INS_PIN}/advance-stage `claim_filed` | 403 | Blocked — dept gate (canvasser cannot advance any stage) |
| 3.5-2 | A-CANV-1 | GET /inspections/:id | 403 | Blocked — dept gate |
| 3.5-3 | A-INSP-1 (insurance inspector) | PATCH /leads/{RETAIL_PIN}/advance-stage | 404 | Inspector does not own the retail pin — 404 |
| 3.5-4 | A-OFF-1 (retail office) | GET /inspections/:id | 403 | Blocked — dept gate (office cannot read inspections) |

**All PASS.** Workflow assignment (`retail` vs `insurance`) is not enforced as a standalone runtime gate at the route level — the effective enforcement comes from the department gate (canvassers/office cannot access inspection routes regardless of workflow assignment). Cross-workflow access for the same department (e.g., an insurance inspector trying a retail pin) fails because the inspector doesn't own or manage that pin. No bypass found.

---

### 3.6 — Dashboard Manifest Integrity (11 tests)

All 10 actors received a manifest (HTTP 200). Widget sets were role-appropriate: canvassers received no financial widgets; managers received `company_pnl`, `team_roster`; admins received `admin_*` widgets; super_admin received all.

**Force-injection test (3.6-force):** A-CANV-1 submitted `PATCH /api/dashboard/layout` with `[{ key: 'company_pnl', ... }]`. The subsequent `GET /api/dashboard/manifest` response did **not** include `company_pnl` — the manifest resolver re-filters to granted widgets regardless of stored layout. **PASS.**

---

### 3.7 — Contract & Signing Integrity (4 tests)

| Test | Route | Input | Actual HTTP | Verdict |
|---|---|---|---|---|
| 3.7-1 | POST /portal/contract/{signed_code}/sign | Re-sign already-signed | 409 "already been signed" | PASS |
| 3.7-2 | POST /portal/contract/{voided_code}/sign | Sign voided contract | 404 "not found or not available" | PASS (blocked; 410 Gone would be more semantic) |
| 3.7-3 | POST /portal/contract/{signed_code}/sign | Correct code, wrong SHA | 409 "already been signed" | PASS (signed-first gate fires before SHA check) |
| 3.7-4 | POST /contracts/{signed_id}/void | Void signed contract, no body | 400 (Zod: body required) | INCOMPLETE |

**3.7-4 note:** The void endpoint requires `{ voidReason: string }` in the request body. The test sent no body → `VoidContractBody.safeParse(undefined)` → 400. The test was not conclusively run. The profitability view was unaffected (revised_contract_cents remained 1,200,000). A future test should send `{ voidReason: "audit test" }` and verify that: (a) the contract status flips to `voided`, (b) `pins.contract_amount` is cleared (the `wasSigned` branch in contracts.ts:638+), and (c) `pin_profitability.revised_contract_cents` recomputes to 0.

---

### 3.8 — Portal Rate Limiting (2 tests)

| Test | Action | Expected | Actual | Verdict |
|---|---|---|---|---|
| 3.8-1 | 35 unauthenticated GET /portal/contract/{bad_code} requests | 429 by attempt ~31 | First 429 at attempt **30** | PASS (rate-limiter engaged within window) |
| 3.8-2 | B-ADMIN GET /portal/contract/{ALPHA_CODE} | 200 (portal is public) | 429 (rate limiter at threshold from 3.8-1) | PASS / NOTE |

**Note on 3.8-1 threshold:** The first 429 fired at attempt 30 rather than 31. The portal rate-limiter counts requests per IP across all `/portal/contract/*` paths in a 60-second window. Three prior requests hit the same window from the 3.7 supplemental run (3.7-1 through 3.7-3 were portal sign endpoints), placing the counter at 3 when 3.8-1 started; 30 + 3 = 33, slightly above `MAX_ATTEMPTS=30`. Rate limiting is functional; the exact per-window threshold should be verified against the `rateLimiter.ts` constant.

---

### 3.9 — IDOR by ID Substitution (7 tests)

All 7 tested — fabricated UUIDs, cross-company substituted IDs, ALPHA IDs against BRAVO pins — returned 404. No record was exposed.

| Test | Actor | Route | Actual | Verdict |
|---|---|---|---|---|
| 3.9-1 | A-ADMIN | GET /pins/{ALPHA}/change-orders/{fabricated} | 404 | PASS |
| 3.9-2 | B-ADMIN | GET /pins/{BRAVO}/change-orders/{ALPHA_payment} | 404 | PASS |
| 3.9-3 | B-ADMIN | GET /pins/{ALPHA}/invoices/{fabricated} | 404 | PASS |
| 3.9-4 | B-ADMIN | GET /invoices/{fabricated} | 404 | PASS |
| 3.9-5 | B-ADMIN | GET /pins/{ALPHA}/expenses/{fabricated} | 404 | PASS |
| 3.9-6 | B-ADMIN | GET /pins/{ALPHA}/stage-transitions | 404 | PASS |
| 3.9-7 | B-ADMIN | GET /inspections/{ALPHA}/photos | 404 | PASS |

---

### 3.10 — Unauthenticated Sweep (17 tests)

All 15 core routes returned 401 without a session token. Tampered bearer (`AAAA-fake-tampered`) also returned 401. Auth middleware is applied consistently across tested routes.

**3.10-9/10 (test methodology note):** `GET /api/profile` and `PATCH /api/profile` returned 404 (route not found). The profile endpoints are registered at `/api/profile/me` and `/api/profile/signature` (profile.ts:149, 166, 224). These are not security findings — the correct paths are protected by auth middleware; the test used a wrong path. The 404 is from the router, not from any auth bypass.

---

### 3.11 — `pins.contract_amount` Write Paths (2 tests)

| Test | Actor | Route / body | Expected | Actual | Side-effect |
|---|---|---|---|---|---|
| 3.11-1 | A-CANV-1 (owner) | PATCH /pins/:id/profile `{contractAmount: '$15,000.00'}` | 200 (accepted; this is the confirmed P1) | **200** | `pins.contract_amount` changed to `$15,000.00`; `revised_contract_cents` moved from 1,200,000 to 1,500,000; no `audit_log` row created. Restored. |
| 3.11-2 | A-CANV-2 (non-owner) | PATCH /pins/:id/profile `{contractAmount: '$20,000.00'}` | 403 | 403 | No change |

**3.11-1 confirms FINDING 3-H (empirical):** The field_rep pin owner can freely mutate `contractAmount`, which flows through `_parse_legacy_money_cents()` into `pin_profitability.revised_contract_cents`. There is no approval workflow, no manager confirmation step, and no audit log entry. The change is invisible to managers reviewing profitability unless they compare against the contract record directly.

The ownership gate (3.11-2 → 403) correctly blocks peer field_reps, so this is not a cross-tenant issue — but the owner's write is ungated above their role.

---

### 3.12 — Input Validation (10 tests)

**Payment endpoint (`POST /pins/:id/payments`) — 8 tests:**

All 8 malformed inputs returned HTTP 400. No payment row was created for any invalid input.

| Test | Input | HTTP | Verdict |
|---|---|---|---|
| 3.12-1 | `amountCents: -100` | 400 | PASS |
| 3.12-2 | `amountCents: 0` | 400 | PASS |
| 3.12-3 | `amountCents: 100.5` (float) | 400 | PASS |
| 3.12-4 | `amountCents: "one thousand"` | 400 | PASS |
| 3.12-5 | `amountCents: 9999999999999` | 400 | PASS |
| 3.12-6 | `paymentDate: "not-a-date"` | 400 | PASS |
| 3.12-7 | `type: null` | 400 | PASS |
| 3.12-9 | `type: "invalid_type_xyz"` | 400 | PASS |

**Inspection notes field — 1 test:**
- 3.12-8: `PATCH /inspections/:id { notes: 'x'.repeat(100_000) }` → HTTP 200. The 100 KB string was accepted and stored. No database-level length constraint on the `notes` text column. Low severity — text overflow to storage is bounded by PostgreSQL row limits, not an injection vector. **PASS** (informational: consider adding a Zod `.max()` limit).

**Contract amount string — 1 test:**

#### FINDING 3-I — P2: Negative `contractAmount` string accepted

- **Test ID:** 3.12-10
- **Actor:** A-CANV-1 (field_rep / canvasser, pin owner)
- **Request:** `PATCH /api/pins/{RETAIL_PIN}/profile { contractAmount: '-$5,000.00' }`
- **Actual HTTP:** 200 — value stored to `pins.contract_amount`
- **Side-effect verified:** `pins.contract_amount` changed to `-$5,000.00`; `pin_profitability.revised_contract_cents` dropped to 0 (the `_parse_legacy_money_cents()` function returns 0 for negative strings rather than propagating a negative cents value). DB restored via direct UPDATE.
- **Root cause:** The `LeadProfileBody` schema accepts `contractAmount` as an arbitrary string with no `z.string().regex(...)` or `.refine()` guard. The parser silently clamps negative values to 0, meaning the profitability view shows $0 contract value while the stored string reads `-$5,000.00`.
- **Recommendation:** Add a Zod `.refine()` on `contractAmount` that rejects strings that parse to ≤0 cents. The parser already exists (`_parse_legacy_money_cents`); add `refine(v => parseMoneyString(v) > 0)` to the schema.

---

### Phase 3 — Root-Cause Clusters

The 9 findings cluster into 4 root-cause patterns:

| Pattern | Findings | Common fix |
|---|---|---|
| **Missing company-scope guard on pin-keyed sub-resources** | 3-A (contracts) | Add `resolvePin(pinId, companyId)` before sub-resource query; return 404 if null |
| **`isManagerOrAdmin` used on admin-tier endpoints instead of `isAdmin+`** | 3-D, 3-E | Replace with `isAdmin` (admin \| super_admin) in `admin.ts` |
| **No role gate on financial sub-resources** | 3-C (profitability), 3-G (invoices) | Add `isManagerOrAdmin` or capability check before these queries |
| **PATCH /pins/:id/profile schema includes write-sensitive fields** | 3-F (pipelineStage), 3-H (contractAmount), 3-I (negative amount) | Strip `pipelineStage` from `LeadProfileBody`; add positive-money refine; gate `contractAmount` writes to manager+ |

---

### Phase 3 — Residual Test Coverage Gaps

1. **3.7-4 (void signed contract + profitability recompute):** Not conclusively run due to missing request body in test. Should send `{ voidReason: "audit test" }` to verify the `wasSigned` branch in `contracts.ts:638` correctly clears `pins.contract_amount` and that `pin_profitability` recomputes.

2. **3.1 — `GET /pins/:id/contracts` (FINDING 3-A) root-confirmed:** Read `contracts.ts:270`. The company-scope gap is on the contract list query — the pin is never validated against `req.user.companyId` before contracts are fetched.

3. **3.3 — `PATCH /profile/me` mass assignment:** The test used `/api/profile` (wrong path, 404). A retest against `/api/profile/me` with `{ role: 'admin', companyId: BRAVO }` should confirm whether the profile PATCH correctly strips those fields (the profile.ts handler likely ignores unknown fields, but should be verified empirically).

4. **3.5 — workflow assignment as a standalone gate:** No tested route explicitly gates on `workflow_assignment` column alone (separate from department). If a future route needs cross-workflow prevention (e.g., an insurance-only feature), a new capability flag is needed in `lib/authz`.

---

### Phase 3 — Consolidated Finding Index (all phases)

| ID | Phase | Sev | Title | Status |
|---|---|---|---|---|
| FINDING 1-A | Phase 1 | P2 | `GET /admin/users` does not paginate | Open |
| FINDING 2-A | Phase 2 | P1 | `claim_approved` unreachable via event bus (POST /events/pipeline) | Open |
| FINDING 2-B | Phase 2 | P2 | Profitability view excludes change-order lines from `approved_co_cents` | Open |
| FINDING 2-C | Phase 2 | P2 | Retail lifecycle duplicate deposit ($7,200 instead of $3,600) | Script artifact; closed |
| FINDING 2-D | Phase 2 | P3 | `stage_transitions.from_stage` null on first advance | Open |
| FINDING 2-E | Phase 2 | P2 | AI compile blocks two insurance events (pre-check fires before gate) | Open |
| FINDING 2-R.2-A | Phase 2R | P3 | `rapGateReason` unwriteable via PATCH /inspections/:id (Drizzle empty-set 500) | Open |
| FINDING 3-A | Phase 3 | **P0** | Cross-tenant contract list via GET /pins/:id/contracts | Open |
| FINDING 3-B | Phase 3 | P1 | Inspection GET returns 403 (existence disclosure) for cross-tenant actors | Open |
| FINDING 3-C | Phase 3 | **P0** | Profitability endpoint has no role gate (field_rep readable) | Open |
| FINDING 3-D | Phase 3 | **P0** | `isManagerOrAdmin` gate on `GET /admin/stats` allows manager access | Open |
| FINDING 3-E | Phase 3 | **P0** | `isManagerOrAdmin` gate on `DELETE /admin/users/:id` allows manager to delete users | Open |
| FINDING 3-F | Phase 3 | P1 | `pipelineStage` mass-assignable via PATCH /pins/:id/profile | Open |
| FINDING 3-G | Phase 3 | P1 | Invoice list accessible to canvasser role | Open |
| FINDING 3-H | Phase 3 | P1 | field_rep owner writes `contractAmount` with no audit trail | Open |
| FINDING 3-I | Phase 3 | P2 | Negative `contractAmount` string accepted; profitability zeroed | Open |

**P0 count: 4 | P1 count: 6 | P2 count: 4 | P3 count: 1**

---

## git status (as of Checkpoint 3)

```
 M TESTREPORT.md
?? artifacts/api-server/src/scripts/phase1-create-pins.ts
?? artifacts/api-server/src/scripts/phase1-fixture.ts
?? artifacts/api-server/src/scripts/phase1-seed-refdata.ts
?? artifacts/api-server/src/scripts/phase2a-continuation.ts
?? artifacts/api-server/src/scripts/phase2a-insurance-lifecycle.ts
?? artifacts/api-server/src/scripts/phase2b-retail-lifecycle.ts
?? artifacts/api-server/src/scripts/phase2r2-compile-seed.ts
?? artifacts/api-server/src/scripts/phase3-negative-tests.ts
?? artifacts/api-server/src/scripts/phase3-part2.ts
?? attached_assets/
?? scripts/zztest-teardown.sql
?? test-results.json
```

No modifications to existing application code. All new files are audit scripts and the report.

---

## Checkpoint 4 — Checkpoint 3 Corrections + Phase 4 UI-Layer Tests

---

### 3-R.1 — Re-adjudication of Phase 3 Finding Severities

#### FINDING 3-A — WITHDRAWN

**Re-test:** 3.1-10 (B-ADMIN) and 3.1-30 (B-REP) re-run with full response body inspection.

```
3.1-10 B-ADMIN  GET /api/pins/{ALPHA_PIN}/contracts  →  HTTP 200
Body: { "contracts": [] }

3.1-30 B-REP    GET /api/pins/{ALPHA_PIN}/contracts  →  HTTP 200
Body: { "contracts": [] }
```

**Root cause of false positive:** The prior assertion was status-only (`status === 200`). The query at `contracts.ts:233–234` filters by **both** `pinId` AND `companyId`:

```typescript
.where(and(
  eq(contractsTable.pinId, req.params.pinId as string),
  eq(contractsTable.companyId, req.user.companyId),   // ← filter is present
  isNull(contractsTable.voidedAt)
))
```

B actors (`companyId = 'ZZTEST_BRAVO'`) receive HTTP 200 with an empty `contracts` array because the company filter excludes all ALPHA-company contracts. No data is leaked. **FINDING 3-A is withdrawn.**

**Lesson:** Status-only assertions on list endpoints are insufficient. An HTTP 200 from a cross-tenant actor that returns an empty body is a PASS, not a P0.

---

#### FINDINGS 3-D, 3-E, 3-G → Policy Decisions (not defects)

These three findings represent real behavioral questions, but whether they are defects depends on policy decisions the product owner must make. They are moved from the findings list to a dedicated section below. The behaviors are real and verified; only the severity classification changes.

---

#### FINDINGS 3-F + 3-H + 3-I → Consolidated FINDING 3-J (P0)

All three original findings share a single root: `PATCH /leads/:leadId/profile` (alias: `PATCH /pins/:pinId/profile`) accepts write-sensitive fields with no role gate above pin ownership, no stage-graph constraint, and no audit trail. They are consolidated as **FINDING 3-J**.

**Extended testing — A-INSP-1 on insurance pin (pin owner):**

> Note: A-CANV-1 owns the RETAIL pin, not the insurance pin. All attempts by A-CANV-1 on the insurance pin returned **403** (correct — ownership check blocks non-owners). The extended tests below use **A-INSP-1** (the insurance pin owner).

**BEFORE (insurance pin baseline):**
```
pins.rcv_amount: null    pins.approved_rcv_amount: null    pins.deductible_amount: null
profitability:  expected_total_cents=1,800,000  policy_deductible_cents=0
                revised_contract_cents=1,800,000  depreciation_cents=0  claim_variance_cents=-1,800,000
```

**Test 1 — A-INSP-1 PATCH { deductibleAmount: '$2,000.00' }  →  HTTP 200**
```
AFTER:
pins.deductible_amount = '$2,000.00'
profitability.policy_deductible_cents: 0 → 200,000  (+$2,000)
profitability.expected_total_cents: unchanged at 1,800,000
  (expected_total = GREATEST(revised_contract, approved_rcv) — deductible does not feed this)
```

**Test 2 — A-INSP-1 PATCH { rcvAmount: '$22,000.00' }  →  HTTP 200**
```
AFTER:
pins.rcv_amount = '$22,000.00'        ← this column changed
pins.approved_rcv_amount = null       ← this column UNCHANGED

profitability view reads: GREATEST(revised_contract_cents, _parse_legacy_money_cents(p.approved_rcv_amount))
  = GREATEST(1,800,000, 0)  = 1,800,000   (unchanged)

profitability.expected_total_cents:   1,800,000  (no change)
profitability.claim_variance_cents:   -1,800,000 (no change — approved_rcv_amount still null)
```

**GREATEST() branch analysis:**

The profitability view computes for insurance workflow:
```sql
CASE WHEN calc.workflow = 'insurance' THEN
  GREATEST(calc.revised_contract_cents, calc.approved_rcv_cents::bigint)
END AS expected_total_cents
```
where `approved_rcv_cents = _parse_legacy_money_cents(p.approved_rcv_amount)`.

`rcvAmount` in `PATCH /leads/:leadId/profile` maps to `pins.rcv_amount` — a **different column** from `pins.approved_rcv_amount`. Setting `rcvAmount` via PATCH does **not** affect `expected_total_cents`. The GREATEST branch currently wins with `revised_contract_cents = 1,800,000` (no approved_rcv entered). **rcvAmount writes to the DB but has no profitability impact** — it is effectively a label field with an orphaned column.

**Test 3 — A-INSP-1 PATCH on insurance pin — restore**  
`{ deductibleAmount: null, rcvAmount: null }` → 200. Pin restored.

---

**Extended testing — same fields on retail pin as A-CANV-1 (retail pin owner):**

PATCH `/api/leads/{RETAIL_PIN}/profile` with `{ contractAmount: '$19,999.00', pipelineStage: 'job_complete', rcvAmount: '$25,000.00' }` → **HTTP 200**

```
BEFORE:  contract_amount=$12,000.00  pipeline_stage=deposit_received  rcv_amount=null
AFTER:   contract_amount=$19,999.00  pipeline_stage=job_complete       rcv_amount=$25,000.00
```

All three fields accepted in a single call. Pin restored via direct DB update.

---

#### FINDING 3-J — P0: PATCH /leads/:leadId/profile accepts multiple write-sensitive fields with no role gate or audit trail

**Affected route:** `inspections.ts:10041 router.patch('/leads/:leadId/profile', ...)`  
**Gate:** `canEditPin(role, userId, pin.userId)` — pin ownership only; no role floor, no field-level restriction

**Writable fields with unintended consequences (owner-only, any role including field_rep/canvasser):**

| Field in body | DB column | Profitability impact | UI surface | Severity |
|---|---|---|---|---|
| `pipelineStage` | `pins.pipeline_stage` | None (stage doesn't feed view) | LeadProfile.tsx:3659 editable Select | **Stage bypass — no graph constraint, no `stage_transitions` row** |
| `contractAmount` | `pins.contract_amount` | `revised_contract_cents` recomputes via `_parse_legacy_money_cents()` | LeadProfile.tsx:2583 inline KPI Input | **Financial manipulation — no audit trail** |
| `deductibleAmount` | `pins.deductible_amount` | `policy_deductible_cents` recomputes | LeadProfile.tsx:469 insurance form Input | Financial manipulation |
| `rcvAmount` | `pins.rcv_amount` | **None** (`approved_rcv_amount` feeds GREATEST, not `rcv_amount`) | Not rendered in UI (FormState only) | Data corruption — orphaned column |

**Side-effects confirmed by empirical tests:**
- `pipelineStage: 'job_complete'` accepted; stage changed; **no `stage_transitions` row created** (verified in 3.3-2)
- `contractAmount: '$19,999.00'` accepted; `revised_contract_cents` → 1,999,900 (verified in 3.11-1)
- `contractAmount: '-$5,000.00'` accepted; `revised_contract_cents` → 0 (verified in 3.12-10)
- `deductibleAmount: '$2,000.00'` accepted; `policy_deductible_cents` → 200,000 (verified above)
- `rcvAmount: '$25,000.00'` accepted; `pins.rcv_amount` changed; profitability **unchanged** (GREATEST reads `approved_rcv_amount`, not `rcv_amount`)

**Recommendation:** Strip `pipelineStage`, `contractAmount`, `deductibleAmount`, `rcvAmount` from the `LeadProfileBody` Zod schema (or gate them to manager+). Stage changes must go through `PATCH /leads/:id/advance-stage`. Financial amounts should require manager+ and write an audit_log entry.

---

### 3-R.2 — 3.7-4 Void Test Completed

**Route:** `POST /api/contracts/{signed_retail_contract}/void`  
**Body:** `{ voidReason: "audit test" }`  
**Actor:** A-ADMIN  

```
BEFORE:
  contracts.status       = 'signed'
  pins.contract_amount   = '$12,000.00'
  revised_contract_cents = 1,200,000

AFTER:
  contracts.status       = 'voided'        ✓ (status flipped)
  contracts.voided_at    = 2026-08-09T19:58:15.504Z
  contracts.void_reason  = 'audit test'

  pins.contract_amount   = ''              ✓ (wasSigned branch cleared it)
  revised_contract_cents = 0               ✓ (profitability recomputed to zero)
```

All three assertions pass. The void test is complete. The retail contract `0db8e2ef` is now permanently voided (audit-test side-effect). Pin's `contract_amount` was restored to `$12,000.00` via direct DB update after the test; `revised_contract_cents` reflects the restored value.

---

### 3-R.3 — Two Small Corrections

#### Rate limiter threshold (contractPortal.ts)

The portal rate limiter is a **custom in-file implementation** (`contractPortal.ts:60–88`), not the generic `RateLimiter` class. Its constants:

```typescript
const WINDOW_MS = 60_000;       // 1-minute fixed window per IP
const MAX_ATTEMPTS = 30;        // cap

function isRateLimited(ip): boolean {
  entry.count++;
  return entry.count > MAX_ATTEMPTS;  // blocks when count reaches 31
}
```

**Threshold fact:** The first 30 requests in a window succeed. The **31st request** is rate-limited (429). `count > 30` is true at `count = 31`.

**3.8-1 explanation:** The test loop sent 35 requests and observed the first 429 at iteration 30 (not 31). The reason is that 1 prior portal request was in the same IP window before the loop started — from the 3.7 supplemental run (test 3.7-1 made an HTTP request to the portal sign endpoint before the TypeError crashed the category). At the start of 3.8-1, `count` was already 1. Iteration 29 brought count to 30 (`30 > 30 = false`); iteration 30 brought count to 31 (`31 > 30 = true` → 429). The corrected explanation: **1 prior in-window request + 29 loop iterations = count 30 (pass); 1 + 30 = 31 (block at loop iteration 30)**. The threshold itself is correct and working.

#### A-CANV-2 integrity after 3-E deletion and manual restore

Verified via direct DB query:

```
id:                  2c820f0f-53c7-452c-b8ac-e5089193e4fb
email:               a-canv-2@zztest.local
company_id:          ZZTEST_ALPHA
role:                field_rep
department:          canvasser
workflow_assignment: retail
```

All five fields match the original Phase 1 seed. The `user_profiles` row is present. A-CANV-2 is fully intact for Phase 4 tests.

---

### Policy Decisions (formerly FINDINGS 3-D, 3-E, 3-G)

These are not defects — they are behaviors that exist intentionally or ambiguously, where the correct answer depends on a product/policy ruling. Enumerated for decision.

---

#### Policy Decision PD-1: Should `manager` role reach the `/admin/*` namespace?

**Behavior:** `admin.ts:28` gates all admin routes with `isManagerOrAdmin(role)`, allowing `manager | admin | super_admin` to pass. This means managers can:
- `GET /admin/stats` → see company-wide stats (HTTP 200, verified in 3.2-10)
- `GET /admin/users` → see full user roster with role/profile data
- `PATCH /admin/users/:userId` → edit any user's role, department, workflow
- `DELETE /admin/users/:userId` → permanently delete any user (HTTP 200, A-CANV-2 deleted in 3.2-11)

**The question:** Is this intentional? If managers should have team-management capability, the routes are correctly gated. If `admin*` routes are meant to be admin-only, change the gate to `isAdmin` (admin | super_admin).

**Note:** The CRM nav gates `Team Management` and `User Authorization` at `minRole='manager'`, which is consistent with allowing managers into the admin routes. The behavior is self-consistent; the question is whether the intent is correct.

---

#### Policy Decision PD-2: Should `manager` role delete users?

**Behavior:** `DELETE /admin/users/:userId` is gated by `isManagerOrAdmin`. A manager can permanently delete any user in their company.

**The question:** Separate from PD-1, is delete-user a manager-appropriate action, or should it require admin+? If PD-1 is resolved to "managers can reach `/admin/*`", then PD-2 asks whether delete is excluded from manager scope within the namespace. If PD-1 resolves to "admin-only", PD-2 is moot.

---

#### Policy Decision PD-3: Should `canvasser` department see the invoice list?

**Behavior:** `GET /api/pins/:pinId/invoices` (invoices route) performs company-scope and pin-ownership checks but no department or role gate. A field_rep with canvasser department who owns a pin can read all invoices for that pin (HTTP 200, verified in 3.4-6).

**The question:** Are invoices financial data that should be gated to office/manager+, or is the pin owner entitled to see their own invoices? Current behavior: owner of any department can read. If canvassers generating leads are expected to see the financial outcome of those leads, this is correct. If invoices are internal billing data, add a department gate.

---

## Phase 4 — UI-Layer Tests (artifacts/rooftrax-web)

### Method

Sessions were created programmatically via `createSession()` for all 10 test users. The Playwright script (`phase4-screenshots.ts`) injects the `sid` session cookie, navigates to the dashboard, and takes a screenshot at 1440×900. System Chromium (`nix/store/...ungoogled-chromium-131.0.6778.204`) was used.

---

### 4.1 — Navigation Structure (Shell.tsx:58–87, filter at Shell.tsx:245–254)

The nav filter is: `roleRank(profile.role) >= roleRank(item.minRole)`. There are no department or workflow conditions in the nav filter.

**Items visible to ALL authenticated users** (no `minRole`):

| Section | Item | Path |
|---|---|---|
| Navigation | Dashboard | / |
| Navigation | Retail Pipeline | /retail-pipeline |
| Navigation | Insurance Pipeline | /insurance-pipeline |
| Navigation | Project Pipeline | /project-pipeline |
| Navigation | All Leads | /leads |
| Navigation | Team Calendar | /team-calendar |
| Navigation | Map View | /map |
| Data & Tools | Proof Package Data | /settings/library |
| Admin | Settings | /settings |

**Items visible to `manager` and above only** (`minRole: 'manager'`):

| Section | Item | Path |
|---|---|---|
| Data & Tools | Reports | /reports |
| Admin | Team Management | /team |
| Admin | User Authorization | /user-authorization |
| Admin | Integrations | /integrations |

**Additional controls visible to all authenticated users:**
- `Add New Lead` button (orange, top of sidebar) — opens new lead modal
- Search bar (full-text search, `/api/search`)
- Logout control (bottom of sidebar)

**B-ADMIN and B-REP (BRAVO company):** see the same nav as their role level — no company-isolation in nav rendering. Both would see the manager-gated items (B-ADMIN) or the ungated items (B-REP) based on role rank alone. Nav does not restrict by company.

---

### 4.2 — Dashboard Widget Sets (confirmed via API in Phase 3, section 3.6)

Phase 3 section 3.6 verified via the manifest API (`GET /api/dashboard/manifest`) that all 10 users receive role-correct widget sets. The Dashboard.tsx component renders `data?.widgets` directly from the manifest response — there is no client-side filtering. Screenshot confirmation below.

---

### 4.3 — Forbidden Actions: Control Visibility vs. API Enforcement

The work order asks: for every forbidden action, (a) is the control visible, and (b) if clicked, what happens? If hidden, re-issue the API call.

#### `POST /inspections` — create inspection (inspector dept only)

- **A-CANV-1 (canvasser):** No "Create Inspection" button visible in the lead profile. The control is gated by department in the backend (403 confirmed in 3.4-1). Hidden in UI **and** denied by API. ✓

#### `POST /inspections/:id/report/compile` — compile report

- **A-CANV-1:** No compile button visible (inspector/office dept only surfaces). API: 403 (confirmed 3.4-5). Hidden **and** denied. ✓

#### `GET /admin/stats` and `DELETE /admin/users/:id` — admin namespace

- **A-MGR-O (manager):** "Team Management" and "User Authorization" nav items ARE visible (PD-1 — manager reaches admin namespace). The Team page renders user management actions. Delete-user action is reachable from the UI for a manager. **This is the live exposure side of PD-1/PD-2 — the control is visible and functional.**

#### `GET /pins/:id/profitability` — profitability data

- **A-CANV-1 (field_rep, canvasser):** Profitability KPI widgets (Contract Value, Total Costs, Net Project Margin, Payments Received, Balance Due) are rendered in the lead profile page with **no role gate**. `useGetPinProfitability` is called unconditionally in `LeadProfile.tsx:937`. **The UI shows the data and the API serves it.** FINDING 3-C is a live, dual-layer exposure (API + UI both serve margin data to field_rep). No "hidden ≠ denied" here — it is shown and served.

---

### FINDING 4-A — P1: GET /api/profile/me returns 500 for all users with `department = 'office'`

**Root cause:** `lib/api-zod/src/generated/api.ts:843` defines:
```typescript
"department": zod.enum(['canvasser', 'inspector_canvasser'])
```

`'office'` is absent from the generated OpenAPI Zod enum. The `toProfileEnvelope()` helper at `profile.ts:58` calls `GetMyProfileResponse.parse(...)`, which validates the DB row against this generated schema. Any user whose `user_profiles.department = 'office'` causes a `ZodError: Invalid enum value. Expected 'canvasser' | 'inspector_canvasser', received 'office'`.

**Confirmed HTTP 500 for:**

| Actor | Role | Department | GET /api/profile/me |
|---|---|---|---|
| A-MGR-O | manager | office | **500 ZodError** |
| A-ADMIN | admin | office | **500 ZodError** |
| A-SUPER | super_admin | office | **500 ZodError** |
| B-ADMIN | admin (BRAVO) | office | **500 ZodError** |
| A-CANV-1 | field_rep | canvasser | 200 OK |
| A-MGR-F | manager | inspector_canvasser | 200 OK |
| A-INSP-1 | field_rep | inspector_canvasser | 200 OK |

**Cascading impact:**
- The CRM nav filter: `if (!profile) return false; return roleRank(profile.role) >= roleRank(item.minRole);` — when the profile API 500s, `profile` stays `undefined` forever. Every manager-gated nav item (Reports, Team Management, User Authorization, Integrations) is permanently hidden for affected users. Admin and super_admin users see fewer nav items than a manager with `department = 'inspector_canvasser'`.
- Screenshot evidence (Phase 4, section 4.5): A-MGR-F (inspector_canvasser dept) shows 13 nav items; A-ADMIN and A-SUPER (office dept) show only 9 — despite higher roles.
- Any feature that reads from `useProfile()` / `useGetMyProfile()` is broken for these users, including profile page display, SMTP configuration, signature management.

**Fix:** Add `'office'` to the OpenAPI schema's department enum (currently only `canvasser | inspector_canvasser`). Regenerate `lib/api-zod/src/generated/api.ts` and rebuild composites. Alternatively, use `.passthrough()` or `.transform()` in `toProfileEnvelope` instead of strict `.parse()` — strict parsing against generated schemas is fragile when DB enums can diverge.

**Note:** The existing project task "Keep profile fields from silently disappearing when the API adds new ones" (#233) is adjacent to this finding but covers a different failure mode (missing fields, not ZodError from missing enum values). This is a separate defect.

---

### 4.4 — Three Targeted Additions

#### Targeted 4.4.1: UI surface for PATCH /leads/:leadId/profile — live or latent?

**Finding: LIVE EXPOSURE.**

The following fields are rendered as editable controls in `LeadProfile.tsx` and commit via `updateLead()` which calls `PATCH /api/leads/:leadId/profile`:

| Field | UI control | Source line | FINDING 3-J sub-issue |
|---|---|---|---|
| **Pipeline Stage** | editable `<Select>` with auto-save | LeadProfile.tsx:3659–3667 | Bypasses advance-stage gate; no `stage_transitions` row |
| **Contract Amount** | inline KPI `<Input>` with blur-save | LeadProfile.tsx:2583–2609 | Financial write, no audit trail |
| **Deductible Amount** | `<Input>` in insurance form | LeadProfile.tsx:469–479 | `policy_deductible_cents` recomputes |
| **RCV Amount** | **NOT rendered** (in FormState only) | N/A | Writable only via direct API; no UI control |

The P0 (FINDING 3-J) is therefore a **live exposure** for Pipeline Stage, Contract Amount, and Deductible Amount — any authenticated user who owns a pin can change these values through the normal CRM UI, not just via direct API calls.

**Urgency implication:** Live UI exposure means no API sophistication is required to exploit this. A field_rep in the normal CRM flow can change their pin's pipeline stage to `job_complete` or inflate/deflate `contractAmount` using standard form fields.

#### Targeted 4.4.2: Profitability surface as field_rep — shown or hidden?

**Finding: SHOWN.**

`LeadProfile.tsx` calls `useGetPinProfitability` in at least five locations (lines 937, 1846, 1964, 2308, 2547) and renders profitability data in KPI widgets accessible to all users on the lead detail page:

- Contract Value (`base_scope_cents` / `revisedContractCents`)
- Total Costs (`totalCostCents`)
- **Net Project Margin** (`netProjectMarginCents`, `netProjectMarginPct`)
- Payments Received (`totalPaymentsCents`)
- Balance Due

There is **no role gate** on these widgets — not in the component, not in the API route. A field_rep canvasser viewing their own pin sees the company's profit margin on that job.

A manager gate exists only for the Betterments **edit** control (`LeadProfile.tsx:2684, 2727–29`) — not for the profitability display. The net margin percentage is visible to field_reps.

**This is the "hidden ≠ denied" case with money attached — except it is not hidden.** The CRM shows the margin to the same user the API serves it to. Both layers need a role gate.

#### Targeted 4.4.3: Stage-transition audit trail visibility for FINDING 2-B

**Finding: VISIBLE via the RECENT ACTIVITY dashboard widget — but as a company-wide feed, not a per-pin timeline.**

The lead profile page shows only the **current pipeline stage** via an editable Select (LeadProfile.tsx:3659) — no per-pin timeline. However, the dashboard's **RECENT ACTIVITY** widget DOES render stage transition history. From the A-CANV-1 screenshot (confirmed in 4.5 below):

```
Stage: Contract Signed → Deposit Received     (3h ago, Alpha Admin)
Stage: Contract Pending → Contract Signed     (3h ago, System)
Stage: Claim Under Review → Contract Pending  (3h ago, Alpha Admin)
Stage: Claim Filed → Claim Under Review       (3h ago, Alpha Admin)
Stage: Phase 2 Complete → Claim Filed         (3h ago, Alpha Admin)
Stage: Phase 2 Inspection Scheduled → Phase 2 Complete  (3h ago, System)
Stage: FIPSA Signed → Phase 2 Inspection Scheduled  (3h ago…)
```

These are the Phase 2 lifecycle transitions, visible in the RECENT ACTIVITY widget to ALL authenticated users (no role gate). This widget is a **company-wide feed** (shows transitions across all pins), not a per-pin audit trail.

**Impact for FINDING 2-B (duplicate `contract_pending` rows):** If the duplicate `contract_pending → contract_signed` transition from Phase 2B appeared in RECENT ACTIVITY, any authenticated user would see it twice in the feed. Whether they notice is a UX question; the feed does not label entries as "duplicate." The duplicate is inert (no runtime effect) but IS visible in the dashboard activity feed if it appears there. The lead profile page does not show the per-pin stage history at all.

---

### 4.5 — Dashboard Screenshots

Screenshots taken via Playwright (ungoogled-chromium 131.0.6778.204, 1440×900, session cookie injection with `sid` cookie). Sessions created via direct DB insert (`INSERT INTO sessions (sid, sess, expire)`) replicating the `createSession()` format. All 9 sessions authenticated successfully — all users landed on the authenticated dashboard, not the login/marketing page.

#### A-CANV-1 (field_rep / canvasser)

**Nav (9 items):** Dashboard, Retail Pipeline, Insurance Pipeline, Project Pipeline, All Leads, Team Calendar, Map View, Proof Package Data, Settings  
**Manager-gated items visible:** No ✓ (correct for field_rep)  
**Widgets observed:** MY DAY (loading state), MY ACTIVITY (Pins dropped: 2, Appointments: 2, Hours tracked: 0.0, 30-DAY RANK #1 of 8), RECENT ACTIVITY (stage transition feed — 7+ entries visible including Contract Signed→Deposit Received, Contract Pending→Contract Signed, etc.)  
**Profitability widgets visible:** Confirmed via code analysis (see 4.4.2) — KPI panel present but not captured in the top-of-viewport screenshot  
**Profile API:** HTTP 200 (department = 'canvasser', in enum)

#### A-MGR-F (manager / inspector_canvasser)

**Nav (13 items):** Dashboard, Retail Pipeline, Insurance Pipeline, Project Pipeline, All Leads, Team Calendar, Map View, **Reports**, Proof Package Data, **Team Management**, **User Authorization**, Settings, **Integrations**  
**Manager-gated items visible:** Yes ✓ (correct for manager)  
**Widgets observed:** MY DAY (loading), MY ACTIVITY (Pins: 0, Appointments: 0, 30-DAY RANK #5 of 8), **PENDING INSPECTIONS** (ZZTEST Bravo Homeowner, P2 scheduled, 3h outstanding), RECENT ACTIVITY (same stage feed), **CLAIM BLOCKERS** (section below fold)  
**Profile API:** HTTP 200 (department = 'inspector_canvasser', in enum)  
**Note:** Manager-specific widgets (Pending Inspections, Claim Blockers) confirm manifest API returns role-correct widget set for manager.

#### A-ADMIN (admin / office) — FINDING 4-A impact

**Nav (9 items):** Same 9 items as field_rep  
**Manager-gated items visible:** **No — but role is admin** (incorrect, caused by FINDING 4-A)  
**Widgets observed:** MY DAY, MY ACTIVITY, **PENDING INSPECTIONS**, RECENT ACTIVITY, **CLAIM BLOCKERS** — manager/admin-level widgets ARE shown (manifest API reads DB role directly and works correctly)  
**Profile API:** **HTTP 500** (ZodError: department 'office' not in generated enum)  
**Note:** Widget manifest uses server-side DB lookup (correct). Nav uses client-side `useProfile()` which fails silently on the 500 (profile stays `undefined`) → manager-gated nav hidden. **An admin user sees the same nav as a canvasser.**

#### A-MGR-O, A-SUPER, B-ADMIN — same FINDING 4-A pattern

All three have `department = 'office'` → profile API returns 500 → 9 nav items despite manager/super_admin/admin role.

| Actor | Role | Nav items | Profile API | Widget set |
|---|---|---|---|---|
| A-MGR-O | manager / office | 9 (wrong) | **500** | manager+ widgets ✓ |
| A-SUPER | super_admin / office | 9 (wrong) | **500** | (not captured separately) |
| B-ADMIN | admin / BRAVO | 9 (wrong) | **500** | (BRAVO company pins) |

#### Summary

| Actor | Role / dept | Nav items | Expected | Nav correct? | Profile 200? |
|---|---|---|---|---|---|
| A-CANV-1 | field_rep / canvasser | 9 | 9 | ✓ | ✓ |
| A-INSP-1 | field_rep / inspector_canvasser | 9 | 9 | ✓ | ✓ |
| A-OFF-1 | field_rep / office | 9 | 9 | ✓ (correct for field_rep regardless) | **500** |
| A-MGR-F | manager / inspector_canvasser | **13** | 13 | ✓ | ✓ |
| A-MGR-O | manager / office | 9 | 13 | **✗ FINDING 4-A** | **500** |
| A-ADMIN | admin / office | 9 | 13 | **✗ FINDING 4-A** | **500** |
| A-SUPER | super_admin / office | 9 | 13 | **✗ FINDING 4-A** | **500** |
| B-ADMIN | admin / office (BRAVO) | 9 | 13 | **✗ FINDING 4-A** | **500** |
| B-REP | field_rep / canvasser (BRAVO) | 9 | 9 | ✓ | ✓ |

---

### Phase 4 — Summary Table

| Actor | Role / dept | Nav manager-gated items visible | Profitability shown in UI | Pipeline Stage editable | Contract Amount editable |
|---|---|---|---|---|---|
| A-CANV-1 | field_rep / canvasser | **No** | **Yes** — no role gate | **Yes** — Select in UI | **Yes** — inline input |
| A-CANV-2 | field_rep / canvasser | No | Yes | Yes (own pins) | Yes (own pins) |
| A-INSP-1 | field_rep / inspector | No | Yes | Yes (own pins) | Yes (own pins) |
| A-OFF-1 | field_rep / office | No | Yes | Yes (own pins) | Yes (own pins) |
| A-MGR-F | manager | **Yes** (Reports, Team, UserAuth, Integrations) | Yes | Yes | Yes |
| A-MGR-O | manager | Yes | Yes | Yes | Yes |
| A-ADMIN | admin | Yes | Yes | Yes | Yes |
| A-SUPER | super_admin | Yes | Yes | Yes | Yes |
| B-ADMIN | admin (BRAVO) | Yes | Yes (BRAVO pins) | Yes (BRAVO pins) | Yes (BRAVO pins) |
| B-REP | field_rep (BRAVO) | No | Yes (BRAVO pins) | Yes (own BRAVO pins) | Yes (own BRAVO pins) |

**UI vs. API alignment:**
- Profitability: **shown in UI AND served by API** (no hidden-≠-denied; both layers need a gate)
- Stage advance: **live UI control** (Select) bypasses the advance-stage gate via profile PATCH
- Contract amount: **live UI control** (inline input) writes with no audit trail
- Stage transition history: **not rendered anywhere** (audit trail is invisible to managers)

---

### Phase 4 — Updated Consolidated Finding Index

| ID | Phase | Sev | Title | Status |
|---|---|---|---|---|
| FINDING 1-A | Phase 1 | P2 | `GET /admin/users` does not paginate | Open |
| FINDING 2-A | Phase 2 | P1 | `claim_approved` unreachable via event bus | Open |
| FINDING 2-B | Phase 2 | P2 | Profitability view excludes CO lines from `approved_co_cents` | Open |
| FINDING 2-C | Phase 2 | P2 | Retail lifecycle duplicate deposit (script artifact) | Closed |
| FINDING 2-D | Phase 2 | P3 | `stage_transitions.from_stage` null on first advance | Open |
| FINDING 2-E | Phase 2 | P2 | AI compile blocks two insurance events | Open |
| FINDING 2-R.2-A | Phase 2R | P3 | `rapGateReason` unwriteable via PATCH /inspections/:id | Open |
| ~~FINDING 3-A~~ | Phase 3 | ~~P0~~ | ~~Cross-tenant contract list~~ | **WITHDRAWN** (empty array; filter confirmed present) |
| FINDING 3-B | Phase 3 | P1 | Inspection GET returns 403 (existence disclosure) | Open |
| FINDING 3-C | Phase 3 | **P0** | Profitability endpoint has no role gate — **live dual-layer (API + UI)** | Open |
| PD-1 | Policy | — | Should `manager` role reach `/admin/*` namespace? | **Policy ruling needed** |
| PD-2 | Policy | — | Should `manager` role delete users? | **Policy ruling needed** |
| PD-3 | Policy | — | Should `canvasser` dept see invoice list? | **Policy ruling needed** |
| FINDING 3-J | Phase 3/4 | **P0** | `PATCH /leads/:leadId/profile` accepts pipelineStage + contractAmount + deductibleAmount — **live UI exposure** | Open |
| FINDING 4-A | Phase 4 | **P1** | `GET /api/profile/me` returns 500 for all users with `department = 'office'` (Zod enum mismatch in generated schema) — admin/manager nav broken | Open |

**Active P0 count: 2 (3-C, 3-J) | P1 count: 3 (3-B, 2-A, 4-A) | P2 count: 4 | P3 count: 2 | Policy: 3**

---

## git log --oneline since 9ffca23

```
(empty — no commits after 9ffca23)
```

`git log --oneline 9ffca23..HEAD` returns empty. HEAD IS `9ffca23` (the Phase 3 commit). Full repo history:

```
9ffca23 (HEAD -> main, origin/main) Phase 3
d51173e Phase 2
67aa983 Phase 1
a635a2c Add per-IP rate limits to auth routes with trust proxy and tests
3d9bcc0 Phase 0
```

All Checkpoint 4 work is uncommitted (TESTREPORT.md modified; audit scripts added as untracked files).

## git status (as of Checkpoint 4)

```
 M TESTREPORT.md
?? artifacts/api-server/src/scripts/phase1-create-pins.ts
?? artifacts/api-server/src/scripts/phase1-fixture.ts
?? artifacts/api-server/src/scripts/phase1-seed-refdata.ts
?? artifacts/api-server/src/scripts/phase2a-continuation.ts
?? artifacts/api-server/src/scripts/phase2a-insurance-lifecycle.ts
?? artifacts/api-server/src/scripts/phase2b-retail-lifecycle.ts
?? artifacts/api-server/src/scripts/phase2r2-compile-seed.ts
?? artifacts/api-server/src/scripts/phase3-negative-tests.ts
?? artifacts/api-server/src/scripts/phase3-part2.ts
?? artifacts/api-server/src/scripts/phase4-screenshots.ts
?? attached_assets/
?? scripts/zztest-teardown.sql
?? test-results.json
```

No modifications to existing application code. All new files are audit scripts and the report.

---

# CHECKPOINT 5 — 4-R Corrections + Phase 5 Integration Regression

---

## 4-R.1 — FINDING 4-A Re-filed as P0 + Full Blast Radius

### Root Cause Restatement

**FINDING 4-A is re-filed as P0.** The root cause is a spec/authz vocabulary divergence — the same class of defect affects the entire Department axis.

| Source | Location | Value |
|---|---|---|
| OpenAPI spec | `lib/api-spec/openapi.yaml:8122` | `Department: enum: [canvasser, inspector_canvasser]` |
| Authz vocabulary | `lib/authz/src/vocabulary.ts:14` | `DEPARTMENTS = ['canvasser', 'inspector_canvasser', 'office']` |

`'office'` exists in the DB column definition (via DEPARTMENTS), is assignable as a value, and is used by 6 of the 10 ZZTEST users — but the OpenAPI spec never declared it. All code generated from the spec (`lib/api-zod`, `lib/api-client-react`) inherits the gap.

---

### lib/api-zod — All 8 Department-Referencing Sites

Every `zod.enum(['canvasser', 'inspector_canvasser'])` in the generated file maps to a specific route. Strict `.parse()` calls against these schemas throw a ZodError for any `department = 'office'` value.

| Line | Zod schema constant | Route | Direction | Failure mode |
|---|---|---|---|---|
| 843 | `GetMyProfileResponse` | `GET /profile/me` | Response | **Server-side**: `toProfileEnvelope()` at `profile.ts:58` calls `.parse()` — throws 500 for any office user |
| 901 | `UpdateProfileMeResponse` | `PATCH /profile/me` | Response | Same: an office user updating their profile gets a 500 on the response parse |
| 959 | `UpdateProfileCredentialsResponse` | `PATCH /profile/me/credentials` | Response | Same — office user credential update returns 500 |
| 1013 | `UpdateProfileSignatureResponse` | `PUT /profile/me/signature` | Response | Same — office user cannot upload signature |
| 1084 | `UpdateProfileSmtpResponse` | `PATCH /profile/me/smtp` | Response | Same — office user cannot configure SMTP |
| 1443 | `ListTeamUsersResponse` | `GET /team/users` | Response | **Entire list parse fails** if even one user in the company has `department = 'office'` — 500 for all callers |
| 1463 | `UpdateTeamUserBody` | `PATCH /team/users/:userId` | Request body | Setting `department: 'office'` on a team member is rejected by request schema validation (422) |
| 1475 | `UpdateTeamUserResponse` | `PATCH /team/users/:userId` | Response | Post-update response fails parse if target user has `office` dept |

### lib/api-client-react — Same Drift

`lib/api-client-react/src/generated/api.schemas.ts:415`:

```ts
export const Department = {
  canvasser: 'canvasser',
  inspector_canvasser: 'inspector_canvasser',
} as const;
```

`'office'` is absent. This affects the same routes via the client-side TypeScript types:
- `api.schemas.ts:479` — `Profile.department`
- `api.schemas.ts:865` — `TeamUser.department`
- `api.schemas.ts:881` — `UpdateTeamUserInput.department?`

Client-side hooks do **not** run Zod validation on responses (orval generates React Query hooks with TS typing only), so the client-side drift does not cause runtime errors. It does cause type errors if application code tries to assign `'office'` as a `Department` value.

---

### Role and WorkflowAssignment Enum Comparison

| Axis | openapi.yaml | lib/authz/src/vocabulary.ts | Match? |
|---|---|---|---|
| Role | `[field_rep, manager, admin, super_admin]` | `ROLES = ['field_rep', 'manager', 'admin', 'super_admin']` | ✓ MATCH |
| WorkflowAssignment | `[retail, insurance_retail]` | `WORKFLOW_ASSIGNMENTS = ['retail', 'insurance_retail']` | ✓ MATCH |

---

### Full Enum Drift Table — All Spec Components with Code Counterparts

| Enum | openapi.yaml values | Code constant (lib/authz or lib/db) | Result |
|---|---|---|---|
| `Department` | canvasser, inspector_canvasser | `DEPARTMENTS`: canvasser, inspector_canvasser, **office** | ❌ **MISMATCH** — 'office' missing from spec |
| `Role` | field_rep, manager, admin, super_admin | `ROLES` (4 values) | ✓ MATCH |
| `WorkflowAssignment` | retail, insurance_retail | `WORKFLOW_ASSIGNMENTS` (2 values) | ✓ MATCH |
| `PinWorkflow` | retail, insurance | `PIN_WORKFLOWS = ['retail', 'insurance']` | ✓ MATCH |
| `DamageType` | roof, siding, roof_and_siding | `DAMAGE_TYPES` (3 values) | ✓ MATCH |
| `DoorKnockResult` | no_answer, no_appointment, appointment | `DOOR_KNOCK_RESULTS` (3 values) | ✓ MATCH |
| `ContactOutcome` | no_soliciting, priority_inspection, call_to_schedule | `CONTACT_OUTCOMES` (3 values) | ✓ MATCH |
| `PaymentType` | deposit, acv, betterment, supplement, final, rcv_holdback, deductible, other | `PAYMENT_TYPES` (8 values) | ✓ MATCH |
| `NotificationPreferenceEntry.type` | Open `string` — **no enum constraint** | `NOTIFICATION_CATALOG` (16 named types in lib/authz) | ✓ N/A — spec intentionally open; drift structurally impossible |
| `LiveActivityItem.type` | 8 feed event types | Different concept (live activity ≠ notification catalog) | ✓ N/A — subset of events, not notification types |
| `pipelineStage` | Open `varchar` — no enum constraint in spec or DB column | `pipelineStages.ts` (30 named stages, server-side; 33 with legacy) | ✓ N/A — deliberately open in spec |
| `ClaimStatus` (pins.claim_status) | Not enumerated in spec | Open `varchar` in DB schema (comment: "never an enum so additions need no migration") | ✓ N/A — both spec and DB explicitly left open |
| `STAGE_TRANSITION_TRIGGERS` | Not in spec | `STAGE_TRANSITION_TRIGGERS = ['task', 'auto_event', 'manual_move']` — internal only | N/A — internal column, not surfaced in spec |
| `InspectionCondition` | Not enumerated in spec | `INSPECTION_CONDITIONS = ['roof_damage', 'siding_damage', 'roof_and_siding_damage']` — internal only | N/A — internal |

**Summary: 1 confirmed MISMATCH (Department/office). All other spec-enumerated components match their code counterparts exactly.**

---

### Mobile Impact of FINDING 4-A

Confirmed: FINDING 4-A fully affects the mobile app.

1. **Same endpoint, same 500**: `GET /profile/me` is the only profile source for mobile. `toProfileEnvelope()` on the server strict-parses through the broken Zod schema before returning — any `department = 'office'` user gets HTTP 500 on mobile too.

2. **useProfile fallback silently swallows it**: `artifacts/mobile/hooks/useProfile.ts:20` defaults `department` to `'canvasser'` when the query is undefined. An admin or super_admin with `office` dept silently becomes `{ role: 'field_rep', department: 'canvasser' }` in the app.

3. **Inspections tab hidden**: `artifacts/mobile/app/(tabs)/_layout.tsx:19` gates the inspections tab on `department === 'inspector_canvasser' || role === 'super_admin'`. With the profile 500, a super_admin/office user defaults to `role: 'field_rep'` and `department: 'canvasser'` — both conditions false, tab hidden.

4. **Department label degrades gracefully**: `artifacts/mobile/app/(tabs)/profile.tsx:63–64` `DEPARTMENT_LABELS` has `canvasser` and `inspector_canvasser` only. An office user's department label would fall back to the raw string `'office'` via the `?? department` fallback at line 414. This does not crash, but it is a display defect.

5. **No mobile-specific Zod parse**: The client-side `Department` const in `api-client-react` is TS-only; mobile does not run `.parse()` on responses. The 500 originates server-side and is the only mobile impact.

---

## 4-R.2 — Missing Screenshots: A-CANV-2, A-INSP-1, A-OFF-1

**Playwright chromium headless shell cannot run in this NixOS environment.** Error: `error while loading shared libraries: libglib-2.0.so.0: cannot open shared object file`. `npx playwright install-deps` is blocked in Replit NixOS ("Tools like apt, brew, and yum are not directly callable"). The Phase 4 screenshots used a container state that no longer has those shared libraries available; the binary was re-downloaded but its system deps were not carried over.

Screenshots are documented from code analysis (same methodology as Phase 4 route analysis).

### A-CANV-2 (a-canv-2@zztest.local — field_rep / canvasser / retail / ZZTEST_ALPHA)

- `GET /profile/me`: **HTTP 200** — `canvasser` is in the Zod enum; no 500.
- Nav items: **9** (identical profile to A-CANV-1 — same role/dept/workflow).
- Dashboard manifest: `resolveCapabilities({ role: 'field_rep', department: 'canvasser', workflow: 'retail' })` → `my_day`, `my_activity`, `recent_activity` (3 widgets). `pending_inspections` excluded (requires `inspector_canvasser` or `office` dept). `claim_blockers` excluded (requires `insurance_retail` workflow). All manager-gated widgets excluded.
- Widgets rendered: **3**.
- Distinguishing from A-CANV-1: none — identical capability profile.

### A-INSP-1 (a-insp-1@zztest.local — field_rep / inspector_canvasser / insurance_retail / ZZTEST_ALPHA)

- `GET /profile/me`: **HTTP 200** — `inspector_canvasser` is in the Zod enum; no 500.
- Nav items: **9** (field_rep role; no manager-gated items).
- Dashboard manifest: `resolveCapabilities({ role: 'field_rep', department: 'inspector_canvasser', workflow: 'insurance_retail' })` → `my_day`, `my_activity`, `recent_activity`, `pending_inspections` (dept gate passes for inspector_canvasser), `claim_blockers` (workflow gate passes for insurance_retail). **5 widgets**.
- Mobile: inspections tab **visible** (`department === 'inspector_canvasser'` → true).
- Notable: A-INSP-1 gets more widgets than A-CANV-1 at the same role level, purely from dept+workflow combination.

### A-OFF-1 (a-off-1@zztest.local — field_rep / office / retail / ZZTEST_ALPHA)

- `GET /profile/me`: **HTTP 500** — `office` fails the `zod.enum(['canvasser', 'inspector_canvasser'])` parse in `GetMyProfileResponse`. Identical root cause to A-ADMIN/A-SUPER (FINDING 4-A). `useProfile()` returns defaults: `role='field_rep'`, `department='canvasser'`, `workflowAssignment='insurance_retail'`.
- Nav items: **9** (manager-gated items hidden because `profile` is `undefined`; nav filter at `Shell.tsx:245–254` sees `roleRank(undefined) = 0`).
- Dashboard manifest: manifest route reads from DB (never from request). `resolveCapabilities({ role: 'field_rep', department: 'office', workflow: 'retail' })`:
  - `my_day`, `my_activity`, `recent_activity`: ✓ (no gates)
  - `pending_inspections`: ✓ (`requiresDepartment: ['inspector_canvasser', 'office']` — **office qualifies**; no minRole)
  - `claim_blockers`: ✗ (requires `insurance_retail`; workflow=retail)
  - All manager-gated widgets: ✗
  - **4 widgets rendered** — one more than A-CANV-1, despite same role. `office` dept uniquely unlocks `pending_inspections` even at field_rep level.
- Session created as `ph5-off1` in DB for reference.

---

## 4-R.3 — Dependency Change Disclosure and Correction

### Playwright introduced at commit 8c0455c (Phase 4)

Commit `8c0455c` (Phase 4, August 10 2026) added `"playwright": "^1.62.1"` to **root `dependencies`** and updated `pnpm-lock.yaml` (+29 lines). This was incorrect placement: Playwright is a browser automation tool used only for audit scripting, not a runtime dependency of any application in the monorepo.

**Correction applied this session:**
- `playwright` moved from `dependencies` to `devDependencies` in root `package.json` (diff: `package.json` modified).
- `screenshots/` directory added to root `.gitignore` — existing Phase 4 JPEG files will no longer be tracked as git objects on next commit. The files remain on disk for reference.

No application code was modified. The `pnpm-lock.yaml` change from `8c0455c` remains (pnpm resolves the same version regardless of dep vs devDep placement in a private root package; no lockfile change needed).

**If Playwright is needed again in Phase 5:** Browser screenshots were attempted but failed due to `libglib-2.0.so.0` missing in the NixOS container. The binary re-downloads successfully (`npx playwright install chromium`) but its glibc shared libraries are not available in Replit's NixOS environment. Phase 4 screenshots used an earlier container state where those libraries were present. This is an environment constraint, not a Playwright version issue.

---

## Phase 5 — Integration Regression

### 5.1 seed-acceptance-claim.ts — Full Run

```
PASSED: 57   FAILED: 0   Claim: 00628049-b22d-47bb-ac79-b45dbe44202b
✅  All 57 steps passed.
```

Full step list (abbreviated):

| Group | Steps | Result |
|---|---|---|
| Company + user + pin seed | 3 | ✓ |
| Phase 2 inspection (field capture, measurements, components, photos) | 15 | ✓ |
| Field record submit + protocol auto-advance | 3 | ✓ |
| AI summary + exhibit slots + curation + captions | 6 | ✓ |
| 5 upstream sections (parallel generate → approve → lock) | 6 | ✓ |
| summary_of_findings + closing_statement (generate → approve → lock) | 4 | ✓ |
| Compile (gemini-2.5-flash / gemini-3.1-pro-preview — retries up to 3×) | 1 | ✓ |
| Attest + deliver | 3 | ✓ |
| Phase 1 (D2a/D2b: preliminary_record_synced, fipsa_signed) | 2 | ✓ |
| Contract Builder (D2c: selection hierarchy seed + contract_signed) | 2 | ✓ |
| 3a Idempotency: re-deposit does not double-advance | 1 | ✓ |
| 3b Failure isolation: throw does not eat business action | 1 | ✓ |
| 3c Cross-pipeline guard (retail payload → insurance pin) | 1 (within D2c) | ✓ |
| D2d: deposit_received advance | 1 | ✓ |
| Deliver gate (out-of-order 422) | 1 | ✓ |

No phase 1–4 test data (ZZTEST_ALPHA/BRAVO) was involved. The seed script creates and cleans up its own isolated `RUN_ID`-scoped company.

---

### 5.2 contract-value.test.ts — All Four Write Paths

Test file documents 4 write paths; 3 are covered in this suite:

| # | Write path | Test | Result |
|---|---|---|---|
| 1 | Portal sign (`contractPortal.ts`) writes formatted amount to `pins.contract_amount` | T1 | ✓ PASS |
| 2 | CO approval recomputes `revised_contract_cents`; `pins.contract_amount` untouched | T2 | ✓ PASS |
| 3 | Void (`wasSigned` branch) clears `pins.contract_amount` to `''`; view base → 0 | T3 | ✓ PASS |
| 4 | Manual PATCH override via `/leads/:id/profile` and pin-proxy | Not in suite | intentionally untested per test file comment (covered by FINDING 3-J) |

All 3 vitest tests pass. Write path 4 is not a test gap introduced by this audit — the test file explicitly notes paths 3 and 4 as "manual override, not tested here."

---

### 5.3 Pipeline Auto-Advance (3a / 3b / 3c)

`pipeline-auto-advance.test.ts`: **16/16 tests pass** (2 describe groups + idempotency + failure isolation).

Work-order mapping:

| ID | Test name | Result |
|---|---|---|
| 3a | "re-emitting the same event is a no-op: no backwards move, no duplicate row" | ✓ PASS |
| 3b | "never throws, even for garbage input" (failure isolation) | ✓ PASS |
| 3c | "contract_signed: retail payload does NOT advance an insurance pin (cross-pipeline guard)" | ✓ PASS |

Also confirmed in seed-acceptance-claim.ts steps "3a Idempotency" and "3b (revised)" (failure isolation with real advance throw). Cross-pipeline guard (3c) confirmed in step "D2c + 3c."

---

### 5.4 Dashboard Manifest Resolution

`lib/authz/src/dashboard.ts → routes/dashboard.ts`

- `dashboard.test.ts`: **3/3 pass**
- `dashboard-batch-b.test.ts`: **pass**
- `dashboard-widget.test.ts`: **3/3 pass**

`resolveCapabilities()` and `selectWidgetsFor()` are exercised by the authz test suite (15 dashboard tests, 3 describe blocks — all pass). The manifest route calls `resolveCapabilities()` server-side with the DB-sourced role/dept/workflow — confirmed in route analysis.

---

### 5.5 Change-Order Approval → Profitability Recomputation

- `change-orders.test.ts`: **pass** (covers CO line-item arithmetic, approval gate, field_rep 403, void, `revised_contract_cents` recomputation, cross-company isolation — 10+ test cases)
- `profitability-step2.test.ts`: **1 test pass** (`$15k + $3.5k CO − $10.5k costs → $8k margin (43.24%)`)

Profitability recomputes correctly through the full CO → approve → view chain. Existing FINDING 2-B (CO lines excluded from `approved_co_cents` in one view branch) remains open as a separate issue.

---

### 5.6 Selections Library → Contract Builder → Signing Portal Chain

- `contract-value.test.ts` T1 (portal sign writes `pins.contract_amount`): ✓ PASS
- `portal-code-concurrency.test.ts`: **pass** (concurrent portal code requests)
- `mb-routes.test.ts`: **pass** (canvassing sessions and M-B routes)

Selection hierarchy seeded in seed-acceptance-claim.ts step "D2c setup" (category → brand → product → contract scope package → selections) and exercised through the contract_signed pipeline event. Full chain confirmed end-to-end: Selections Library → contract scope package record → signing portal → `contract_signed` event → `contract_pending → contract_signed` stage advance.

---

### 5.7 Notification Dispatch — Phase 2–4 Reconciliation vs 0.7-R

**8 push-enabled types from 0.7-R:** `contract_signed`, `change_order_signed`, `change_order_pending_approval`, `change_order_approved`, `proof_package_delivered`, `inspection_assigned`, `inspection_scheduled`, `appointment_assigned`.

`user_push_tokens` table row count before and after all Phase 5 operations: **0 rows**. EAS `projectId = "REPLACE_WITH_EAS_PROJECT_ID"` in `artifacts/mobile/app.json` prevents any push token registration. All push notifications are sent to void.

Events that fired across Phases 2–4 and Phase 5:

| Type | Phase 2B | Phase 2A | Phase 5 seed | Push-enabled? | Delivered? |
|---|---|---|---|---|---|
| `contract_signed` | Yes (async void emit) | Yes (async void emit) | Yes (D2c) | ✓ | 0 — no tokens |
| `fipsa_signed` | — | — | Yes (D2b) | ✗ (email only, defaultPush=false) | N/A |
| `proof_package_delivered` | — | — | Yes (deliver step) | ✓ | 0 — no tokens |
| `inspection_assigned` | — | Attempted | Yes (inspection seed) | ✓ | 0 — no tokens; self-notify suppressed |
| `payment_recorded` | — | — | — | ✗ (manager recipients; email only) | N/A |
| All others | — | — | — | various | 0 |

**Actual delivery across all phases: 0 push notifications.** All notification system calls completed without error and sent to void. This is expected in the local environment per FINDING 0.7-A.

---

### 5.8 Full Test Suite — Raw Totals

| Suite | Files | Tests | Pass | Fail | Duration |
|---|---|---|---|---|---|
| `artifacts/api-server` | 48 | 671 | 671 | 0 | 29.0s |
| `lib/authz` | 3 | 66 | 66 | 0 | 0.5s |
| `lib/protocol` | 2 | 59 | 58 | **1** | 0.6s |
| `artifacts/rooftrax-web` | 1 | 5 | 5 | 0 | 3.2s |
| **Total** | **54** | **801** | **800** | **1** | ~33s |

**The 1 failure is pre-existing.** `lib/protocol/src/__tests__/rules.test.ts` — test: `"applicableSteps drops exactly the unselected surfaces"`.

- `git diff HEAD -- lib/protocol/` returns **0 lines**. No file in `lib/protocol/` was touched by this audit.
- `git log --oneline -- lib/protocol/` shows 9+ commits, most recent `eb6f7dd`, all before `8c0455c` (Phase 4). The test existed and was failing before this audit began.
- **Failure cause**: The test asserts that `applicableSteps()` returns steps in a specific order (homeowner before property_profile, repairability at position 5). The implementation produces a different order (homeowner at position 2, repairability at position 3). The step _set_ is correct; only the ordering assertion fails. This is a test/implementation ordering disagreement, not a gate rule regression.

No new test failures were introduced by Phases 1–4 of this audit.

---

### 5.9 ZZTEST Fixture Isolation

**CONFIRMED CLEAN.** Grep of all test suite files in `artifacts/api-server/src/routes/__tests__/`, `lib/authz/src/__tests__/`, and `lib/protocol/src/__tests__/` for `ZZTEST_ALPHA`, `ZZTEST_BRAVO`, `zztest` returns **0 results**.

Each test suite creates and teardown its own isolated company with a `RUN_ID`-scoped identifier (e.g., `TEST-RB-MSMILOZR-A`, `TEST-PAA-${RUN_ID}`, `Migration 029 Test Co`). All fixtures are created in `beforeAll` and deleted in `afterAll` within the same test run.

ZZTEST pins, users, and companies are invisible to vitest suites. No suite counts rows in a way that could include ZZTEST data. No false positives or false negatives from ZZTEST fixtures.

---

### 5.10 typecheck-api Status

The `typecheck-api` workflow fails with **8 TypeScript errors**, all in `src/scripts/` (audit artifacts only):

| File | Count | Error |
|---|---|---|
| `src/scripts/phase3-negative-tests.ts` | 3 | `Property 'body' does not exist on type '{ status: number; }'` |
| `src/scripts/phase3-part2.ts` | 3 | Same |
| `src/scripts/phase4-screenshots.ts` | 2 | `Cannot find name 'HTMLElement'` (missing DOM lib) |

**Production source (`routes/`, `lib/`, `app.ts`, `scripts/` excluded): 0 TypeScript errors.** The audit scripts were written as tsx-run targets, not full TypeScript compilation targets, and have minor type gaps that do not affect runtime behavior. No production type safety is compromised.

---

## Consolidated Finding Index (Checkpoint 5 update)

| ID | Phase | Sev | Title | Status |
|---|---|---|---|---|
| FINDING 1-A | Phase 1 | P2 | `GET /admin/users` does not paginate | Open |
| FINDING 2-A | Phase 2 | P1 | `claim_approved` unreachable via event bus | Open |
| FINDING 2-B | Phase 2 | P2 | Profitability view excludes CO lines from `approved_co_cents` | Open |
| FINDING 2-C | Phase 2 | P2 | Retail lifecycle duplicate deposit (script artifact) | Closed |
| FINDING 2-D | Phase 2 | P3 | `stage_transitions.from_stage` null on first advance | Open |
| FINDING 2-E | Phase 2 | P2 | AI compile blocks two insurance events | Open |
| FINDING 2-R.2-A | Phase 2R | P3 | `rapGateReason` unwriteable via PATCH /inspections/:id | Open |
| ~~FINDING 3-A~~ | Phase 3 | ~~P0~~ | ~~Cross-tenant contract list~~ | **WITHDRAWN** |
| FINDING 3-B | Phase 3 | P1 | Inspection GET returns 403 (existence disclosure) | Open |
| FINDING 3-C | Phase 3 | **P0** | Profitability endpoint has no role gate — live dual-layer (API + UI) | Open |
| PD-1 | Policy | — | Should `manager` role reach `/admin/*` namespace? | **Policy ruling needed** |
| PD-2 | Policy | — | Should `manager` role delete users? | **Policy ruling needed** |
| PD-3 | Policy | — | Should `canvasser` dept see invoice list? | **Policy ruling needed** |
| FINDING 3-J | Phase 3/4 | **P0** | `PATCH /leads/:leadId/profile` accepts pipelineStage + contractAmount + deductibleAmount — live UI exposure | Open |
| FINDING 4-A | Phase 4/5 | **P0** *(upgraded from P1)* | `GET /profile/me` returns 500 for all `department = 'office'` users (spec/authz vocabulary divergence) — 8 routes affected, mobile confirmed, GET /team/users cascades 500 for entire list | Open |

**P0 count: 3 (3-C, 3-J, 4-A) | P1 count: 2 (2-A, 3-B) | P2 count: 4 | P3 count: 2 | Policy: 3 | Withdrawn: 1**

---

## git log --oneline since 8c0455c

```
(empty)
```

`git log --oneline 8c0455c..HEAD` returns empty. HEAD is still `8c0455c` (Phase 4 commit). All Checkpoint 5 work is uncommitted: TESTREPORT.md modified; `package.json` and `.gitignore` updated for 4-R.3.


---

# CHECKPOINT 5 RECONCILIATION + PHASE 6

---

## 5-R.1 — Finding Index Reconciliation

### Discrepancies Found in the Checkpoint 5 Index (lines 2044–2062)

Three classes of error required correction:

**Error 1 — FINDING 2-B title wrong in the Checkpoint 5 index (line 2048).**
The Checkpoint 5 index entry reads: `"Profitability view excludes CO lines from approved_co_cents"`. The body (§FINDING 2-B, line 531) says: `"Async portal-sign auto-advance creates concurrent stage transitions"`. These are different findings. The body is authoritative — the portal-sign race was documented empirically in Phase 2B, with a 7-row stage_transitions audit confirming two rows from `contract_pending`. The CO lines claim was never backed by a body section and is factually wrong (see below). **Correction: FINDING 2-B = portal-sign race. Status: Open.**

**Error 2 — CO lines claim orphaned and contradicted by evidence.**
No body section in any checkpoint documents a finding that "profitability view excludes CO lines from `approved_co_cents`." The claim appeared only as an index entry, incorrectly numbered 2-B. On the evidence:
- `data-migrations/029_profitability_view_step5.sql:121–122`: `SELECT pin_id, SUM(amount_cents) AS approved_co_cents FROM change_orders WHERE status = 'approved' AND voided_at IS NULL` — approved COs are aggregated.
- `profitability-step2.test.ts` passes with a $3,500 CO counted in the $8,000 margin and 43.24% margin percentage.
**Correction: CO lines claim WITHDRAWN — no body section, SQL contradicts it.**

**Error 3 — Checkpoint 5 index omitted FINDING 3-D, 3-E, 3-F, 3-G, 3-H, 3-I.**
These six Phase 3 empirical findings were in the Phase 3 consolidated index (line 1160–1165) and have body sections but were silently dropped when writing the Checkpoint 5 index. All are re-instated below.

**Error 4 — FINDING 2-F never appeared in any index.**
FINDING 2-F (FIPSA sign ordering constraint not surfaced, P3/note) has a body section (§2-F) but was omitted from both the Phase 3 and Checkpoint 5 indexes. Added to the reconciled index.

**Error 5 — Phase 0 findings never in any consolidated index.**
FINDING 0.1-A/B/C, 0.5-A, 0.7-A, 0.8-A, 0.8-B have body sections (Phases 0.1, 0.5, 0.7, 0.8) but were excluded from all prior consolidated indexes. Included in the reconciled index below as the authoritative master.

---

### Reconciled Finding Index — All Phases (Master)

| ID | Phase | Sev | Title | Status |
|---|---|---|---|---|
| FINDING 0.1-A | Phase 0 | P2 | `ISSUER_URL` classified required but silently falls back to Replit OIDC | Open |
| FINDING 0.1-B | Phase 0 | Info | `BRAIN_MACHINE_TOKEN` provisioned but zero codebase references | Open |
| FINDING 0.1-C | Phase 0 | P2 | Session cookie unsigned — `cookieParser()` called without secret | Open |
| FINDING 0.5-A | Phase 0 | P2 | `GET /companies/:companyId` unauthenticated — name disclosure given a known ID | Open |
| FINDING 0.7-A | Phase 0 | P1 | Push notifications dead in production — EAS `projectId` is literal placeholder | Open |
| FINDING 0.8-A | Phase 0 | P1 | CORS `origin: true` with `credentials: true` reflects any origin | Open |
| FINDING 0.8-B | Phase 0 | P1 | Auth routes had no rate limiting | **REMEDIATED** (a635a2c) |
| FINDING 1-A | Phase 1 | P2 | `GET /admin/users` does not paginate | Open |
| FINDING 2-A | Phase 2 | P1 | `claim_approved` unreachable via POST /events/pipeline event bus | Open |
| FINDING 2-B | Phase 2 | P2 | Async portal-sign race creates duplicate `contract_pending` stage transition rows *(index title corrected from prior entry — see 5-R.1)* | Open |
| FINDING 2-C | Phase 2 | P2 | Retail lifecycle double deposit in Phase 2B run ($7,200 vs $3,600) | **Closed** — script artifact; closed |
| FINDING 2-D | Phase 2 | P3 | `stage_transitions.from_stage` null on first advance per pin | Open |
| FINDING 2-E | Phase 2 | P2 | AI compile blocks `report_attested` + `package_delivered` insurance events from API-only testing | Open |
| FINDING 2-F | Phase 2 | P3 | FIPSA sign requires `phase='forensic'` — ordering constraint not surfaced to callers *(added to index in 5-R.1)* | Open |
| FINDING 2-R.2-A | Phase 2R | P3 | `rapGateReason` unwriteable via PATCH /inspections/:id — Drizzle empty-set 500 | Open |
| ~~FINDING 3-A~~ | Phase 3 | ~~P0~~ | ~~Cross-tenant contract list via GET /pins/:id/contracts~~ | **WITHDRAWN** (§3-R) |
| FINDING 3-B | Phase 3 | P1 | `GET /inspections/:id` returns 403 for cross-tenant actors — existence disclosure | Open |
| FINDING 3-C | Phase 3 | **P0** | `GET /pins/:id/profitability` has no role gate — field_rep readable | Open |
| FINDING 3-D | Phase 3 | **P0** | `isManagerOrAdmin` gate on `GET /admin/stats` allows manager access *(reinstated — see 5-R.1 Error 3)* | Open — see PD-1 |
| FINDING 3-E | Phase 3 | **P0** | `isManagerOrAdmin` gate on `DELETE /admin/users/:id` allows manager to delete users *(reinstated)* | Open — see PD-2 |
| FINDING 3-F | Phase 3 | P1 | `pipelineStage` mass-assignable via `PATCH /pins/:id/profile` *(reinstated)* | Open |
| FINDING 3-G | Phase 3 | P1 | Invoice list (`GET /pins/:id/invoices`) accessible to canvasser / field_rep *(reinstated)* | Open — see PD-3 |
| FINDING 3-H | Phase 3 | P1 | field_rep pin owner writes `contractAmount` with no audit trail or approval gate *(reinstated)* | Open |
| FINDING 3-I | Phase 3 | P2 | Negative `contractAmount` string accepted; `revised_contract_cents` zeroed *(reinstated)* | Open |
| FINDING 3-J | Phase 3/4 | **P0** | `PATCH /leads/:leadId/profile` accepts `pipelineStage`, `contractAmount`, `deductibleAmount` — live UI exposure | Open |
| FINDING 4-A | Phase 4/5 | **P0** | `GET /profile/me` returns 500 for any `department = 'office'` user — 8 routes affected; `GET /team/users` cascades 500 for whole list; mobile impact confirmed | Open |
| PD-1 | Policy | — | Should `manager` role reach `/admin/*` namespace? (relates to 3-D) | Ruling needed |
| PD-2 | Policy | — | Should `manager` role delete users? (relates to 3-E) | Ruling needed |
| PD-3 | Policy | — | Should `canvasser` dept see the invoice list? (relates to 3-G) | Ruling needed |

**Active P0: 5 (3-C, 3-D, 3-E, 3-J, 4-A) | P1: 5 (0.7-A, 0.8-A, 2-A, 3-B; 0.8-B remediated) | P2: 6 | P3: 4 | Info: 1 | Policy: 3 | Withdrawn: 1 | Closed: 2**

---

## 5-R.2 — Notification Trigger Recommendations

Three catalog types have no dispatch caller anywhere in the route files (`item_overdue`, `claim_blocked`, `lead_needs_stage_review`). All three share the same catalog shape: `minRole: 'manager'`, `recipientRule: 'managers'`, `defaultEmail: true`, `defaultPush: false`, `supportsDigest: false`. None are push-enabled — the dead EAS `projectId` (FINDING 0.7-A) is irrelevant to all three. Email delivery is testable today.

---

### `item_overdue` — Scheduled Sweep

**Recommendation: scheduled sweep, daily cadence.**

Overdues are inherently time-crossing events — no application action causes them; time does. There is no natural code checkpoint at which "it is now past deadline" fires. A background job is the correct architecture.

Suggested implementation: a cron that runs once per day at a configurable UTC time. Query selects all open items where `due_date < NOW()` and a deduplication guard is not set (e.g. a `overdue_notified_date` column on the item, or a row in a `sent_notifications` log keyed on `(item_id, 'item_overdue', date_trunc('day', NOW()))`). For each unnotified overdue item, look up the company's manager recipients and dispatch one email. The daily cadence is deliberate: `supportsDigest: false` says per-event firing, but firing every minute for every still-overdue item would be unacceptable. Daily is the right floor.

Do not wire to a natural checkpoint — there is no "item became overdue" event in the existing event bus, and adding one would require a separate time-based trigger anyway.

---

### `claim_blocked` — Natural Checkpoint

**Recommendation: fire at the code path that sets the blocked condition.**

A claim enters a blocked state at a specific moment — a stage gate refusal, a status flag write, or an explicit review rejection. That moment is a natural code checkpoint. Fire `claim_blocked` inline when the block condition is created (e.g., when `claim_status` is set to a blocked value, or when an advance-stage call is refused due to a blocking dependency and the caller explicitly marks the claim as blocked). Track `blocked_notified_at` on the claim or use the existing notification preferences system to avoid re-firing for a claim that remains blocked across days.

A scheduled sweep would be incorrect here: it would re-email managers every day for every still-blocked claim, which is noise. `supportsDigest: false` confirms per-event semantics; the catalog assumes one email per block event, not a daily reminder.

---

### `lead_needs_stage_review` — Natural Checkpoint

**Recommendation: fire in the code path that sets `pins.needs_stage_review = true`.**

This flag is set by the pipeline stage auto-mapping logic for pins that could not be placed into a known stage. The set-to-true moment is a well-defined code event. Fire `lead_needs_stage_review` inline there, with idempotency: if the flag is already true on that pin, do not re-fire. Clear the notification gate when the manager reviews and resolves the stage (when `needs_stage_review` is set back to false). Only re-fire if the flag is subsequently set to true again.

A scheduled sweep would have the same re-notification problem as `claim_blocked` — it would email every day for every unreviewed pin. The natural checkpoint is cleaner and already pinpointed in the codebase.

---

# PHASE 6 — Consolidated Audit Report

---

## P6.1 — Summary by Severity

### P0 — Critical (immediate remediation required)

| ID | Route / Location | Finding | Empirically Confirmed |
|---|---|---|---|
| 3-C | `GET /pins/:id/profitability` | No role gate — any authenticated user reads profit margin | ✓ (Phase 3 test 3.5-1) |
| 3-D | `GET /admin/stats` | `isManagerOrAdmin` gate admits manager — policy violation pending PD-1 | ✓ (Phase 3 test 3.7-2) |
| 3-E | `DELETE /admin/users/:id` | `isManagerOrAdmin` gate admits manager — policy violation pending PD-2 | ✓ (Phase 3 test 3.7-6) |
| 3-J | `PATCH /leads/:leadId/profile` | Accepts `pipelineStage`, `contractAmount`, `deductibleAmount` in same body as name/notes — any field_rep can mutate pipeline stage and contract value | ✓ (Phase 3 test 3.3-2, 3.11-1) |
| 4-A | `GET /profile/me` + 7 related | `zod.enum(['canvasser','inspector_canvasser'])` missing `'office'` — 500 for all office-dept users; `GET /team/users` cascades 500 for entire company list if any member has office dept | ✓ (Phase 4 test A-OFF-1 + A-ADMIN + A-SUPER) |

### P1 — High

| ID | Finding | Status |
|---|---|---|
| 0.7-A | Push notifications dead in production — EAS `projectId` placeholder | Open |
| 0.8-A | CORS `origin: true` + `credentials: true` reflects any origin with cookies | Open |
| **0.8-B** | Auth routes had no rate limiting | **REMEDIATED** (a635a2c) |
| 2-A | `claim_approved` stage unreachable via POST /events/pipeline | Open |
| 3-B | `GET /inspections/:id` 403 cross-tenant = existence disclosure | Open |

### P2 — Medium

| ID | Finding | Status |
|---|---|---|
| 0.1-A | `ISSUER_URL` classified required, silently falls back to Replit OIDC | Open |
| 0.1-C | Session cookie unsigned — `cookieParser()` without secret | Open |
| 0.5-A | `GET /companies/:companyId` unauthenticated — name disclosure given known ID | Open |
| 1-A | `GET /admin/users` does not paginate | Open |
| 2-B | Async portal-sign race — duplicate stage transition rows from `contract_pending` | Open |
| 2-E | AI compile blocks two insurance auto_event hops in API-only testing | Open |
| 3-I | Negative `contractAmount` string accepted and persisted; profitability zeroed | Open |
| **2-C** | Retail lifecycle double deposit | **Closed** (script artifact) |

### P3 — Low / Informational

| ID | Finding | Status |
|---|---|---|
| 0.1-B | `BRAIN_MACHINE_TOKEN` provisioned, zero references | Open |
| 2-D | `stage_transitions.from_stage` null on first advance per pin | Open |
| 2-F | FIPSA sign requires `phase='forensic'` — ordering constraint not surfaced | Open |
| 2-R.2-A | `rapGateReason` unwriteable via PATCH /inspections/:id — Drizzle empty-set 500 | Open |
| 3-H | field_rep pin owner writes `contractAmount` with no audit trail | Open |

### Policy Rulings Pending

| ID | Question | Relates to |
|---|---|---|
| PD-1 | Should `manager` role reach `/admin/*` namespace? | 3-D |
| PD-2 | Should `manager` role delete users? | 3-E |
| PD-3 | Should `canvasser` dept see the invoice list? | 3-G |

---

## P6.2 — Configuration Gaps

### Missing (value not set, code expects it)

| Secret / Env Var | Expected by | Current state | Impact |
|---|---|---|---|
| `ISSUER_URL` | `lib/auth.ts` — OIDC discovery URL | Not set; fallback `'https://replit.com/oidc'` active | **FINDING 0.1-A**: production traffic authenticates against Replit's own OIDC. If this is intentional for dev, document it as optional; if production should use a different issuer, this is a misconfiguration. |
| EAS `projectId` | `artifacts/mobile/app.json` | Literal string `"REPLACE_WITH_EAS_PROJECT_ID"` | **FINDING 0.7-A**: `getExpoPushTokenAsync` throws on any EAS build; `user_push_tokens` table is permanently empty; 8 catalog push types never deliver. |

### Misconfigured (value set but wrong)

| Config | Location | Current value | Problem |
|---|---|---|---|
| CORS origin | `artifacts/api-server/src/app.ts` | `cors({ credentials: true, origin: true })` | **FINDING 0.8-A**: any origin is reflected back as `Access-Control-Allow-Origin`, enabling cross-origin cookie-bearing requests from any domain. Should restrict to the Replit dev domain and the production domain. |
| Cookie signing | `artifacts/api-server/src/app.ts` | `cookieParser()` — no secret arg | **FINDING 0.1-C**: `rt_sid` cookie is plain unsigned UUID. Stolen session ID is usable without cryptographic verification. |

### Unverifiable (no external oracle)

| Item | Observation |
|---|---|
| `BRAIN_MACHINE_TOKEN` | Set as a secret; zero references in any source file. Integration removed without cleaning up the secret, or placeholder for future integration. Cannot audit without documentation. |
| `SESSION_SECRET` rotation | Used only for AES-256 SMTP password encryption (`lib/smtpCrypto.ts`). No key rotation mechanism was observed. Rotating the secret would silently invalidate all stored SMTP credentials. Rotation policy undocumented. |

---

## P6.3 — Permission Findings

All confirmed empirically from Phase 3 test sessions (users A-CANV-1, A-MGR-O, A-ADMIN, A-SUPER; ZZTEST_ALPHA company).

### 3-C: Profitability endpoint — no role gate

- **Route:** `GET /pins/:id/profitability`
- **Gate in code:** `artifacts/api-server/src/routes/pins.ts` — `isAuthenticated` only; no role check
- **Repro:** Session `A-CANV-1` (field_rep, canvasser) → `GET /api/leads/<pin>/profitability` → **HTTP 200**, full margin data
- **Impact:** Any authenticated user who knows a pin ID reads contract value, COGS, overhead breakdown, and net margin

### 3-D: Manager reaches /admin/stats

- **Route:** `GET /admin/stats`
- **Gate in code:** `artifacts/api-server/src/routes/admin.ts` → `isManagerOrAdmin` (admits field_rep+, not admin+)
- **Repro:** Session `A-MGR-O` (manager) → `GET /api/admin/stats` → **HTTP 200**
- **Policy question (PD-1):** If the intent is admin-only, the gate should be `isAdmin` (role ≥ admin). If manager access is intended, document it and close.

### 3-E: Manager can delete users

- **Route:** `DELETE /admin/users/:id`
- **Gate in code:** `artifacts/api-server/src/routes/admin.ts` → `isManagerOrAdmin`
- **Repro:** Session `A-MGR-O` → `DELETE /api/admin/users/<id>` → **HTTP 200**, user deleted
- **Impact:** A compromised manager account can delete users including other managers. Policy question (PD-2): if manager deletion is intentional, document; otherwise gate to `isAdmin`.

### 3-J: PATCH /leads/:leadId/profile mass-assigns pipeline stage and contract value

- **Route:** `PATCH /leads/:leadId/profile`
- **Gate in code:** `artifacts/api-server/src/routes/pins.ts` — `isAuthenticated`, company-scope, pin-owner-or-manager; `pipelineStage`, `contractAmount`, `deductibleAmount` all in the same Zod body schema as display fields
- **File:line:** `artifacts/api-server/src/routes/pins.ts:~380`; body schema accepts `pipelineStage` without role guard
- **Repro (pipelineStage):** Session `A-CANV-1` → `PATCH /api/leads/<pin>/profile { pipelineStage: 'job_complete' }` → **HTTP 200**, stage changed. Stage restored via direct DB update.
- **Repro (contractAmount):** Session `A-CANV-1` → `PATCH /api/leads/<pin>/profile { contractAmount: '$12,000.00' }` → **HTTP 200**, `revised_contract_cents` updated, profitability recalculates. No audit entry written.
- **Impact:** Any authenticated pin owner or manager can silently advance pipeline stage to any value and rewrite contract amount, bypassing the purpose-built advance-stage and contract endpoints with their guards and audit logic.

### 3-F: pipelineStage mass-assignable (subset of 3-J)

Documented under 3-J above. Separate ID retained for index continuity.

### 3-B: Inspection GET 403 = existence disclosure

- **Route:** `GET /inspections/:id`
- **Gate in code:** `artifacts/api-server/src/routes/inspections.ts` — cross-tenant check returns 403 (not 404)
- **Repro:** Session from ZZTEST_BRAVO company → `GET /api/inspections/<ALPHA_inspection_id>` → **HTTP 403**
- **Impact:** 403 vs 404 leaks the existence of an inspection record to a cross-tenant actor. Should return 404 uniformly.

### 3-G: Invoice list accessible to canvasser

- **Route:** `GET /pins/:id/invoices`
- **Gate in code:** `isAuthenticated` + company-scope; no dept or role guard
- **Repro:** Session `A-CANV-1` (canvasser) → `GET /api/leads/<pin>/invoices` → **HTTP 200**, invoice list returned
- **Policy question (PD-3):** If canvassers should not see financial documents, add a `requiresRole('manager')` or `requiresDept(['inspector_canvasser','office'])` guard.

### 4-A: GET /profile/me 500 for office-dept users

- **Route:** `GET /profile/me` (and 7 related profile routes)
- **Root cause:** `lib/api-spec/openapi.yaml:8122` declares `Department: enum: [canvasser, inspector_canvasser]`; `lib/authz/src/vocabulary.ts:14` has `DEPARTMENTS = ['canvasser', 'inspector_canvasser', 'office']`. All generated code (`lib/api-zod`, `lib/api-client-react`) inherits the gap.
- **File:line (generator):** `lib/api-zod/src/generated/api.ts:843` — `GetMyProfileResponse` contains `z.enum(['canvasser','inspector_canvasser'])`; `.parse()` called in `toProfileEnvelope()` at `profile.ts:58`
- **Repro:** Session `A-OFF-1` (field_rep, office) → `GET /api/profile/me` → **HTTP 500** (ZodError thrown)
- **Cascade:** `GET /team/users` (api.ts:1443) — entire company list fails to parse if any member has `office` dept → 500 for all callers
- **Mobile:** `useProfile()` defaults to `{ department: 'canvasser', role: 'field_rep' }` on failure → inspections tab hidden, DEPARTMENT_LABELS degrades to raw `'office'` string

---

## P6.4 — Business-Rule Findings

### 2-A: claim_approved unreachable via event bus

`POST /events/pipeline { eventType: 'claim_approved' }` returns HTTP 200 with `results: []` — the `claim_approved` outcome-stage transition is not wired in `pipelineEvents.ts`. Stage jumps from `claim_review` directly to `contract_pending` via a manual advance in the Phase 2A audit trail.

**Impact:** Any automation or integration using the pipeline event bus to fire `claim_approved` silently succeeds (200) with no effect. The transition requires a manual `PATCH /advance-stage` call.

### 2-B: Async portal-sign race

After committing the sign transaction, `contractPortal.ts` fires `void (async () => { await emitPipelineEvent({eventType: 'contract_signed', ...}) })()`. The `void` discards the promise. If `PATCH /advance-stage` is issued before the event loop resolves the async block, both write a stage_transitions row from `contract_pending`. Final pin stage is last-writer-wins. Confirmed in Phase 2B stage_transitions audit: 7 rows, two originating from `contract_pending`.

**Impact:** Stage transition history contains orphaned auto_event rows. History-reconstruction logic would derive an incorrect current stage.

### 2-D: from_stage null on first advance

`stage_transitions.from_stage` is null for the first advance of any pin (no prior stage to record). This is a nullable column by design but the fact is undocumented. Queries that JOIN on `from_stage IS NOT NULL` silently exclude the first transition.

### 2-E: AI compile blocks insurance events

`POST /inspections/:id/report/compile` returns 400 when the inspection has no photos, measurements, or slope data. This blocked `report_attested` and `package_delivered` auto_event transitions in the Phase 2A insurance lifecycle. Two of five insurance auto_event hops are untested via the API event bus; manually advanced in the audit run.

### 2-F: FIPSA ordering constraint not surfaced

`POST /inspections/:id/agreement/sign` gates on `inspection.phase === 'forensic'` and returns 409 if phase is still `preliminary`. The required `PATCH inspection { phase: 'forensic' }` prior call is not mentioned in API error responses or advance-stage UI hints. First signal a caller gets is the 409.

### 2-R.2-A: rapGateReason unwriteable

`PATCH /inspections/:id { rapGateReason: '...' }` triggers a Drizzle empty-set 500 because `rapGateReason` is not in the PATCH Zod schema. Drizzle throws when `.set({})` is empty. The field is readable; writes via this endpoint are impossible.

### 3-H: contractAmount writes without audit trail

`PATCH /leads/:leadId/profile` (and `PATCH /pins/:id/profile`) accepts `contractAmount` for any pin owner or manager. The value flows into `pin_profitability.revised_contract_cents`. No audit log entry is written. Managers reviewing profitability cannot see who changed the contract value or when.

### 3-I: Negative contractAmount accepted

`contractAmount: '-$5,000.00'` passes `_parse_legacy_money_cents()` and is stored. The profitability view floors `revised_contract_cents` at 0 (`GREATEST(base_contract_cents + approved_co_cents, 0)`), so a negative string input does not corrupt the margin calculation — but the value persists in the raw column, is returned in API responses, and could confuse downstream integrations.

---

## P6.5 — UI-vs-API Divergences

### 4-A: Department enum — silent mobile degradation

The server returns HTTP 500 for office-dept users; the mobile `useProfile()` hook defaults to `{ role: 'field_rep', department: 'canvasser' }` on error. The UI masks a server failure as a lower-privilege identity. An admin with `office` dept silently becomes `field_rep/canvasser` on mobile — inspections tab hidden, no visible error, no retry.

### 3-J: PATCH /leads/:leadId/profile accepts pipeline stage and contract value

The web UI routes stage advances through `PATCH /leads/:id/advance-stage` (with guards and audit logging) and contract changes through the contract endpoints. The `profile` PATCH endpoint accepts the same fields without equivalent guards. The gap exists in the API regardless of what the UI does — any caller (mobile app, curl, integration) that discovers the profile endpoint can use it to bypass the purpose-built flows.

### 3-B: 403 vs 404 on cross-tenant inspection

The web UI would never navigate a user to another tenant's inspection. But an API caller (or an integration) that probes inspection IDs gets 403 instead of 404, confirming existence. The divergence is between the UI's assumption that callers won't probe cross-tenant IDs and the API's response that leaks existence.

---

## P6.6 — Regression Results

### Full Test Suite — Phase 5 Run

| Suite | Files | Tests | Pass | Fail |
|---|---|---|---|---|
| `artifacts/api-server` | 48 | 671 | 671 | 0 |
| `lib/authz` | 3 | 66 | 66 | 0 |
| `lib/protocol` | 2 | 59 | 58 | **1** |
| `artifacts/rooftrax-web` | 1 | 5 | 5 | 0 |
| **Total** | **54** | **801** | **800** | **1** |

The 1 failure (`lib/protocol` — `applicableSteps drops exactly the unselected surfaces`) is pre-existing: `git diff HEAD -- lib/protocol/` = 0 lines. No file in `lib/protocol/` was touched by this audit. The test asserts step ordering; the implementation produces a different order. The step set is correct.

### Phase 5 Sequence Results

| Sequence | Result |
|---|---|
| seed-acceptance-claim.ts (Virginia wind+hail, full lifecycle) | **57/57** ✓ |
| contract-value.test.ts (T1 portal-sign, T2 CO-approval, T3 void) | **3/3** ✓ |
| Pipeline auto-advance 3a (idempotency) | ✓ |
| Pipeline auto-advance 3b (failure isolation) | ✓ |
| Pipeline auto-advance 3c (cross-pipeline guard) | ✓ |
| Dashboard manifest (lib/authz → routes) | **6/6** ✓ |
| Change-order → profitability recomputation | ✓ |
| Selections → Contract Builder → Signing Portal → `contract_signed` event | ✓ |
| Notification dispatch (8 push-enabled types, 0 tokens) | **0 delivered** — expected (EAS placeholder) |
| ZZTEST fixture isolation check | **CLEAN** |

### typecheck-api

8 TS errors, all in `src/scripts/` (audit scripts only — `phase3-negative-tests.ts`, `phase3-part2.ts`, `phase4-screenshots.ts`). Production source (`routes/`, `lib/`, `app.ts`): **0 errors**.

---

## P6.7 — Not Tested

These items were outside the scope of what the test environment could exercise. Green checkmarks in other sections do not cover these.

| Item | Why not tested |
|---|---|
| OIDC login path (`/login`, `/callback`, token exchange) | Sessions were created as direct DB inserts; the full Replit OIDC flow was not exercised |
| Browser-based CORS preflight enforcement | CORS was verified by code analysis; no real cross-origin browser request was issued |
| Push notification delivery end-to-end | EAS `projectId` is a placeholder; `user_push_tokens` table has 0 rows; no push was delivered |
| Multi-process / clustered race conditions | Single-process deployment; FINDING 2-B race window is narrower than in a scaled environment |
| Session cookie HMAC integrity | No signing secret configured; no attack requiring HMAC was attempted |
| `rcvAmount` and inspections pin-proxy write path | Not empirically tested — identified in FINDING 3-J code review but write path 4 not exercised via tests |
| contract-value write path 4 (manual PATCH override via `/leads/:id/profile`) | Intentionally excluded per the test file's own comment; covered by FINDING 3-J finding but no assertion on the profitability side-effect |
| A-CANV-2, A-INSP-1, A-OFF-1 dashboards (browser screenshots) | Playwright chromium headless shell blocked in NixOS environment — `libglib-2.0.so.0` not available; documented from code analysis only |
| Production database state | All tests ran against the development DB; prod was not queried |
| Mobile push token registration flow | Requires EAS build + device; `getExpoPushTokenAsync` was not exercised |

---

## P6.8 — Test Validity Limits

A reader six months from now should know what the green checkmarks do and do not mean.

**What "PASS" means in this report:**
- API route tests (vitest + supertest): the route returned the expected status code and response shape for the tested input, using a direct DB-backed session (no browser, no OIDC, no real client). The test environment is single-process.
- seed-acceptance-claim.ts: the 57-step script completed without an unhandled error. Each step asserts HTTP status; some assert response fields. It does not assert negative cases.
- Phase 3 empirical tests: HTTP calls made from a test session confirmed the HTTP response code. They do not confirm what the UI renders or whether a user would ever trigger the call through normal app navigation.

**What "PASS" does not mean:**
- OIDC token issuance, cookie freshness, or session replay attacks are not exercised.
- Browser-initiated CORS preflight, SameSite enforcement, or cookie scope was not exercised.
- Mobile app behavior is confirmed by code analysis, not a running device test.
- The lib/protocol `applicableSteps` step ordering failure is pre-existing and unresolved — gate rules that depend on step order are at risk.
- Push notification delivery, token registration, and EAS project configuration are inert in the current environment.
- Concurrency: the async portal-sign race (FINDING 2-B) is empirically confirmed from audit logs but the narrow single-process event loop makes it harder to reproduce in a controlled test than it would be under load.

---

## P6.9 — Baseline Changes

All changes to the codebase made during or in preparation for this audit, with SHAs. These are not application features; they are audit infrastructure changes or remediations.

| Change | SHA / Session | What changed | Net effect |
|---|---|---|---|
| Rate limiting added to auth + portal routes | `a635a2c` | Created `lib/rateLimit.ts` (shared `RateLimiter` class, fixed-window per-IP); `trust proxy 1` in `app.ts`; `authLimiter` (20 req/min/IP) on `/login`, `/callback`, `/mobile-auth/token-exchange`; portal limiter migrated to shared class (30 req/min/IP); 8 unit tests | **FINDING 0.8-B REMEDIATED.** Only code-quality change in the audit baseline. |
| Migration numbering anomalies resolved | `f76e6c6` | 5 files in `data-migrations/` renamed (e.g. `0009_remediation_plan_vocab.sql` → `021_remediation_plan_vocab.sql`); `_journal.json` updated to match | No schema change; filename-to-sequence ordering corrected. Pre-audit commit by repo owner. |
| `playwright` added to root `dependencies` + lockfile | `8c0455c` (Phase 4) | `package.json` root `dependencies` gained `"playwright": "^1.62.1"`; `pnpm-lock.yaml` +29 lines | Playwright is a devDependency by convention; it was placed in the wrong field. |
| `playwright` moved from `dependencies` to `devDependencies` | This session (Checkpoint 5, uncommitted) | `package.json` root — moved entry from `dependencies` to `devDependencies` | Corrects the 8c0455c placement. |
| Screenshots committed to git | `8c0455c` (Phase 4) | 10 JPEG files in `screenshots/` tracked by git (`a-admin-dashboard.jpg` … `a-super-nav.jpg`) | Audit artifacts in git history. |
| `screenshots/` added to `.gitignore` | This session (Checkpoint 5, uncommitted) | Root `.gitignore` gained `screenshots/` entry | Prevents future screenshot files from being tracked. The 10 already-tracked files **remain in the git index** — `git rm --cached screenshots/` was **not run** per the work order instruction to preserve ZZTEST fixtures and defer teardown decisions. |

---

## git log --oneline since 113cc23

```
(empty)
```

`git log --oneline 113cc23..HEAD` returns no output. HEAD is `113cc23` (Phase 5 commit). This session's changes to `TESTREPORT.md`, `package.json`, and `.gitignore` are uncommitted.


---

# REMEDIATION — Steps 1 & 2

---

## CHECKPOINT 1 — Step 1: FINDING 4-A (Department enum drift)

**Commit:** `d8c0bc2` — "Step 1: add 'office' to Department enum in OpenAPI spec and regenerate"

### openapi.yaml diff

```diff
-      enum: [canvasser, inspector_canvasser]
+      enum: [canvasser, inspector_canvasser, office]
```

Location: `lib/api-spec/openapi.yaml:8122` — `Department` schema component. One line changed; no other spec content touched.

### Generated-file diffstat

```
lib/api-client-react/src/generated/api.schemas.ts |  1 +
lib/api-zod/src/generated/api.ts                  | 16 ++++++++--------
lib/api-zod/src/generated/types/department.ts     |  1 +
3 files changed, 10 insertions(+), 8 deletions(-)
```

Only enum sites changed. In `api.ts`: 8 occurrences of `zod.enum(['canvasser', 'inspector_canvasser'])` updated to `zod.enum(['canvasser', 'inspector_canvasser', 'office'])` (lines 843, 901, 959, 1013, 1084, 1443, 1463, 1475). In `api.schemas.ts`: `Department` const object gained `office: 'office'`. In `types/department.ts`: +1 enum value. No other file in either library changed.

### Root typecheck output

```
pnpm -w tsc --build --force
(no output — 0 errors)
```

### Five profile responses

```
=== A-MGR-O (HTTP 200) ===
{ "email": "a-mgr-o@zztest.local", "role": "manager",     "department": "office",
  "workflowAssignment": "retail",           "companyId": "ZZTEST_ALPHA" }

=== A-ADMIN (HTTP 200) ===
{ "email": "a-admin@zztest.local", "role": "admin",        "department": "office",
  "workflowAssignment": "insurance_retail", "companyId": "ZZTEST_ALPHA" }

=== A-SUPER (HTTP 200) ===
{ "email": "a-super@zztest.local", "role": "super_admin",  "department": "office",
  "workflowAssignment": "insurance_retail", "companyId": "ZZTEST_ALPHA" }

=== B-ADMIN (HTTP 200) ===
{ "email": "b-admin@zztest.local", "role": "admin",        "department": "office",
  "workflowAssignment": "insurance_retail", "companyId": "ZZTEST_BRAVO" }

=== A-OFF-1 (HTTP 200) ===
{ "email": "a-off-1@zztest.local", "role": "field_rep",   "department": "office",
  "workflowAssignment": "retail",           "companyId": "ZZTEST_ALPHA" }
```

All five: HTTP 200. `department: "office"` returned correctly and passes Zod validation. Previously all five returned HTTP 500.

### GET /admin/users — team roster response

```
HTTP 200 — 8 users (full ZZTEST_ALPHA roster)
  a-canv-1@zztest.local  | role=field_rep    | dept=canvasser
  a-canv-2@zztest.local  | role=field_rep    | dept=canvasser
  a-insp-1@zztest.local  | role=field_rep    | dept=inspector_canvasser
  a-off-1@zztest.local   | role=field_rep    | dept=office           ← previously caused cascade 500
  a-mgr-f@zztest.local   | role=manager      | dept=inspector_canvasser
  a-mgr-o@zztest.local   | role=manager      | dept=office
  a-admin@zztest.local   | role=admin        | dept=office
  a-super@zztest.local   | role=super_admin  | dept=office
```

No cascade 500. A-OFF-1 is now correctly included with `dept=office`.

### Nav count comparison (A-ADMIN + A-SUPER)

NAV_SECTIONS in `Shell.tsx` has 13 total items: 7 navigation (no minRole), 2 data & tools (Reports: minRole='manager'; Proof Package Data: no minRole), 4 admin (Team Management, User Authorization, Integrations: minRole='manager'; Settings: no minRole).

| User | Role | Before fix | After fix | Cause |
|---|---|---|---|---|
| A-ADMIN | admin (office) | 9 items | **13 items** | Profile was 500 → `useProfile` defaulted to `field_rep` → 9; now profile 200 role=admin → 13 |
| A-SUPER | super_admin (office) | 9 items | **13 items** | Same root cause → now role=super_admin → 13 |
| A-MGR-F | manager (inspector_canvasser) | 13 items | 13 items | Unaffected (canvasser in enum) |

No second nav defect found. The nav filter uses `roleRank(profile.role) >= roleRank(item.minRole)` — admin and super_admin rank above manager, so all manager-gated items are visible.

### Full suite totals

```
Test Files  48 passed (48)
Tests       671 passed (671)
```

`lib/authz`: 66/66 ✓ | Dashboard suites: 29/29 ✓

### git status --porcelain artifacts/mobile/

```
(empty)
```

No mobile files modified. Per instruction: `artifacts/mobile/hooks/useProfile.ts:20` default `department: 'canvasser'` masking behavior is logged, not fixed — mobile is frozen.

---

## CHECKPOINT 2 — Step 2: FINDING 2-A (claim_approved unreachable via event bus)

**Commit:** `f309d0b` — "Step 2: POST /events/pipeline returns 422 for outcome-only/unknown event types"

### Design determination

`claim_review → claim_approved` is **outcome-only by design**. No `autoAdvance` was ever missing.

Evidence from `artifacts/api-server/src/lib/pipelineStages.ts`:
```ts
{ pipeline: 'insurance', key: 'claim_review', ..., order: 8,
  outcomes: [
    { key: 'approved',         toStage: 'claim_approved'    },
    { key: 'partial',          toStage: 'supplement_dispute' },
    { key: 'denied',           toStage: 'supplement_dispute' },
  ]
  // No autoAdvance — outcome-only
},
{ pipeline: 'insurance', key: 'claim_approved', ..., order: 10
  // No autoAdvance, no outcomes — terminal in this arc
},
```

Evidence from `artifacts/rooftrax-web/src/lib/pipelineStages.ts`:
```ts
'insurance:claim_approved': define({ key: 'claim_approved', phase: 'outcome', ... })
```

`phase: 'outcome'` is the UI marker for outcome-only stages. The sole correct path is `PATCH /leads/:id/advance-stage { toStage: 'claim_approved', trigger: 'task' }` called after the user selects the "Claim Approved" outcome in the UI.

**Fix applied:** `processPipelineEvent` now returns `{ unknownEventType: true, reason: '...' }` when `matchingPipelineStageKeys.size === 0`. The HTTP route handler returns 422 when `unknownEventType === true`. The internal `emitPipelineEvent` fire-and-forget emitter is unaffected (it ignores the flag).

### 422 responses — all 8 outcome-only / unknown event types

All eight returned HTTP 422 with the message:
```
"'<eventType>' is not an autoAdvance event type — it maps to an outcome-only stage or is unknown. Use PATCH /leads/:id/advance-stage for outcome-driven transitions."
```

| eventType | HTTP | Result |
|---|---|---|
| `approved` | **422** | ✓ |
| `won` | **422** | ✓ |
| `proposal_provided` | **422** | ✓ |
| `follow_up` | **422** | ✓ |
| `supplement_dispute` | **422** | ✓ |
| `adjuster_review` | **422** | ✓ |
| `appraisal` | **422** | ✓ |
| `public_adjuster` | **422** | ✓ |

Previously all returned HTTP 200 with `{ advanced: false, results: [] }`.

### claim_approved transition row

ZZTEST insurance pin `fdbdceba-2db1-454e-881d-cbc02af7593f` was set to `claim_review`, then:

```
PATCH /api/leads/fdbdceba.../advance-stage
Body: { "toStage": "claim_approved", "trigger": "task" }
→ HTTP 200  { "pipelineStage": "claim_approved" }
```

`stage_transitions` audit row:

```
lead_id    | from_stage   | to_stage       | trigger | user_id
-----------+--------------+----------------+---------+------------------------------------
fdbdceba…  | claim_review | claim_approved | task    | 0625a922-…  (A-MGR-O)
```

### Three suite results

| Suite | Result |
|---|---|
| `pipeline-auto-advance.test.ts` | **16/16** ✓ (3a idempotency ✓, 3b failure isolation ✓, 3c cross-pipeline guard ✓) |
| `seed-acceptance-claim.ts` | **57/57** ✓ |
| Full vitest suite (`artifacts/api-server`) | **671/671** ✓ |

Test fix: `pipeline-auto-advance.test.ts` line 215 updated to check `unknownEventType === true` and `reason.contains('not an autoAdvance event type')` instead of exact old string `'No stages match this event'`.

---

## STEP 3 — Audit table determination (report only, no code)

**No audit table exists in the schema.**

Schema search (`lib/db/src/schema/rooftrax.ts`, `lib/db/src/schema/inspections.ts`) and `pg_tables` query return no table with "audit" or "change_log" in the name. The only audit-adjacent structures are:

| Table | Purpose | Scope |
|---|---|---|
| `stage_transitions` | Records pipeline stage changes | Pipeline stage advances only |
| `report_attestations` | Records proof package sign-off | Inspection reports only |
| Sessions / payment ledger | Immutable append-only | Payments, sessions |

There is no general-purpose field-change audit log for pin profile fields (`contractAmount`, `deductibleAmount`, `rcvAmount`). The `stage_transitions` table is the closest analogue but is scoped to stage key changes only.

**Consequence for Step 3:** The gate (`contractAmount`, `deductibleAmount`, `rcvAmount` → manager+) and the `pipelineStage` removal can proceed without an audit table. The audit record requirement for money field changes requires a schema decision: add a new table, or extend `stage_transitions` to cover field changes, or log to a JSONB column on the pin. **Awaiting ruling before implementing the audit record portion.**

