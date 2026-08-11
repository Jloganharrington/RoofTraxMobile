---
name: Permission override hardening
description: Design rules for the POST/DELETE /team/users/:userId/permissions routes and audit table (migration 051).
---

## Rules

- **floor and selfOnly kinds are now live in the registry**: `profile.read` is `floor`, `profile.update` and `notification.manage` are `selfOnly`. The override routes auto-reject both with 422 — no code change needed when more are added.
- **team.override_permissions minRole is manager** (changed from admin). Managers have an extra assignment gate: they may only override users whose `managerUserId = actorId`. Admins+ use pure rank only.
- **Must-hold extends to revoke**: you cannot take away OR bestow a permission you don't hold. Previously only grant was checked.
- **Clearing a revoke that restores default-allow is treated as a grant** — must-hold applies. The check uses `resolveResolution(entry.default, perm, { actorId: targetUserId, role: targetRole, ... })` (note: target's context, not actor's) to compute the default-after-clear.
- **Audit table `permission_override_changes` (migration 051)**: one row written inside the same DB transaction as the override change. `previousState`/`newState` are `'granted' | 'revoked' | null`.

**Why:**
- floor/selfOnly overrides make no semantic sense and create security vectors (SMTP injection, notification-preference hijacking).
- Manager-assignment gate prevents privilege escalation chains where a manager promotes an unrelated rep.
- Extending must-hold to revoke closes the "deprive" path — you can't silence someone's access to a route you yourself don't have.
- Clearing-revoke = grant was a bypass vector: revoke X for target, then clear, restoring X for target without the actor holding X.

**How to apply:**
- When writing tests that need a floor permission, use `profile.read`. For selfOnly, use `profile.update` or `notification.manage`.
- When adding a new permission to the registry with floor/selfOnly kind, no route changes are needed — the check is dynamic via `PERMISSION_MAP[key].default.kind`.
- The history endpoint is `GET /team/users/:userId/permissions/history` (team.view gate, newest-first).
