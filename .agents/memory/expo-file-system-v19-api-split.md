---
name: expo-file-system v19 API split and typing gap
description: How to work with expo-file-system on Expo SDK 54+ (v19) without hitting a full node_modules TS compile or a broken instance-method typing.
---

`expo-file-system@19` (SDK 54) replaced the classic string-URI functions
(`readAsStringAsync`, `documentDirectory`, `copyAsync`, etc.) with a
`File`/`Directory`/`Paths` class API as the default export. Two traps:

1. **Do not import the `/legacy` subpath for type-checked code.** The
   package ships no compiled JS — its `main` is raw `.ts` source, and
   `expo-file-system/legacy` resolves straight to that source (no
   `exports` map to redirect it to a `.d.ts`). `tsc --noEmit` then fully
   compiles the package's internal web-shim source and surfaces a real
   upstream typing bug (`FileSystemShim` missing members) as dozens of
   `TS2339` errors that have nothing to do with your code. The top-level
   `expo-file-system` import is safe because its `package.json` `types`
   field points at a real compiled `build/index.d.ts`.
2. **The new `File`/`Directory` classes are missing their own instance
   members in TS.** They're declared as `extends ExpoFileSystem.FileSystemFile`
   where `FileSystemFile` is a `NativeModule` instance property typed
   `typeof File` — TS doesn't propagate instance members through that
   pattern, so `.bytes()`, `.copy()`, `.uri`, `.exists`, `.delete()` etc. all
   report "does not exist" even though they work at runtime. Work around it
   with a small local interface + `as unknown as` cast for just the members
   you use, rather than fighting the upstream declaration.

**Why:** hit both while building an offline photo-capture/hashing module;
cost a full debugging pass to trace the first error back to `main` pointing
at raw source instead of a missing dependency or tsconfig issue.

**How to apply:** `import { File, Directory, Paths } from 'expo-file-system'`
(never `/legacy`), and cast through a local "usable" interface for any
instance method call.
