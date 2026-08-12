-- PP Subscriber Auth — migration 057
-- Adds the pp_tier discriminator to companies and the password/email-verify
-- fields to users needed by the PP self-serve registration track.

-- ── companies ───────────────────────────────────────────────────────────────
-- pp_tier: 'crm' = existing full-CRM tenants (default, so all existing rows
-- stay unchanged); 'pp_only' = tenants provisioned via the PP self-serve flow.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS pp_tier text NOT NULL DEFAULT 'crm';

-- ── users ────────────────────────────────────────────────────────────────────
-- PP users authenticate with email + bcrypt password rather than OIDC.
-- OIDC users never have password_hash set (column stays null).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash text;

-- Email verification flow for PP registrations.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verify_token text;

-- Sparse unique index so NULL values are allowed (OIDC users have no token).
CREATE UNIQUE INDEX IF NOT EXISTS users_verify_token_uidx
  ON users (verify_token)
  WHERE verify_token IS NOT NULL;

-- Password-reset flow.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reset_token text;

CREATE UNIQUE INDEX IF NOT EXISTS users_reset_token_uidx
  ON users (reset_token)
  WHERE reset_token IS NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reset_token_expires_at timestamptz;

-- ── pp_pending_registrations ─────────────────────────────────────────────────
-- Temporary store for in-flight PP registrations awaiting Stripe payment.
-- Rows are deleted atomically when the account is provisioned and should be
-- swept by a cron after 24 h to clear stale sessions.
CREATE TABLE IF NOT EXISTS pp_pending_registrations (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_name    text NOT NULL,
  email           text NOT NULL,
  password_hash   text NOT NULL,
  logo_object_path text,
  stripe_session_id text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + INTERVAL '24 hours')
);

CREATE UNIQUE INDEX IF NOT EXISTS pp_pending_regs_email_uidx
  ON pp_pending_registrations (email);

CREATE UNIQUE INDEX IF NOT EXISTS pp_pending_regs_stripe_uidx
  ON pp_pending_registrations (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
