# Memory Index

- [Orval zod schema naming](orval-zod-naming.md) — request-body zod consts are always operationId+"Body", regardless of the component schema's ref name.
- [zod v3 pinned in this workspace](zod-v3-openapi-formats.md) — force `orval.config.ts` zod override `version: 3`; catalog-based package.json breaks auto-detection and leaks v4-only helpers (email/url/looseObject).
- [react-native-maps has no web renderer](react-native-maps-web.md) — must platform-split map screens; use tsconfig moduleSuffixes for TS to resolve them.
- [ImageMagick grayscale composite gotcha](imagemagick-grayscale-composite.md) — xc: solid canvases with R=G=B silently encode as grayscale, desaturating anything composited on top.
- [Expo web login fails against Replit OIDC](expo-web-oidc-redirect.md) — expo. preview domain isn't a trusted redirect_uri; exchange code server-side on the trusted domain and relay via postMessage.
- [Expo vector-icons tofu-box glyphs on SDK 54](expo-vector-icons-sdk54-tofu.md) — nested expo-font version mismatch, not a load-order bug; pin exact version + pnpm override.
- [One-off DB scripts fail standalone in this pnpm/ESM workspace](one-off-db-scripts-pnpm-esm.md) — tsx/esbuild ad-hoc scripts hit pg/module-resolution errors; use a temporary Express route instead.
- [E2E testing api-server routes](api-server-e2e-testing.md) — no test framework existed; sessions are DB rows, so tests can mint a session directly and hit the Express app with supertest.
