---
name: Permission override hardening
description: Design rules for the POST/DELETE /team/users/:userId/permissions routes and audit table (migration 051).
---

## Rules

- **`overridable: false` flag on `PermissionEntry`** — this is how the override system rejects a permission, NOT `kind === 'floor'` or `kind === 'selfOnly'`. The routes check `entry.overridable === false`.
- **`floor` and `selfOnly` kinds are now synthetic-only**: no live registry entry uses them. The Section D resolver tests use `resolveResolution()` with synthetic entries; real permissions are `minRole` or `ownerOrRole`.
- **`profile.read`, `profile.update`, `notification.manage`** are `minRole: field_rep` with `overridable: false`. Previously setting them to `floor`/`selfOnly` caused 403s on those routes because `requirePermission` couldn't resolve `selfOnly` without a resource argument.
- **team.override_permissions minRole is manager** (changed from admin). Managers have an extra assignment gate: they may only override users whose `managerUserId = actorId`. Admins+ use pure rank only.
- **Must-hold extends to revoke**: you cannot take away OR bestow a permission you don't hold. Previously only grant was checked.
- **Clearing a revoke that restores default-allow is treated as a grant** — must-hold applies. The check uses `resolveResolution(entry.default, perm, { actorId: targetUserId, role: targetRole, ... })` (note: target's context, not actor's) to compute the default-after-clear.
- **Audit table `permission_override_changes` (migration 051)**: one row written inside the same DB transaction as the override change. `previousState`/`newState` are `'granted' | 'revoked' | null`.

**Why `overridable: false` instead of kind:**
- Changing `kind` to `selfOnly`/`floor` changes how the RESOLVER evaluates the permission for normal route access — it caused immediate 403s on `/profile/me`, SMTP test, notifications, and inspection-mf.
- `overridable: false` is a metadata flag that only the OVERRIDE ROUTES read. The resolver never sees it. Normal route access is unaffected.

**How to apply:**
- Never use `floor` or `selfOnly` kinds for real registry entries. Use `overridable: false` on a `minRole` entry instead.
- When adding a new permission that should be per-user non-overridable, add `overridable: false` to the registry entry.
- Stale hardcoded test counts (like A0's `toBe(74)` or notification `toHaveLength(17)`) should be replaced with dynamic derivations from the live catalog/registry — they will otherwise drift as entries are added.
- The history endpoint is `GET /team/users/:userId/permissions/history` (team.view gate, newest-first).
