-- 054: Trial Proof Package feature (paid trial intake on marketing site)
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS trial_accounts (
  id                   varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name         varchar(255) NOT NULL,
  contact_name         varchar(255) NOT NULL,
  email                varchar(255) NOT NULL UNIQUE,
  phone                varchar(50)  NOT NULL,
  license_number       varchar(100) NOT NULL,
  license_state        varchar(2)   NOT NULL,
  company_size_band    varchar(10)  NOT NULL,
  monthly_claim_band   varchar(10)  NOT NULL,
  current_crm          varchar(255),
  email_verified_at    timestamptz,
  verify_token         varchar(64),
  packages_purchased   integer NOT NULL DEFAULT 0,
  credit_balance_cents integer NOT NULL DEFAULT 0,
  credit_expires_at    timestamptz,
  converted_tenant_id  varchar,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trial_sessions (
  token      varchar(64) PRIMARY KEY,
  account_id varchar NOT NULL REFERENCES trial_accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trial_sessions_account_idx ON trial_sessions(account_id);

CREATE TABLE IF NOT EXISTS trial_submissions (
  id               varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       varchar NOT NULL REFERENCES trial_accounts(id),
  sequence_num     integer NOT NULL,
  status           varchar(20) NOT NULL DEFAULT 'draft',
  amount_paid_cents integer,
  stripe_payment_id varchar(255),

  property_address text,
  property_city    varchar(255),
  property_state   varchar(2),
  property_zip     varchar(10),
  county           varchar(255),
  ahj_jurisdiction varchar(255),
  date_of_loss     timestamptz,
  peril_type       varchar(20),
  carrier_name     varchar(255),
  claim_number_ref varchar(100),
  roof_system      varchar(255),
  stories          integer,
  scope_notes      text,

  logo_file_key    varchar(500),
  brand_color_hex  varchar(9),
  license_display  varchar(255),

  deliverable_file_key varchar(500),
  reject_reason        text,
  refund_issued_at     timestamptz,

  submitted_at timestamptz,
  approved_at  timestamptz,
  delivered_at timestamptz,
  purge_after  timestamptz,
  purged_at    timestamptz,
  admin_notes  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trial_submissions_account_idx ON trial_submissions(account_id);
CREATE INDEX IF NOT EXISTS trial_submissions_status_idx  ON trial_submissions(status);
CREATE INDEX IF NOT EXISTS trial_submissions_purge_idx   ON trial_submissions(purge_after) WHERE purged_at IS NULL;

CREATE TABLE IF NOT EXISTS trial_uploads (
  id            varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id varchar NOT NULL REFERENCES trial_submissions(id) ON DELETE CASCADE,
  file_key      varchar(500) NOT NULL,
  file_type     varchar(30)  NOT NULL,
  file_name     varchar(255) NOT NULL DEFAULT '',
  size_bytes    bigint NOT NULL DEFAULT 0,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trial_uploads_submission_idx ON trial_uploads(submission_id);

CREATE TABLE IF NOT EXISTS ahj_coverage (
  id         varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  state      varchar(2)   NOT NULL,
  county     varchar(255) NOT NULL,
  status     varchar(20)  NOT NULL DEFAULT 'none',
  code_cycle varchar(100),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ahj_coverage_state_county_idx ON ahj_coverage(state, lower(county));

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id             varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name   varchar(255) NOT NULL,
  email          varchar(255) NOT NULL,
  phone          varchar(50)  NOT NULL,
  license_number varchar(100) NOT NULL DEFAULT '',
  state          varchar(2)   NOT NULL,
  county         varchar(255) NOT NULL DEFAULT '',
  reason         varchar(50)  NOT NULL DEFAULT 'coverage',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trial_credit_ledger (
  id          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  varchar NOT NULL REFERENCES trial_accounts(id),
  delta_cents integer NOT NULL,
  reason      varchar(255) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trial_credit_ledger_account_idx ON trial_credit_ledger(account_id);

CREATE TABLE IF NOT EXISTS trial_purge_audit (
  id              varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   varchar NOT NULL,
  uploads_deleted integer NOT NULL DEFAULT 0,
  fields_nulled   text NOT NULL DEFAULT '',
  detail          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Deliverable access token: emailed link is /api/trial/deliverable/:token,
-- valid 30 days after delivery; server mints a short-lived signed URL per
-- click (GCS signing caps at 7 days, so a 30-day signed URL is impossible).
ALTER TABLE trial_submissions ADD COLUMN IF NOT EXISTS deliverable_token varchar(64);

-- Prevent concurrent draft creation from duplicating sequence numbers
-- (sequence_num drives first-vs-subsequent pricing and the 3-package cap).
CREATE UNIQUE INDEX IF NOT EXISTS trial_submissions_account_seq_uq ON trial_submissions (account_id, sequence_num);
