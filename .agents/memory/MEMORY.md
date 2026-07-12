# Memory Index

- [Orval zod schema naming](orval-zod-naming.md) — request-body zod consts are always operationId+"Body", regardless of the component schema's ref name.
- [zod v3 pinned in this workspace](zod-v3-openapi-formats.md) — avoid `format: email`/`uri` in OpenAPI specs; orval's v4-only helpers break codegen.
- [react-native-maps has no web renderer](react-native-maps-web.md) — must platform-split map screens; use tsconfig moduleSuffixes for TS to resolve them.
- [ImageMagick grayscale composite gotcha](imagemagick-grayscale-composite.md) — xc: solid canvases with R=G=B silently encode as grayscale, desaturating anything composited on top.
- [Expo web login fails against Replit OIDC](expo-web-oidc-redirect.md) — expo. preview domain isn't a trusted redirect_uri; exchange code server-side on the trusted domain and relay via postMessage.
- [Expo vector-icons tofu-box glyphs on SDK 54](expo-vector-icons-sdk54-tofu.md) — nested expo-font version mismatch, not a load-order bug; pin exact version + pnpm override.
