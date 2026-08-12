-- 055: Subscription pricing model (PRICING-SPEC v1.0)
-- Five tiers, tiered setup fees, Enterprise seat bands, plan subscriptions.
-- All pricing values are table-driven — no constants in code (spec §6/§8).
-- Idempotent.

CREATE TABLE IF NOT EXISTS plan_pricing_tiers (
  id                   varchar DEFAULT gen_random_uuid() PRIMARY KEY,
  tier_key             varchar(30) NOT NULL UNIQUE,
  display_name         varchar(60) NOT NULL,
  annual_monthly_cents integer NOT NULL,          -- $/mo when billed annually
  monthly_cents        integer,                   -- null = no monthly option
  seats_included       integer NOT NULL,
  packages_included    integer,                   -- null = unlimited
  overage_cents        integer,                   -- null = n/a
  setup_annual_cents   integer NOT NULL,
  setup_monthly_cents  integer,                   -- null = no monthly option
  monthly_available    boolean NOT NULL DEFAULT true,
  active               boolean NOT NULL DEFAULT true,
  sort_order           integer NOT NULL DEFAULT 0
);

INSERT INTO plan_pricing_tiers (tier_key, display_name, annual_monthly_cents, monthly_cents, seats_included, packages_included, overage_cents, setup_annual_cents, setup_monthly_cents, monthly_available, sort_order) VALUES
  ('field',   'Field',   8300,   NULL,   3,  3,    4000, 29500,  NULL,   false, 1),
  ('starter', 'Starter', 20800,  24900,  8,  10,   4000, 79500,  129500, true,  2),
  ('pro',     'Pro',     58300,  69900,  20, 35,   2500, 199500, 299500, true,  3),
  ('scale',   'Scale',   141600, 169900, 50, NULL, NULL, 499500, 599500, true,  4)
ON CONFLICT (tier_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS enterprise_bands (
  id         varchar DEFAULT gen_random_uuid() PRIMARY KEY,
  seat_from  integer NOT NULL UNIQUE,
  seat_to    integer,                             -- null = open-ended
  rate_cents integer NOT NULL,                    -- per-seat/mo (annual billing)
  sort_order integer NOT NULL DEFAULT 0
);

INSERT INTO enterprise_bands (seat_from, seat_to, rate_cents, sort_order) VALUES
  (51,  150,  2000, 1),
  (151, 300,  1500, 2),
  (301, NULL, 1100, 3)
ON CONFLICT (seat_from) DO NOTHING;

CREATE TABLE IF NOT EXISTS enterprise_config (
  id                            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  base_cents                    integer NOT NULL DEFAULT 170000,
  monthly_multiplier            numeric(4,2) NOT NULL DEFAULT 1.20,
  setup_per_seat_annual_cents   integer NOT NULL DEFAULT 7500,
  setup_per_seat_monthly_cents  integer NOT NULL DEFAULT 12000,
  setup_cap_annual_cents        integer NOT NULL DEFAULT 2000000,
  setup_cap_monthly_cents       integer NOT NULL DEFAULT 3000000
);

INSERT INTO enterprise_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Purchased plan subscriptions (checkout outcomes). Stripe entities stay in
-- the stripe schema; this row links them to the buyer + commit terms.
CREATE TABLE IF NOT EXISTS plan_subscriptions (
  id                         varchar DEFAULT gen_random_uuid() PRIMARY KEY,
  email                      varchar(255) NOT NULL,
  company_name               varchar(255) NOT NULL,
  trial_account_id           varchar REFERENCES trial_accounts(id),
  tier_key                   varchar(30) NOT NULL REFERENCES plan_pricing_tiers(tier_key),
  billing                    varchar(10) NOT NULL,      -- 'annual' | 'monthly'
  status                     varchar(30) NOT NULL DEFAULT 'pending', -- pending|active|canceled
  stripe_customer_id         text,
  stripe_subscription_id     text,
  stripe_checkout_session_id text UNIQUE,
  committed_seats            integer,                   -- Enterprise annual minimum
  activated_seats            integer,                   -- current period, for true-up
  setup_fee_cents            integer NOT NULL,
  setup_paid_at              timestamptz,
  credit_applied_cents       integer NOT NULL DEFAULT 0,
  last_true_up_at            timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plan_subscriptions_email_idx ON plan_subscriptions (email);

-- Enterprise "Talk to us" inquiries (no self-checkout at 51+ seats).
CREATE TABLE IF NOT EXISTS enterprise_inquiries (
  id           varchar DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name varchar(255) NOT NULL,
  contact_name varchar(255) NOT NULL,
  email        varchar(255) NOT NULL,
  phone        varchar(50),
  seats        integer NOT NULL,
  billing      varchar(10) NOT NULL DEFAULT 'annual',
  notes        text,
  quoted_mrr_cents   integer,
  quoted_setup_cents integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);
