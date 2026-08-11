---
name: Terminate User feature
description: Soft deactivation + atomic reassignment + hard-delete guard — schema, routes, and auth middleware changes.
---

## What was added

### Schema (migrations 047 + 048)
- `users.deactivated_at timestamptz` (nullable) — migration 047. Non-null = deactivated.
- `pins.user_id` FK changed from ON DELETE CASCADE → ON DELETE RESTRICT — migration 048.
  **Why CASCADE was dangerous:** any `db.delete(usersTable)` (API bug, script, psql) silently destroyed all leads for that user. RESTRICT forces callers to reassign leads first.

### Auth middleware (`authMiddleware.ts`)
- User lookup now selects `deactivatedAt` in addition to `id`.
- If `deactivatedAt !== null`, session is cleared and request returns unauthenticated (401).
- Deactivated users cannot re-authenticate — this is the authoritative gate (not just a DB flag).

### Permission change (`lib/authz/src/registry.ts`)
- `team.delete` elevated from `minRole: 'manager'` → `minRole: 'super_admin'`.
- Hard delete is now super_admin only AND requires empty inventory check in the route.
- Normal termination (deactivate + reassign) uses `team.edit` gate (manager+).

### Routes added (`artifacts/api-server/src/routes/admin.ts`)

**GET /team/users/:userId/inventory** (team.view, manager+)
Returns 6 categories: leads (all pins), directReports, inspections (active statuses only: scheduled/capturing/validating), appointments (scheduled only), openChangeOrders (pending + not voided), signedDocuments (COCs + signed change orders). Each category has `count` + `items`.

**POST /team/users/:userId/terminate** (team.edit, manager+, actorOutranks required)
- Body: `{ leadOwnerId?, reportManagerUserId?, inspectionAssigneeId?, appointmentAssigneeId? }`
- Required fields depend on non-zero counts.
- Validates all assignees: same company, not deactivated, not the terminated user.
- Atomic `db.transaction`: reassign leads → reassign direct reports' manager → reassign active inspections → reassign scheduled appointments → set deactivated_at.
- After commit: `DELETE FROM sessions WHERE sess->'user'->>'id' = $userId` (best-effort; deactivated_at is the authoritative gate).
- Returns `{ success, deactivatedAt, counts }`.

**Updated DELETE /team/users/:userId** (team.delete, super_admin only)
- Removed actorOutranks check (super_admin can delete anyone).
- Added 5-category inventory count check — all must be 0. Returns 409 with inventory detail if not empty.
- DB RESTRICT FK provides second-line defense.

**Updated GET /team/users** (team.view, manager+)
- Added `deactivatedAt` to select.
- Accepts `?showDeactivated=true` — default excludes deactivated users.
- Returns `deactivatedAt` in each user object (bypasses ListTeamUsersResponse.parse to avoid zod field stripping).

### Tests updated
- `admin-delete-user.test.ts`: manager/admin → 403 on DELETE (super_admin only now); both tests updated with existence assertions.
- `tenant-isolation.test.ts`: cross-company DELETE → 403 (permission gate fires before company scope); afterAll now deletes pins before users (RESTRICT FK).

---

**Why deactivate-not-delete as default:**
Signatures (COCs, change orders) must remain renderable. `signed_by_user_id` and `created_by_user_id` are NO ACTION FKs — the rows stay and render correctly with the deactivated user's name. Hard delete is reserved for users who never created any records.

**How to apply migrations:**
Run `data-migrations/047_deactivated_at.sql` then `data-migrations/048_pins_user_restrict.sql` against any target DB. Both are idempotent.
