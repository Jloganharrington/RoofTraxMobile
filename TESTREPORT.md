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

**FINDING 0.1-C (P2 — session cookie not signed):** `SESSION_SECRET` is only consumed by `lib/smtpCrypto.ts` for AES-256 encryption of stored SMTP passwords. `cookieParser()` in `app.ts` is called with no secret argument, so the session cookie (`rt_sid`) is a plain unsign UUID stored in a DB row. The cookie value is unguessable (UUID v4 entropy ~122 bits) but is not HMAC-signed. A stolen session ID is valid without any cryptographic check. Standard risk for DB-backed sessions; document explicitly.

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

**FINDING 0.5-A (P1 — company enumeration):** `GET /companies/:companyId` has no authentication check. Any unauthenticated request that knows (or guesses) a company ID receives `{ company: { id, name } }`. The OpenAPI spec documents this as "Public — used to confirm a company exists before joining it." This is intentional per the spec comment, but:
1. It is not on the explicit public allowlist.
2. With 600 companies in the DB, IDs are predictable if sequential or UUID-based (they are varchars — check whether they are UUIDs or sequential codes in Phase 1).
3. Exposes company names to unauthenticated enumeration.
Severity: P1 if IDs are sequential/guessable; informational if UUIDs.

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
| AHJ jurisdiction packs | `ahj_packs` | (not checked — table name differs from spec) | See note |
| Proof Package library | N/A | TABLE DOES NOT EXIST | Not a DB table — baked into code |
| Notification catalog | Defined in `lib/authz/src/notifications.ts` | 16 types (code) / **0** DB preference rows | ⚠ Data gap |
| Claim status history types | N/A | TABLE DOES NOT EXIST | Enum in application code, not a table |
| Pins | `pins` | 93 | — |
| Companies | `companies` | 600 | — |
| Users | `users` | 1,021 | — |
| Stage transitions | `stage_transitions` | 51 | — |

**Notes:**
- `ahj_jurisdiction_packs` named in the work order does not exist; the table is `ahj_packs`. Row count not checked (rename the query in Phase re-run).
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

**FINDING 0.7-A (P1 — push notifications dead in production):** `artifacts/mobile/app.json` has `extra.eas.projectId = "REPLACE_WITH_EAS_PROJECT_ID"`. Mobile code reads this value and passes it to `getExpoPushTokenAsync`, which requires the real EAS project UUID. All push notification registrations will fail silently on production builds. `user_push_tokens` table will remain empty; all 5 push-enabled catalog types (`contract_signed`, `change_order_signed`, `change_order_pending_approval`, `change_order_approved`, `proof_package_delivered`, `inspection_assigned`, `inspection_scheduled`, `appointment_assigned`) will never deliver push.

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
| Rate limiting | Portal routes only (30 req/min/IP, in-memory) | **FINDING 0.8-B** |
| Body size limits | email-report: 15mb / ahj-sources: 10mb / sign: 5mb / default: 100kb | ✓ Appropriate per-route sizing |
| Helmet.js | **Absent** | No security header middleware (X-Frame-Options, CSP, HSTS, etc.) |
| HTTPS | Enforced by Replit proxy | Not handled in application code |

**FINDING 0.8-A (P1 — CORS wildcard with credentials):** `app.ts` uses `cors({ credentials: true, origin: true })`. With `origin: true`, every incoming `Origin` header is reflected back as `Access-Control-Allow-Origin`. Combined with `credentials: true`, this means any domain can make cross-origin requests with the user's session cookie attached. Should be restricted to `process.env.REPLIT_DEV_DOMAIN` and the production domain.

**FINDING 0.8-B (P1 — no rate limiting on auth and API routes):** Rate limiting is applied only to the portal access-code endpoint. There is no rate limiting on `/login`, `/callback`, `/mobile-auth/token-exchange`, or any authenticated API route. Credential stuffing, session enumeration, and brute-force attacks on portal share codes above 30/min from a second IP are all unbounded.

**Absent security headers (Informational):** No `helmet()` or equivalent. Missing: `X-Frame-Options`, `Content-Security-Policy`, `X-Content-Type-Options`, `Strict-Transport-Security`. These are handled by Replit's proxy for the dev domain but will be absent in custom-domain deployments.

---

## Phases 1–6

*Pending Checkpoint 0 review. Not yet executed.*

---

## Fixes Applied

None. Report-only run. No application code, schema, or config was modified.

```
git status --porcelain artifacts/mobile/
[empty — no writes to artifacts/mobile/]
```
