-- Change companies.subscription_level default from 'none' to 'regional'.
--
-- Rationale: subscription_level is revoked explicitly by Stripe lifecycle events
-- (customer.subscription.deleted/updated → set to 'none').  New CRM companies
-- provisioned by admins should have full access by default; the 'none' state is
-- only reached after a confirmed revocation event.  PP-only companies are gated
-- by the ppTier check before subscription_level is ever evaluated, so changing
-- the default does not affect them.
ALTER TABLE companies ALTER COLUMN subscription_level SET DEFAULT 'regional';
