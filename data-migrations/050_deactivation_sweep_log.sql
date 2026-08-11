-- Migration 050: deactivation_sweep_log
-- Written by the nightly termination sweep for every user it touches.
-- action_taken values: alert_7d | alert_14d | escalate_21d | purge_30d | blocked

CREATE TABLE IF NOT EXISTS deactivation_sweep_log (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       varchar      NOT NULL REFERENCES users(id),
  company_id    varchar      NOT NULL REFERENCES companies(id),
  deactivated_at timestamptz NOT NULL,
  days_since    integer      NOT NULL,
  action_taken  varchar      NOT NULL,
  blocked_reason text,
  detail        jsonb,
  processed_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deactivation_sweep_log_user_id_idx
  ON deactivation_sweep_log (user_id, processed_at DESC);

CREATE INDEX IF NOT EXISTS deactivation_sweep_log_blocked_idx
  ON deactivation_sweep_log (action_taken)
  WHERE action_taken = 'blocked';
