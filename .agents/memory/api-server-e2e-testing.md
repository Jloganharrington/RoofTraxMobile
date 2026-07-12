---
name: E2E testing api-server routes
description: How to write real HTTP-level tests against artifacts/api-server without mocking auth, and pitfalls hit while doing so.
---

`artifacts/api-server` had no test framework at all before this was added (vitest + supertest as devDependencies, `pnpm run test` script). Session-based Replit-OIDC auth in this app stores sessions as rows in the `sessions` table (see `src/lib/auth.ts`'s `createSession`), keyed by a random `sid` that doubles as a bearer token (`getSessionId` reads `Authorization: Bearer <sid>` or a cookie). This means tests don't need to fake OIDC or middleware — they can:

1. Insert real rows into `companies`/`users`/`user_profiles` etc. directly via `@workspace/db`.
2. Call `createSession({ user: {...AuthUser fields}, access_token: 'anything' })` to mint a real `sid`.
3. Import the Express `app` from `src/app.ts` and drive it with `supertest`, setting `Authorization: Bearer <sid>`.

**Why:** This is far more trustworthy than mocking `req.user`, since it exercises the actual auth middleware, and it was the only practical way to prove tenant isolation end-to-end given the existing session design.

**How to apply:** Omitting `expires_at`/`refresh_token` on the seeded session is fine — `authMiddleware`'s `refreshIfExpired` short-circuits when `expires_at` is unset. Use a unique per-run company ID (e.g. timestamp-based) and delete seeded users first in `afterAll` (cascades to profiles/pins/locations), then delete the companies — `usersTable.companyId` has no `onDelete` cascade, so it must be deleted in that order or the FK constraint blocks cleanup. `DATABASE_URL` is already present in the shell environment; no extra export needed to run `pnpm run test`.
