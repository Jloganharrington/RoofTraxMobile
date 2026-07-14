-- FIX-3 (MEDIUM): seed the first super_admin per company.
--
-- Only a super_admin can promote anyone, so a company with none is stuck. The
-- company's founder (companies.founder_user_id) is the natural first
-- super_admin. Idempotent and tenancy-preserving: a company that already has a
-- super_admin is left untouched, so re-running never creates a second one.
--
-- Both steps join the founder through `users` requiring `users.company_id =
-- companies.id`. This (a) skips a stale/invalid founder id instead of aborting
-- on an FK violation, and (b) refuses to touch a founder id that points at a
-- user in a different tenant, so the seed can never escalate the wrong
-- company's user to super_admin.

-- Step 1: ensure the founder has a profile row (rows are otherwise created
-- lazily on first profile access). Defaults apply; role is set in step 2.
INSERT INTO user_profiles (user_id)
SELECT c.founder_user_id
FROM companies c
JOIN users u ON u.id = c.founder_user_id AND u.company_id = c.id
WHERE c.founder_user_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- Step 2: promote the founder to super_admin, but only for companies that do
-- not already have one, and only when the founder genuinely belongs to that
-- company.
UPDATE user_profiles p
SET role = 'super_admin',
    updated_at = now()
FROM companies c
JOIN users fu ON fu.id = c.founder_user_id AND fu.company_id = c.id
WHERE p.user_id = c.founder_user_id
  AND p.role <> 'super_admin'
  AND NOT EXISTS (
    SELECT 1
    FROM user_profiles sp
    JOIN users su ON su.id = sp.user_id
    WHERE su.company_id = c.id
      AND sp.role = 'super_admin'
  );
