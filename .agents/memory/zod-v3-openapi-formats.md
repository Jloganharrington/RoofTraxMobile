---
name: zod v3 pinned in this workspace
description: orval codegen mis-detects zod v4 and emits v3-incompatible helpers; how to force v3 output.
---

This workspace runs zod@3.25.76 (pinned via the pnpm catalog), but orval's
`override.zod.version: 'auto'` (the default) can mis-detect it as v4 and
emit v4-only helpers that fail to typecheck against zod v3:

- `format: email` / `format: uri` in the OpenAPI spec → orval emits
  `zod.email()` / `zod.url()` string-format helpers that don't exist on
  zod v3's default export. Avoid those formats in `openapi.yaml`.
- A bare `type: object` schema with no `properties` (e.g. a free-form JSON
  field like `exifJson`) → orval emits `zod.looseObject({})`, which also
  doesn't exist on zod v3.

**Why:** auto-detection reads the *declared* `zod` version string from the
target package's `package.json` (`lib/api-zod/package.json`). That field is
`"catalog:"` (a pnpm catalog reference), not a resolved semver, so orval's
version parser can't read it and silently falls back to v4-style output.

**How to apply:** in `lib/api-spec/orval.config.ts`, the `zod` target's
`override.zod` block sets `version: 3` explicitly — do not remove this or
revert it to `'auto'`. If a new free-form/JSON-object field is needed in
the OpenAPI spec, prefer `type: [object, "null"]` (now safe since v3 mode
is forced) over leaving it ambiguous.
