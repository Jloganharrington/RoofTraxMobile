---
name: zod v3 pinned, avoid v4-only OpenAPI string formats
description: This workspace's pinned zod version breaks Orval codegen for `format: email` / `format: uri` in OpenAPI specs.
---

This workspace pins `zod@^3.25.76` in the catalog. Orval's zod generator emits `zod.email()` / `zod.url()` top-level helpers for `format: email` / `format: uri` string schemas — those helpers only exist on zod v4's API, not v3. With v3 resolved, generated code referencing them fails to compile/typecheck.

**Why this matters:** it's non-obvious because the OpenAPI spec itself is valid; the failure only shows up downstream in generated code, and looks like a version mismatch bug rather than a spec issue.

**How to apply:** when writing `lib/api-spec/openapi.yaml`, do not use `format: email` or `format: uri` on string schemas. Use a plain `type: string` (with a description if useful) instead. Do not bump the global zod catalog version to work around this — that's a much bigger, riskier change than just avoiding the two formats.
