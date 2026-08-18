---
name: Wave-2B Profile tab implementation
description: Key quirks and decisions from the P2 personal-profile tab implementation — schema, generated-file rebuild sequence, type pitfalls.
---

## Build order after editing lib/api-zod or lib/api-client-react generated files

Both packages use `composite: true` + `emitDeclarationOnly` into a `dist/` folder.
After touching `src/generated/api.ts` or `src/generated/api.schemas.ts`, run:

```bash
cd lib/api-zod && npx tsc --build
cd lib/api-client-react && npx tsc --build
```

**Without this step**, consuming projects (api-server uses project references to api-zod; axiomrestore-web uses project references to api-client-react) read stale `.d.ts` files and report "no exported member" even though the source was updated.

**Why:** The packages resolve via `"exports": { ".": "./src/index.ts" }` at runtime but TypeScript's project-reference machinery emits and reads compiled declarations, not sources.

## MyProfile in claimHubApi.ts is a hand-typed local interface

`artifacts/axiomrestore-web/src/lib/claimHubApi.ts` exports `MyProfile` (line ~732) — a minimal hand-written interface used by `useGetMyProfile` (which hits `/api/profile`, a legacy/different path than the generated hook's `/api/profile/me`).

When the `Profile` schema gains new fields, **both** must be updated:
1. `lib/api-client-react/src/generated/api.schemas.ts` — `Profile` interface
2. `artifacts/axiomrestore-web/src/lib/claimHubApi.ts` — `MyProfile` interface

The generated `useGetMyProfile` from `@workspace/api-client-react` is preferred for new components (correct endpoint + full types). The claimHubApi version is a legacy wrapper for older pages.

## PATCH /profile/me role-injection guard

The route uses `UpdateProfileMeBody.safeParse(req.body)`. The zod schema only accepts `firstName`, `lastName`, `phone`, `profileImageUrl` — unknown keys are stripped. This means role/department/workflowAssignment fields can never reach the handler even if submitted; no extra guard needed.

## onboarding.ts fill-only-when-null pattern

`upsertUserOnLogin` in `artifacts/api-server/src/lib/onboarding.ts`: the update branch now uses a fill-only-when-null pattern for `firstName`, `lastName`, `profileImageUrl`. Email always overwrites (always synced from OIDC). This prevents login from silently clobbering user edits to their own name/avatar.

## Wave-2B migration

`data-migrations/020_wave2b_user_profile_columns.sql` adds `phone TEXT`, `theme VARCHAR(10) DEFAULT 'dark'`, and `dashboard_layout JSONB` to `user_profiles`. Applied. Drizzle schema in `lib/db/src/schema/axiomrestore.ts` matches.

## Theme and dashboard_layout columns

Added in the P2 migration but **not yet wired to the UI**:
- `theme`: wired to API in A1 (PATCH /profile/me will accept `theme`; Appearance tab)
- `dashboard_layout`: wired in D1 (PATCH/DELETE /dashboard/layout; Dashboard settings tab)
