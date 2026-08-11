-- 048_pins_user_restrict.sql
--
-- Change pins.user_id FK from ON DELETE CASCADE → ON DELETE RESTRICT.
--
-- CASCADE was destroying job history whenever a user row was deleted (by any
-- code path: API bug, one-off script, or direct psql).  RESTRICT makes the DB
-- refuse to delete a user who still owns leads, forcing the caller to reassign
-- leads first via POST /team/users/:userId/terminate.
--
-- After this migration, the only way to delete a user who has leads is to:
--   1. Call POST /team/users/:userId/terminate (reassign leads + deactivate)
--   2. Then call DELETE /team/users/:userId (super_admin only, empty inventory)
--
-- Safe to re-run: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT are idempotent.
--
ALTER TABLE pins DROP CONSTRAINT IF EXISTS pins_user_id_users_id_fk;
ALTER TABLE pins ADD CONSTRAINT pins_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
