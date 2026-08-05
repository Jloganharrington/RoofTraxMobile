---
name: Dashboard Wave 1 architecture
description: lib/authz dashboard module, manifest route, and widget guard pattern established in Tasks 1-4.
---

## Rule
Every widget data endpoint MUST use `requireWidgetCapability(key)` as its first middleware.
Omission from the manifest is NOT access control — an attacker calls the data URL directly.

**Why:** Task 4 of the Wave 1 spec; the manifest is a UI affordance, not a security boundary.

**How to apply:** Import from `api-server/src/lib/dashboardGuard.ts`. Do not inline a capability check in the handler body — always use the shared guard so the pattern stays consistent.

## Key locations
- `lib/authz/src/dashboard.ts` — `WIDGET_CATALOG` (13 entries), `resolveCapabilities()`, `selectWidgetsFor()`
- `lib/authz/src/vocabulary.ts` — `ROLES`, `WORKFLOW_ASSIGNMENTS`, `DEPARTMENTS` (includes `'office'`)
- `lib/authz/src/permissions.ts` — `roleRank`, `isManagerOrAdmin`, `canEditPin`, etc.
- `artifacts/api-server/src/lib/dashboardGuard.ts` — `requireWidgetCapability(key: Capability): RequestHandler`
- `artifacts/api-server/src/routes/dashboard.ts` — manifest route + action_required data endpoint

## Constraints
- `lib/authz` has ZERO runtime deps (no @workspace/db, drizzle, express, react).
- Manifest route (`GET /dashboard/manifest`) never reads role/dept/workflow from the request — always from the DB profile row.
- `WIDGET_CATALOG` has exactly 13 keys in spec order. Do not add revenue/commission/quota/A-R/crew widgets.
- vitest catalog entry does not exist in pnpm-workspace.yaml; use pinned version `"vitest": "^3.2.4"` in lib/authz/package.json.
