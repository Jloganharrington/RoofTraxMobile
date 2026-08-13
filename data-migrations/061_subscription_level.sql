-- Migration 061: Add subscription_level to companies
-- Tracks the active billing tier for each company. CRM-tier companies
-- must have a non-'none' value to access CRM routes (enforced in
-- requirePermission middleware). PP-only companies stay at 'none'
-- since they are already blocked by the pp_tier check.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS subscription_level varchar NOT NULL DEFAULT 'none';

-- Backfill: all existing CRM tenants get 'regional' (the highest tier)
-- so no live company loses access after this migration runs.
UPDATE companies
  SET subscription_level = 'regional'
  WHERE pp_tier = 'crm';
