---
name: Expo font-glyph icons render as tofu/box on Android in Expo Go
description: Custom icon fonts (@expo/vector-icons, Feather, etc.) can register successfully (Font.isLoaded() === true) yet still render as missing-glyph boxes on Android in Expo Go. Not fixable via version pinning or config; use SVG icons instead.
---

Symptom: every icon in the app renders as a box-with-X ("tofu") glyph on Android inside Expo Go, on a
project running Expo SDK 54.

**Ruled out (don't waste time on these first):**
- Font not registered in the root `useFonts()` call — icons from `@expo/vector-icons` self-load their own
  font via `Font.loadAsync` on mount regardless of any app-level `useFonts`, so this is rarely the cause.
- Metro/watchman cache, full close-and-reopen of Expo Go on device — doesn't help, this isn't a caching bug.
- `@expo/vector-icons` resolving to a newer minor (e.g. 15.1.x bundling an incompatible nested `expo-font`)
  — real bug (see https://github.com/expo/vector-icons/issues/372), but pinning the exact compatible version
  and forcing the `expo-font` version via a pnpm override did NOT fix this particular symptom. Diagnostic
  logging (`Font.isLoaded('feather')`) came back `true` after the pin, proving the font loaded fine at the
  JS/native-module level — the bug is downstream of that, in Android's actual glyph rendering under Expo
  Go's Fabric/New Architecture renderer for privately-loaded custom fonts. `newArchEnabled` in `app.json`
  has no effect here since Expo Go is a fixed pre-built binary that ignores that config.

**Fix that worked:** stop rendering icons as font glyphs. Replace font-icon usage (e.g. `<Feather name=.../>`)
with hand-drawn vector icons using `react-native-svg` (`Svg`/`Path`/`Circle`/etc.), matching the same visual
style. This sidesteps the whole custom-font-glyph rendering path and works identically on iOS, Android, and
web without any native build or config changes — safe within Expo Go, no dev client needed.

**Why:** the failure is in Android's native text/glyph rendering pipeline for dynamically-registered custom
fonts specifically inside Expo Go, not in JS-level font loading or dependency versions. SVG rendering doesn't
go through that pipeline at all.
