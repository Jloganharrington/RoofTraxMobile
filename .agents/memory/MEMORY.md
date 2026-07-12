# Memory Index

- [Orval zod schema naming](orval-zod-naming.md) — request-body zod consts are always operationId+"Body", regardless of the component schema's ref name.
- [zod v3 pinned in this workspace](zod-v3-openapi-formats.md) — avoid `format: email`/`uri` in OpenAPI specs; orval's v4-only helpers break codegen.
- [react-native-maps has no web renderer](react-native-maps-web.md) — must platform-split map screens; use tsconfig moduleSuffixes for TS to resolve them.
