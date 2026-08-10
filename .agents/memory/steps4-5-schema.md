---
name: Steps 4 and 5 schema
description: manager_user_id column and user_permission_overrides table — migration history, middleware integration, and route inventory.
---

## What was added

### Step 4 — `manager_user_id` on `user_profiles`
- Column: `manager_user_id varchar REFERENCES users(id) ON DELETE SET NULL` (nullable)
- Schema: `lib/db/src/schema/rooftrax.ts` → `userProfilesTable.managerUserId`
- Migration: `data-migrations/045_manager_user_id.sql` (idempotent, ADD COLUMN IF NOT EXISTS)
- Applied directly via psql (drizzle-kit push always TTY-prompts on column additions in this env)
- Route: `PATCH /team/users/:userId/manager` in `artifacts/api-server/src/routes/admin.ts`
- Permission key: `team.assign_manager` (admin+) — already in the registry

**Why:** tracks the direct reporting manager per user so the permission system can scope views and manager-assignment flows without computing org tree from scratch on every request.

**How to apply:** run `data-migrations/045_manager_user_id.sql` against any target DB (dev or prod). Safe to rerun.

---

### Step 5 — `user_permission_overrides` table
- Schema: `lib/db/src/schema/permissionOverrides.ts` (new file) → exported via `lib/db/src/schema/index.ts`
- Migration: `data-migrations/046_user_permission_overrides.sql` (CREATE TABLE IF NOT EXISTS + 2 indexes)
- Applied directly via psql

**Columns:** id, company_id (FK companies), user_id (FK users ON DELETE CASCADE), permission (varchar 100), granted (boolean), granted_by_user_id (FK users), note (text), created_at, updated_at
**Indexes:** UNIQUE (company_id, user_id, permission); INDEX (company_id, user_id) for batch load

**Middleware integration (requirePermission.ts):**
- `loadPermissionOverrides(req, userId, companyId)` — loads all overrides for the actor into a Map, cached on `req.permissionOverrides` for the request lifetime (loaded once, not per-permission-check)
- `requirePermission(key)` — after loading actorCtx, checks the override cache BEFORE calling `resolve()`. Explicit revoke → 403. Explicit grant → next() without role check.
- `loadPermissionOverrides` exported so `GET /team/users/:userId/permissions` can load a target user's overrides without going through the middleware.

**Routes (admin.ts):**
- `PATCH /team/users/:userId/manager` — team.assign_manager (admin+)
- `GET /team/users/:userId/permissions` — team.view (manager+) — returns 120-key effective set with override metadata
- `POST /team/users/:userId/permissions` — team.override_permissions (admin+) — upsert override; "cannot grant what you do not hold" invariant enforced
- `DELETE /team/users/:userId/permissions/:permissionKey` — team.override_permissions (admin+)

**Why:** per-user permission overrides allow admins to grant or revoke individual permissions without changing the user's role. The override layer sits between the middleware and the registry default so the registry remains authoritative by default.

**How to apply:** run `data-migrations/046_user_permission_overrides.sql`. The middleware change is live; existing code paths are unaffected (no overrides → behavior identical to before).

---

## Registry assertion
Registry compile-time assertion is still at 120 (unchanged). Steps 4 & 5 use existing keys (`team.assign_manager`, `team.override_permissions`, `team.view`). The 20 proposed NEW keys are a separate discussion.
