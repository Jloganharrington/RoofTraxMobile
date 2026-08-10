-- 045_manager_user_id.sql
--
-- Step 4: add manager_user_id to user_profiles.
--
-- Tracks a user's direct reporting manager. Nullable — null means no manager
-- assigned. ON DELETE SET NULL automatically clears the assignment when the
-- manager's user row is removed, preventing orphaned FKs.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS is idempotent.
-- Required by: PATCH /team/users/:userId/manager  (team.assign_manager)
--              GET  /team/users (manager join expansion, Task D6/future)
--
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS manager_user_id varchar
    REFERENCES users(id) ON DELETE SET NULL;
