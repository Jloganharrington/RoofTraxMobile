---
name: Versioned jsonb columns vs narrowed API schemas
description: When an API schema for a stored jsonb blob is narrowed/replaced, legacy rows will fail response .parse at every serialization site.
---

Rule: when replacing the shape of a stored jsonb column (e.g. a `version: 2` redesign), the OpenAPI/zod response schema becomes v2-only, but old rows remain in the DB. Every route that runs `SomeResponse.parse(row)` (detail, list, and post-PATCH echo) must normalize legacy blobs first — e.g. map anything without `version === 2` to `null` — or a single old row 500s the response.

**Why:** repairability v2 rebuild — detail/list/update parses would have hard-failed on legacy v1 assessments; the list route's "safe rows" fallback only nulled fields someone remembered to list.

**How to apply:** add one `apiSafe<Field>()` helper next to the routes and use it at every response parse site. Report/PDF compilers that read raw DB rows keep their own legacy rendering branch instead. Also escape user text with the template's `esc()` when adding new render sections, and mirror any new server validation gates in the mobile client's local validator so reps see errors before a 400.
