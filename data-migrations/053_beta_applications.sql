-- Migration 053: beta_applications
-- Stores incoming beta program applications from the marketing site signup form.
-- No company/user FK — applicants are not yet tenants.
-- Safe to re-run: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS beta_applications (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name       varchar(100) NOT NULL,
  last_name        varchar(100) NOT NULL,
  email            varchar(255) NOT NULL,
  phone            varchar(50)  NOT NULL,
  company          varchar(255) NOT NULL,
  state            varchar(100) NOT NULL,
  rep_count        varchar(50)  NOT NULL,
  claim_volume     varchar(50)  NOT NULL,
  revenue_range    varchar(100) NOT NULL,
  current_stack    varchar(255) NOT NULL,
  challenge        text         NOT NULL DEFAULT '',
  referral_source  varchar(500) NOT NULL DEFAULT '',
  status           varchar(50)  NOT NULL DEFAULT 'pending',
  notes            text,
  reviewed_at      timestamptz,
  created_at       timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS beta_applications_email_idx    ON beta_applications (email);
CREATE INDEX IF NOT EXISTS beta_applications_status_idx   ON beta_applications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS beta_applications_created_idx  ON beta_applications (created_at DESC);
