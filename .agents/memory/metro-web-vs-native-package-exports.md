---
name: Metro web bundle fails on workspace type:module re-exports; native is fine
description: Why "Unable to resolve ./generated/api" appears only on the web bundle in the mobile app, and how to verify the real (native) target.
---

# Metro web-bundle resolution vs native in this Expo monorepo

Symptom: the `artifacts/mobile: expo` workflow logs `Unable to resolve "./generated/api" from lib/api-client-react/src/index.ts` (import chain runs through app screens that `import "@workspace/api-client-react"`). It looks like a broken build.

Reality: this is a **web-only** metro resolution quirk. Workspace packages here declare `"type": "module"` + an `exports` map. With Expo SDK 54 metro's package-exports resolution, **extensionless relative re-exports** (`export * from "./generated/api"`) fail strict-ESM resolution when bundling `platform=web`. The **native bundle (`platform=ios` / `android`) resolves fine** — those extensionless re-exports work on the native resolver.

**Why:** AxiomRestore mobile is native-first (Expo Go / EAS dev builds, on-device field testing). The Replit web preview is a secondary surface and has other native-only walls anyway (see `react-native-maps-web.md`, expo-sqlite `.wasm`). The web bundle error is pre-existing, not introduced by feature work.

**How to apply:**
- Do NOT chase this as a stale metro cache (clearing `/tmp/metro-*` + restarting does not fix it — I wasted a cycle on that).
- `tsc` typecheck passing already proves the imports are valid; the web failure is a resolver-mode difference, not a missing file.
- To verify a mobile change actually bundles for the real target, curl the native bundle and check for HTTP 200 + large size, ignoring "Unable to resolve worklet with hash" (that string is a reanimated *error-message literal* inside the bundle, not a resolution failure):
  `curl -s -o /tmp/b.txt -w "%{http_code} %{size_download}\n" "https://$REPLIT_EXPO_DEV_DOMAIN/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true"`
- If web bundling ever becomes a required target, the real fix is package-side (add file extensions to the re-exports, or disable `unstable_enablePackageExports`), not touching feature code — and note `lib/api-client-react/src/index.ts` is partly orval-regenerated.
