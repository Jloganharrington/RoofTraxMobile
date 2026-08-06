# Memory Index

- [Lead source + PM tracker](lead-source-pm-tracker.md) — externalLeadSource + projectManagerName on pins; leadSources jsonb on companies; tracker in LeadProfile DashboardTab; lead-sources routes on companies; lead source picker in mobile pin-new.

- [IICRC citation placeholder runtime](iicrc-citation-placeholder.md) — STD-WTR-01/02 flagged humanEnteredProvisionsOnly; generator injects directive + placeholder tokens; SectionCard blocks approve until filled.

- [Pipeline stage vocabulary](pipeline-stage-vocabulary.md) — 30-stage map (10 retail/15 insurance/8 project); server-side copy in api-server/src/lib/pipelineStages.ts; UI copy in rooftrax-web/src/lib/pipelineStages.ts; kept in sync manually.
- [Pipeline advance-stage endpoint](pipeline-advance-stage.md) — PATCH /leads/:leadId/advance-stage shares advancePinStage() helper with POST /events/pipeline; import both from pipelineEvents.ts.

- [drizzle push blocks on new unique constraints](drizzle-push-unique-constraint.md) — non-interactive push has an unavoidable TTY prompt; apply the DDL via SQL matching the schema file.

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
- [Optimistic cache id parity](optimistic-cache-id-parity.md) — offline optimistic cache rows must reuse the outbox/server client id (not a placeholder), and manifest builders must gate on a fully-drained outbox for that entity.
- [Duplicate react-native from @types/react fork](duplicate-react-native-types-fork.md) — Expo Go "downloads 100% then crashes, no redbox" = two RN instances forked by mismatched @types/react peers; pin @types/react via root pnpm.overrides + wipe node_modules.
- [expo-image-picker camera permission](expo-image-picker-camera-permission.md) — launchCameraAsync throws (not auto-prompts) without a prior requestCameraPermissionsAsync grant in SDK 17; never swallow capture errors with catch {}.
- [Nominatim location bias](nominatim-location-bias.md) — unbiased forward-search returns global junk for partial addresses; bias with countrycodes=us + viewbox (order: minLon,maxLat,maxLon,minLat), bounded=0.
- [jsonb vs zod equality + replay-tolerant immutability](jsonb-zod-equality-and-replayable-immutability.md) — key order differs between jsonb read-back and zod-parsed body; use canonical stringify, and immutability guards must allow idempotent outbox replays (reject only genuine changes).
- [Outbox replay ordering & orphan gates](outbox-replay-ordering-and-orphan-gates.md) — drain by createdAt+rowid or delete-before-create replay resurrects records; gate rules must skip children orphaned by a parent delete.
- [Stage vocabulary mirrors](stage-vocab-mirrors.md) — protocol/db/openapi step lists mirror by key with no enforced link; keep all three in identical order when adding a step.
- [Data-driven URL auth gating](data-driven-url-auth-gating.md) — never attach the session Bearer token to a fetch whose URL comes from a record; gate to the trusted API origin with a `/` boundary check or the token can leak.
- [Append-only jsonb audit logs](outbox-replay-ordering-and-orphan-gates.md) — append via SQL `col || new::jsonb`, never read-modify-write in JS, or concurrent PATCHes drop audit entries.
- [Per-user SMTP emailing](user-supplied-smtp.md) — user-supplied outbound hosts need DNS-vetted SSRF guard; encrypted write-only creds; route-scoped body limits.
- [Compiled report artifacts](compiled-report-artifacts.md) — never persist expiring signed URLs in stored reports; sanitize LLM HTML; @google/genai must be a direct api-server dep (esbuild externalizes @google/*).
- [Versioned jsonb vs narrowed API schemas](jsonb-schema-versioning.md) — narrowing a jsonb response schema needs legacy-null normalization at every response parse site or old rows 500.
- [Session lifecycle & orphan sessions](session-lifecycle-orphans.md) — auth must verify user row exists (test cleanup orphans sessions → FK 500s) and slide session expiry on activity.
- [RAP scorecard mirror](rap-scorecard-mirror.md) — scorecard math + photo-priority order duplicated in mobile screen and api-server rapScorecard lib (VAP too: vapScorecard, photo priority ≠ display order); change both or reports drift.
- [Archive-only protocol photos](archive-only-protocol-photos.md) — some protocol photos (VAP final archive) must never reach report output; exclusion is a single compile-time filter — new report/export surfaces must reapply it.
- [Proof Package A–M template](proof-package-template.md) — v6 blobs bake reportData + render via A–M exhibit template; fixed letters, legacy branch for v≤5, compile 422-gates on company legal settings + a matching Building Regulation Jurisdiction Pack (free-form name, per-state, multiple allowed; v7 blobs carry openingStatements + sectioned citations; v6 legacy shape must keep rendering).
- [Roof overview diagram rendering](measurements-overview-image.md) — ImageMagick v7 binary is `magick` not `convert`; mobile getApiBaseUrl() has no trailing slash; clear diagram cache on PDF replace.
- [Facet inventory single-stage flow](facet-routing-two-stage.md) — routing scrapped; single AI call extracts count/areas/pitches; inspector decides walking order; mobile confirm card replaces State B/C.
- [Estimate price-book snapshot integrity](estimate-price-snapshots.md) — catalog-referencing lines must be server-hydrated (price/desc/unit from DB); advisory steps join all three stage mirrors but get no gate rules.
- [AHJ material applicability item dimension](ahj-material-applicability.md) — per-item jsonb materialApplicability + needsMaterialReview; PATCH gate; v1.1 prompt; material canary in Virginia eval.
- [Pipeline schema migrations](pipeline-schema-migrations.md) — pipeline rebuild added 4 pins columns + stage_transitions table; must be applied manually via SQL when DB is out of sync; SQL DDL in the file.
- [Generated schema enum cascade](generated-schema-cascade.md) — changing a DB enum ripples through 4 generated files (lib/db schema, api-zod types+api, api-client-react schemas) + 2 dist --force rebuilds; mobile imports ComponentStatus from api-client-react, not api-zod.
- [lib/db composite build](lib-db-composite-build.md) — api-server uses TS project references to lib/db; after schema edits run `cd lib/db && npx tsc --build` or tsc sees stale declarations.
- [Demo + stage-review flags](demo-stage-review-flags.md) — pins.is_demo marks seed data (hide-demo toggle, localStorage rt_hide_demos); pins.needs_stage_review flags auto-mapped null-stage pins; both in 0001_known_cyclops.sql migration.
- [Claim supplements migration](pipeline-schema-migrations.md) — 018_claim_supplements.sql adds supplement_id to claim_sections + report_attestations + claim_supplements table; must be applied before section generate/approve routes work.
- [Report attestation signed-recompile index shift](report-attestation-signed-recompile.md) — GET /report-attestation must use isSignedVersion entry's stored blobVersionIndex, not versions.length-1, or attested:false after post-attest recompile.
- [Compile route model + caption prerequisites](compile-model-and-caption-prereqs.md) — compile uses gemini-2.5-flash; comparison_set_captions must be generated + approved before compile or 422; order: finalize→captions→approve→compile.
- [Component zone photo gate + interior photo subjectId](component-zone-photo-gate.md) — every component needs a zone photo even for not_observed; interior photos need a subjectId from a prior interior-observation entity POST.
- [Dashboard Wave 1 architecture](dashboard-wave1-architecture.md) — lib/authz owns vocabulary+permissions+dashboard (WIDGET_CATALOG, resolveCapabilities, selectWidgetsFor); guard at api-server/src/lib/dashboardGuard.ts; manifest route never reads role from request.
- [Wave-2B Profile tab implementation](wave2b-profile-tab.md) — api-zod + api-client-react need `npx tsc --build` after generated-file edits (composite dist); MyProfile in claimHubApi is hand-typed; theme+dashboardLayout columns exist but are wired in A1/D1.
