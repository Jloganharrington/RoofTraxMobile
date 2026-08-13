---
name: api-client-react project references
description: Mobile typecheck uses TS project references that read compiled .d.ts from dist/, not src/ — must rebuild after orval changes.
---

# api-client-react: project references require dist rebuild

## Rule
After any orval codegen that changes `lib/api-client-react/src/generated/`, run `cd lib/api-client-react && npx tsc --build` before running `typecheck-mobile`. Without it, the mobile typecheck reads stale `.d.ts` from `dist/` and reports "Property X does not exist" errors for fields that are in source but not yet compiled.

**Why:** `artifacts/mobile/tsconfig.json` uses `"references": [{ "path": "../../lib/api-client-react" }]` which forces TypeScript to read the declared output directory (`outDir: "dist"` with `emitDeclarationOnly: true`), not the source files. The package.json exports from `./src/index.ts`, so Node/Vite see source, but the TypeScript project-reference resolver always uses the compiled dist.

**How to apply:** Any time the OpenAPI spec or orval config changes and regeneration is run:
1. `cd lib/api-spec && npx orval` — regenerates src/generated/
2. `cd lib/api-client-react && npx tsc --build` — rebuilds dist/*.d.ts
3. Then run `typecheck-mobile` and `typecheck-api`
