---
name: Generated schema enum cascade
description: Changing a DB-level enum (e.g. ComponentStatus) requires updates in four separate generated files — and two dist rebuilds — before all typechecks pass.
---

# Generated schema enum cascade

When a DB schema enum changes (e.g. COMPONENT_STATUSES in lib/db/src/schema/inspections.ts), the change must be mirrored in:

1. **lib/db/src/schema/inspections.ts** — source of truth
2. **lib/api-zod/src/generated/types/componentStatus.ts** — Orval type const
3. **lib/api-zod/src/generated/api.ts** — zod validators (replace_all; 9+ occurrences for ComponentStatus)
4. **lib/api-client-react/src/generated/api.schemas.ts** — React-query client type const

Then rebuild both dist directories:
```
cd lib/api-zod && npx tsc --build --force
cd lib/api-client-react && npx tsc --build --force
```

And rebuild lib/db:
```
cd lib/db && npx tsc --build
```

Also update the OpenAPI spec source:
- lib/api-spec/openapi.yaml (the ComponentStatus enum entry)

**Why:** api-server resolves @workspace/api-zod via TS project references → dist declarations.
The mobile app resolves ComponentStatus from @workspace/api-client-react (NOT api-zod) — different package, different dist. Missing either rebuild leaves stale .d.ts files that typecheck sees.

**How to apply:** Any time COMPONENT_STATUSES, COMPARISON_PAIR_TYPES, or any other DB-level enum changes — grep for the old values across all four files above before declaring done.
