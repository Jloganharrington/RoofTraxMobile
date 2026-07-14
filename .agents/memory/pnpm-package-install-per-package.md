---
name: Installing packages into a specific monorepo package
description: The sandboxed package-install callback rejects workspace-member targets; install directly via shell instead.
---

The sandboxed `installLanguagePackages` callback fails with an
`ERR_PNPM_ADDING_TO_ROOT` workspace-root guard when the target package is a
member of this pnpm workspace (e.g. `artifacts/mobile`) rather than the
workspace root. It only works for root-level installs.

**Why:** pnpm workspaces intentionally block ambiguous root-level adds; the
sandboxed callback doesn't pass through a `--filter`/cwd option to target a
specific member package.

**How to apply:** for a package-specific dependency, `cd` into that
package's directory and run `pnpm add <pkg>` directly via the shell
exec tool, instead of using the sandboxed install callback.
