---
name: Expo vector-icons rendering as tofu/box glyphs on SDK 54
description: All @expo/vector-icons glyphs show as [X]/tofu boxes in Expo Go on SDK 54 due to a nested expo-font version mismatch, not a font-loading-order bug.
---

On Expo SDK 54, `@expo/vector-icons@^15.0.3` can resolve to `15.1.1` (npm `latest`), which nests its own
`expo-font@56.x`. That version is incompatible with the `expo-font@14.x` / `expo-modules-core@3.0.x` that
Expo SDK 54 actually ships. The mismatch doesn't throw a loud error in Expo Go — icons silently fall back
to the missing-glyph "tofu" box (rendered as `[X]`) for every icon in the app, on every screen.

**Why:** Adding the icon font to `useFonts` in the root layout, clearing Metro/watchman cache, and fully
closing/reopening Expo Go do NOT fix this — the bug is a dependency resolution problem, not a runtime
loading-order or cache problem. Confirmed via upstream reports: https://github.com/expo/vector-icons/issues/372
and https://github.com/expo/vector-icons/issues/351.

**How to apply:** Pin `@expo/vector-icons` to an exact version known to match the installed Expo SDK's
`expo-font` (e.g. `15.0.3` for SDK 54, no `^`), and add a pnpm workspace override forcing `expo-font` to the
version `expo` itself declares (e.g. `"pnpm": { "overrides": { "expo-font": "14.0.12" } }"` in the root
`package.json`). Verify with `pnpm why @expo/vector-icons` and `pnpm why expo-font` — every consumer should
resolve to the same single version before assuming the fix worked. `expo install --check` will NOT flag this
mismatch, so don't rely on it to rule this out.
