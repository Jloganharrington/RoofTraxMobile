-- 046_user_permission_overrides.sql
--
-- Step 5: create user_permission_overrides table.
--
-- Stores per-user explicit permission grants/revocations. One row per
-- (company_id, user_id, permission). Checked in requirePermission()
-- before the lib/authz registry default.
--
-- granted = true  → explicit grant (overrides a deny-by-role)
-- granted = false → explicit revoke (overrides an allow-by-role)
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Required by: POST   /team/users/:userId/permissions  (team.override_permissions)
--              DELETE /team/users/:userId/permissions/:key
--              GET    /team/users/:userId/permissions
--

CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id                  varchar       PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          varchar       NOT NULL REFERENCES companies(id),
  user_id             varchar       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Must be a valid PERMISSION_KEYS entry — validated at the API layer.
  -- Not a DB enum so adding new keys never requires a migration here.
  permission          varchar(100)  NOT NULL,
  granted             boolean       NOT NULL,
  granted_by_user_id  varchar       NOT NULL REFERENCES users(id),
  note                text,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

-- One override per (company, user, permission).
CREATE UNIQUE INDEX IF NOT EXISTS user_permission_overrides_user_perm_idx
  ON user_permission_overrides (company_id, user_id, permission);

-- Fast batch-load of all overrides for a user (used in requirePermission cache).
CREATE INDEX IF NOT EXISTS user_permission_overrides_user_idx
  ON user_permission_overrides (company_id, user_id);
