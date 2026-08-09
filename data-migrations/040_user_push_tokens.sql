-- Migration 040: user push token registry
-- One user may have many tokens (phone + tablet).
-- UNIQUE on expo_push_token ensures a re-registration from the same device
-- updates last_seen_at rather than creating a duplicate row.

CREATE TABLE IF NOT EXISTS user_push_tokens (
  id              VARCHAR  PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      VARCHAR  NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id         VARCHAR  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expo_push_token VARCHAR  NOT NULL,
  device_label    VARCHAR,
  platform        VARCHAR,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_push_tokens_token_uq UNIQUE (expo_push_token)
);

CREATE INDEX IF NOT EXISTS user_push_tokens_user_id_idx    ON user_push_tokens(user_id);
CREATE INDEX IF NOT EXISTS user_push_tokens_company_id_idx ON user_push_tokens(company_id);
