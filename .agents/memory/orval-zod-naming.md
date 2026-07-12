---
name: Orval zod schema naming
description: Why generated zod request-body consts are named by operationId, not by the OpenAPI component schema's ref name — relevant to any @workspace/api-spec / @workspace/api-zod work.
---

Orval's zod generator names each request-body validator `<OperationId>Body` (e.g. operation `createPin` -> `CreatePinBody`), always — it ignores the `$ref`'d component schema's own name for this purpose. The component schema name only affects the *type* generated in `api.schemas.ts`/`types.ts`.

**Why this matters:** if you give a request-body component schema the same name Orval would have computed anyway (e.g. naming a schema `CreatePinBody` when the operationId is `createPin`), you get a same-name collision between the generated zod const and the generated TS type in `api.schemas.ts`, breaking codegen. Renaming the component schema (e.g. to `CreatePinInput`) avoids the collision for the *type*, but the generated zod *const* used for `.safeParse()` in route handlers is still `CreatePinBody` — you must import that name, not the schema's ref name, when validating request bodies server-side.

**How to apply:** when writing Express routes that validate a request body via the generated zod client, import `<OperationId>Body` from `@workspace/api-zod` (check `lib/api-zod/src/generated/api.ts` for the exact exported name if unsure) — not the OpenAPI component schema name.
