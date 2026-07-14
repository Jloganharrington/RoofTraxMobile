# Memory Index

- [Orval zod schema naming](orval-zod-naming.md) — request-body zod consts are always operationId+"Body", regardless of the component schema's ref name.
- [zod v3 pinned in this workspace](zod-v3-openapi-formats.md) — force `orval.config.ts` zod override `version: 3`; catalog-based package.json breaks auto-detection and leaks v4-only helpers (email/url/looseObject).
- [react-native-maps has no web renderer](react-native-maps-web.md) — must platform-split map screens; use tsconfig moduleSuffixes for TS to resolve them.
- [Metro web-bundle vs native resolution](metro-web-vs-native-package-exports.md) — web bundle fails on extensionless re-exports in type:module workspace pkgs; native (ios/android) is fine — not a cache bug; verify via native bundle curl.
- [ImageMagick grayscale composite gotcha](imagemagick-grayscale-composite.md) — xc: solid canvases with R=G=B silently encode as grayscale, desaturating anything composited on top.
- [Expo web login fails against Replit OIDC](expo-web-oidc-redirect.md) — expo. preview domain isn't a trusted redirect_uri; exchange code server-side on the trusted domain and relay via postMessage.
- [Expo vector-icons tofu-box glyphs on SDK 54](expo-vector-icons-sdk54-tofu.md) — nested expo-font version mismatch, not a load-order bug; pin exact version + pnpm override.
- [One-off DB scripts fail standalone in this pnpm/ESM workspace](one-off-db-scripts-pnpm-esm.md) — tsx/esbuild ad-hoc scripts hit pg/module-resolution errors; use a temporary Express route instead.
- [E2E testing api-server routes](api-server-e2e-testing.md) — no test framework existed; sessions are DB rows, so tests can mint a session directly and hit the Express app with supertest.
- [expo-file-system v19 API split](expo-file-system-v19-api-split.md) — never import `/legacy` (compiles raw upstream source); new File/Directory classes need a local interface cast, their own methods aren't typed.
- [Per-package pnpm installs](pnpm-package-install-per-package.md) — sandboxed install callback rejects workspace-member targets; `cd` into the package and `pnpm add` via shell instead.
- [orval coerce.string() query params](orval-coerce-string-query-params.md) — a missing required query param passes server zod as the literal "undefined"; guard raw req.query presence first.
- [Tenant-scoped privilege seeding](tenant-scoped-privilege-seeding.md) — role/ownership backfills must join through users w/ same-company guard or risk FK abort + cross-tenant escalation; one-off SQL lives in data-migrations/.
- [Inspection authz layers](inspection-authz-layers.md) — inspection writes need module-access + company-scope + record-write-authority (owner-or-manager); company scope alone is not authorization; gate assignment at create too.
- [Offline-first write idempotency](offline-write-idempotency.md) — every outbox-replayable create (incl. photos) needs a client id; conflict lookup must be parent-scoped (inspectionId), not just id+company.
- [Protocol gate mapping layer](protocol-gate-mapping-layer.md) — stage gates are enforced by tested rules AND the untested mobile buildProtocolState mapping; qualify photo role + attestation type in the mapping or the gate is bypassable.
