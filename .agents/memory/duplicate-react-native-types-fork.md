---
name: Duplicate react-native from @types/react peer fork
description: Expo Go "downloads to 100% then crashes with no redbox" traced to two react-native instances forked by mismatched @types/react versions
---

# Duplicate react-native crashes Expo Go on startup

**Symptom:** Expo Go downloads the JS bundle to 100%, then closes/crashes immediately
with NO redbox and nothing in the Metro logs. The iOS bundle itself builds fine
(HTTP 200 via curl). This is a fatal *native* crash during bundle evaluation, not a
bundling/resolution error.

**Root cause:** pnpm had two physical `react-native@0.81.5` instances in the store,
differing only by their optional `@types/react` peer (e.g. `19.1.17` vs `19.2.17`).
The app resolved react-native via one `@types/react`, while the Expo core packages
(expo-modules-core, expo-router, expo-sqlite, …) resolved it via the other. Two
react-native copies = two native bridge/TurboModule registries in one bundle = instant
crash. A tell-tale secondary signal: the bundle shrank a lot once deduped
(~17MB → ~11.6MB).

**Why it happens:** react-native lists `@types/react` as an *optional peer*. With
`autoInstallPeers: false` and more than one `@types/react` version present in the
workspace (one artifact pinned `~19.1.x`, the catalog used `^19.2.0`), pnpm forks
react-native into one instance per peer combination.

**Fix (durable):** force a single `@types/react` (and `@types/react-dom`) across the
whole workspace via root `package.json` `pnpm.overrides`, then reinstall. `@types/*`
are types-only (zero runtime effect), so pinning one version is safe and collapses
react-native to a single instance.

**How to apply:**
1. Detect: `ls -d node_modules/.pnpm/react-native@*` — more than one dir (ignoring the
   bare base entry) means a fork. Confirm with `readlink -f` on the app's
   `node_modules/react-native` vs an expo package's `node_modules/react-native` — if
   they point to different `.pnpm` dirs, that's the bug.
2. Add root `pnpm.overrides` pinning `@types/react` + `@types/react-dom` to one version
   (match the catalog / what Expo SDK already resolved).
3. `pnpm.overrides` alone is NOT enough if a prior install left stale symlinks:
   `pnpm install` / `--force` can leave expo packages still linked to the old RN dir.
   You MUST wipe node_modules (`rm -rf node_modules artifacts/*/node_modules
   packages/*/node_modules`) and reinstall so disk matches the lockfile. Re-verify the
   `readlink -f` targets all match afterward.

**Verification without a device:** curl the manifest launchAsset URL and fetch the
bundle — HTTP 200 with JS (not an error-JSON body) means it resolves; but a clean
bundle does NOT prove no duplicate. The authoritative check is a single RN instance on
disk + matching readlink targets, plus the bundle-size drop.
