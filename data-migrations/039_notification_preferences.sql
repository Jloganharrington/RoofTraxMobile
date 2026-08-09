-- Notification preferences — migration 039.
-- Applied 2026-08-08.
--
-- Rows are written ONLY when a user changes something from the catalog default.
-- Absence of a row means "use the catalog default" — this avoids backfilling
-- every new notification type for every existing user when new types are added.
--
-- frequency stores all four values (immediate | daily | weekly | off) even
-- though v1 only honours immediate and off. This prevents a schema migration
-- when digest delivery is wired up. daily/weekly are stored but treated as
-- immediate by the dispatch layer until digests are implemented.
--
-- UNIQUE (user_id, notification_type) enforces one row per type per user.
-- company_id is denormalised for efficient company-scoped queries in the
-- dispatch layer without a join through users.

CREATE TABLE IF NOT EXISTS notification_preferences (
  id                VARCHAR     PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        VARCHAR     NOT NULL REFERENCES companies(id),
  user_id           VARCHAR     NOT NULL REFERENCES users(id),
  notification_type VARCHAR     NOT NULL,
  email_enabled     BOOLEAN     NOT NULL,
  push_enabled      BOOLEAN     NOT NULL,
  frequency         VARCHAR     NOT NULL DEFAULT 'immediate',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_id
  ON notification_preferences (user_id);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_company_type
  ON notification_preferences (company_id, notification_type);
