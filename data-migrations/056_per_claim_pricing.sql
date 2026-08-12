-- 056 — Replace seat-based pricing with per-claim graduated-band model.
-- Pre-launch: no live subscription data to preserve.
-- All old pricing tables are dropped and recreated per Master Build Doc v1.0.
-- ============================================================================

-- Drop old seat-based tables (FK ordering handled by CASCADE)
DROP TABLE IF EXISTS enterprise_inquiries CASCADE;
DROP TABLE IF EXISTS plan_subscriptions CASCADE;
DROP TABLE IF EXISTS enterprise_config CASCADE;
DROP TABLE IF EXISTS enterprise_bands CASCADE;
DROP TABLE IF EXISTS plan_pricing_tiers CASCADE;

-- ============================================================================
-- NEW TABLES
-- ============================================================================

CREATE TABLE pricing_bands (
  id          varchar      PRIMARY KEY DEFAULT gen_random_uuid(),
  band_from   integer      NOT NULL,
  band_to     integer,                          -- NULL = open-ended last band
  rate_cents  integer      NOT NULL,
  sort_order  integer      NOT NULL DEFAULT 0
);

CREATE TABLE plans (
  id                       varchar       PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key                 varchar(30)   NOT NULL UNIQUE,
  display_name             varchar(60)   NOT NULL,
  committed_claims         integer       NOT NULL,
  annual_cents             integer       NOT NULL,  -- base annual price (before term multiplier)
  setup_annual_cents       integer       NOT NULL,
  setup_installment_cents  integer       NOT NULL,  -- for quarterly / monthly billing
  active                   boolean       NOT NULL DEFAULT true,
  sort_order               integer       NOT NULL DEFAULT 0
);

CREATE TABLE billing_terms (
  id           varchar      PRIMARY KEY DEFAULT gen_random_uuid(),
  term_key     varchar(20)  NOT NULL UNIQUE,   -- annual | quarterly | monthly
  display_name varchar(40)  NOT NULL,
  multiplier   numeric(4,2) NOT NULL,           -- × annual price = total commitment
  installments integer      NOT NULL            -- 1 / 4 / 12
);

CREATE TABLE feature_tiers (
  id           varchar      PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_key     varchar(20)  NOT NULL UNIQUE,   -- standard | professional | enterprise
  display_name varchar(60)  NOT NULL,
  monthly_cents integer     NOT NULL DEFAULT 0,
  sort_order   integer      NOT NULL DEFAULT 0
);

CREATE TABLE subscriptions (
  id                        varchar       PRIMARY KEY DEFAULT gen_random_uuid(),
  -- prospect fields (null once tenant is onboarded)
  email                     varchar(255),
  company_name              varchar(255),
  tenant_id                 varchar(100),
  trial_account_id          varchar       REFERENCES trial_accounts(id),
  plan_id                   varchar       NOT NULL REFERENCES plans(id),
  billing_term              varchar(20)   NOT NULL,
  feature_tier_id           varchar       REFERENCES feature_tiers(id),
  status                    varchar(20)   NOT NULL DEFAULT 'pending',
  committed_claims          integer       NOT NULL,
  claims_consumed           integer       NOT NULL DEFAULT 0,
  claims_banked             integer       NOT NULL DEFAULT 0,
  term_start                timestamptz,
  term_end                  timestamptz,
  setup_fee_cents           integer       NOT NULL,
  setup_paid_at             timestamptz,
  credit_applied_cents      integer       NOT NULL DEFAULT 0,
  overage_rate_cents        integer       NOT NULL DEFAULT 0,
  stripe_customer_id        text,
  stripe_subscription_id    text,
  stripe_checkout_session_id text         UNIQUE,
  created_at                timestamptz  NOT NULL DEFAULT now(),
  updated_at                timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE claim_ledger (
  id               varchar      PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id  varchar      NOT NULL REFERENCES subscriptions(id),
  claim_id         varchar(100),
  package_id       varchar(100),
  consumed_at      timestamptz  NOT NULL DEFAULT now(),
  source           varchar(20)  NOT NULL, -- commitment | bank | overage
  rate_cents       integer      NOT NULL
);

-- ============================================================================
-- SEED DATA
-- ============================================================================

-- Graduated pricing bands (§2.1)
INSERT INTO pricing_bands (band_from, band_to, rate_cents, sort_order) VALUES
(1,    500,  5000, 1),
(501,  1500, 4500, 2),
(1501, 3000, 4000, 3),
(3001, NULL, 3500, 4);

-- Named plans (§2.3) — annual_cents is the BASE at 1.00× multiplier
INSERT INTO plans (plan_key, display_name, committed_claims, annual_cents,
                   setup_annual_cents, setup_installment_cents, sort_order) VALUES
('solo',      'Solo',     150,    750000,   49500,   79500,  1),
('crew',      'Crew',     400,  2000000,  149500,  229500,  2),
('team',      'Team',     900,  4300000,  299500,  449500,  3),
('fleet',     'Fleet',   2000,  9000000,  599500,  899500,  4),
('regional',  'Regional',4000, 16500000,  999500, 1499500,  5);

-- Billing terms (§2.4)
INSERT INTO billing_terms (term_key, display_name, multiplier, installments) VALUES
('annual',    'Annual prepaid', 1.00, 1),
('quarterly', 'Quarterly',      1.10, 4),
('monthly',   'Monthly',        1.25, 12);

-- Feature tiers (§2.6)
INSERT INTO feature_tiers (tier_key, display_name, monthly_cents, sort_order) VALUES
('standard',     'Standard',     0,     1),
('professional', 'Professional', 24900, 2),
('enterprise',   'Enterprise',   99900, 3);
