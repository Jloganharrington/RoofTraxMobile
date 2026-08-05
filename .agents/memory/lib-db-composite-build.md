---
name: lib/db composite build
description: api-server uses TypeScript project references to lib/db; schema changes need a manual rebuild before tsc picks them up.
---

## Rule
After editing any file under `lib/db/src/`, run `cd lib/db && npx tsc --build` before running the api-server typecheck. Otherwise tsc reads stale `.d.ts` declarations from `lib/db/dist/` and reports false "property does not exist" errors on `pinsTable` and other tables.

**Why:** `artifacts/api-server/tsconfig.json` references `../../lib/db` as a composite project. `lib/db/tsconfig.json` has `"composite": true, "emitDeclarationOnly": true, "outDir": "dist"`. So `@workspace/api-server` resolves `@workspace/db` types from `lib/db/dist/`, NOT the live source. The runtime esbuild bundle resolves source files directly, so the server works fine without a rebuild — only `tsc --noEmit` is affected.

**How to apply:** Any time schema columns are added or removed, rebuild lib/db before checking `typecheck-api`.
