---
name: react-native-maps has no real web renderer
description: react-native-maps@1.18.0 (the Expo-Go-compatible pin) ships only an UnimplementedView stub for MapView on web, and no web variant at all for Marker/Circle/Polyline — importing them crashes Metro's web bundle.
---

`react-native-maps`'s web entry (`lib/MapView.web.js`) is just `react-native-web`'s `UnimplementedView`; there is no `MapMarker.web.js` etc. Any component that statically imports `Marker` (or other overlay components) from `react-native-maps` will pull in `MapMarkerNativeComponent.js`, which imports RN-internal native codegen modules — this hard-crashes Metro's web bundling (`Importing native-only module ... on web`), not just a rendering fallback.

**Why this matters:** the failure is a full web-bundle crash (500 / blank preview), not a graceful degradation, so `Platform.OS` runtime checks inside a single file are not enough — ES imports are static and get bundled regardless of the runtime branch.

**How to apply:** split any screen that uses `react-native-maps` overlays into `ComponentName.native.tsx` (real MapView + Marker etc.) and `ComponentName.web.tsx` (a non-map fallback, e.g. a list view) in the same directory, then import the extensionless specifier (e.g. `@/components/MapScreen`) so Metro's platform resolution picks the right file per platform. For TypeScript to resolve the same extensionless import without an error, add `"moduleSuffixes": [".ios", ".android", ".native", ".web", ""]` to the Expo app's `tsconfig.json` compilerOptions — it isn't there by default in the scaffold.
