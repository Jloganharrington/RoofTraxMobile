---
name: lib/db composite build
description: api-server uses TypeScript project references to lib/db; schema changes need a manual rebuild before tsc picks them up.
---

## Rule
After editing any file under `lib/db/src/`, run **`cd lib/db && npx tsc`** (plain `tsc`, no flags) before running the api-server typecheck or tests. Otherwise tsc reads stale `.d.ts` declarations from `lib/db/dist/`.

**Why:** `artifacts/api-server/tsconfig.json` references `../../lib/db` as a composite project. `lib/db/tsconfig.json` has `"composite": true, "emitDeclarationOnly": true, "outDir": "dist"`. So `@workspace/api-server` resolves `@workspace/db` types from `lib/db/dist/`, NOT the live source. The runtime esbuild bundle resolves source files directly, so the server works fine without a rebuild — only `tsc --noEmit` and vitest are affected.

**CRITICAL footgun — `tsc --build --force` from workspace root:** Running `npx tsc --build --force` at the monorepo root rebuilds lib/db via project references, but emits a subtly broken dist that causes object-storage test hangs (uploadObjectBuffer times out in vitest). Symptom: previously-passing tests that write to object storage time out at 5s with no obvious error. Fix: run `cd lib/db && npx tsc` immediately after. Never use `tsc --build --force` from the root as a substitute for this.

**How to apply:** Any time schema columns are added or removed, or after any root-level tsc rebuild, run `cd lib/db && npx tsc` before checking `typecheck-api` or running vitest.
