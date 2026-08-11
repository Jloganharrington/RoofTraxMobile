-- Migration 051: Permission override change audit log
--
-- Append-only audit table written inside the same transaction as every
-- POST / DELETE to /team/users/:userId/permissions.  Tracks the full
-- lifecycle: grant, revoke, and clear (previous_state → new_state).
--
-- previous_state / new_state: null = no override; 'granted' or 'revoked'.

CREATE TABLE IF NOT EXISTS permission_override_changes (
  id               varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       varchar NOT NULL REFERENCES companies(id),
  target_user_id   varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission       varchar(100) NOT NULL,
  previous_state   varchar(10),
  new_state        varchar(10),
  note             text NOT NULL,
  actor_user_id    varchar NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS perm_override_changes_company_user_created_idx
  ON permission_override_changes (company_id, target_user_id, created_at);
