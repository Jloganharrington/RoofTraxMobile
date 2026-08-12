---
name: Pricing & Stripe billing architecture
description: Per-claim graduated-band model (Master Build Doc v1.0), Stripe catalog/lookup-key conventions, credit reservation, webhook fulfillment, and the stripe-replit-sync type-name collision.
---

# Pricing & Stripe billing

## Model (current — per-claim, Master Build Document v1.0)
- **DB schema**: migration `056_per_claim_pricing.sql` — tables: `pricing_bands`, `plans`, `billing_terms`, `feature_tiers`, `subscriptions`, `claim_ledger`. Old seat-based tables (`plan_pricing_tiers`, `enterprise_bands`, `enterprise_config`, `plan_subscriptions`, `enterprise_inquiries`) dropped.
- **5 plans**: Solo (150 claims/$7,500/yr), Crew (400/$20,000), Team (900/$43,000), Fleet (1,800/$90,000), Regional (3,300/$165,000).
- **3 billing terms**: `annual` (1.0×, 1 installment), `quarterly` (1.1×, 4 installments), `monthly` (1.25×, 12 installments). All plans support all terms.
- **3 feature tiers**: `standard` ($0/mo, included), `professional` ($249/mo), `enterprise` ($999/mo). Self-checkout only — no talk-to-us gate.
- **Pricing engine** (`api-server/src/lib/pricing/engine.ts`): `annualCents()` (graduated bands), `quotePlan()`, `recommendPlan()`, `creditEligibility()`. 32 unit tests pass.
- **Credit eligibility**: Crew and above **AND** annual term **AND** within 90 days of first trial submission. Both conditions always shown together.
- **True-up**: Annual only, upward ratchet. Daily job at 2 AM (`trueUp.ts` → `startAnnualTrueUpJob()`). No quarterly/seat logic.

## Stripe catalog (seeded — per-claim model)
- Lookup key conventions: `plan_{key}_{term}` (15 prices), `feature_{key}_monthly` (2 prices), `setup_{key}_annual` and `setup_{key}_installment` (10 prices), `trial_package_first/subsequent`.
- Seed script: `scripts/src/seed-pricing-products.ts` via `pnpm exec tsx ./src/seed-pricing-products.ts` (run from scripts/).
- Import from stripeClient: `getUncachableStripeClient` (NOT `getStripeClient` — that name doesn't exist).
- Catalog verified against DB at checkout (`resolveVerifiedPrice`) — stale catalog fails loudly.

## Checkout flow
- `POST /api/pricing/checkout` → credit reservation under row lock → Stripe session with plan + setup + feature-tier line items → `checkoutUrl`.
- Coupon restricted to plan product via `applies_to.products` so setup fee is untouchable by coupon.
- `POST /api/pricing/checkout/confirm` → fast-path/reconciliation (not authoritative). URL params: `session_id` + `subscription_id`.
- **Webhook is authoritative**: `handleStripeBusinessEvent` in `lib/pricing/fulfillment.ts` handles `checkout.session.completed/expired`. Uses `subscriptions` table (not old `planSubscriptions`). Metadata key: `subscriptionId`.

## Credit reservation model
- Reserved at checkout transaction under trial-account row lock.
- Released on session expiry or failed creation (`releaseCreditReservation()`).
- Activation never re-touches the balance.
- Prevents concurrent double-spend.

## Gotchas
- **stripe-replit-sync name collision**: its migration creates a `pricing_tiers` enum in the `stripe` schema; any public table named `pricing_tiers` breaks `runMigrations`. New tables must not share names with stripe-schema objects.
- Stripe connector settings keys: `secret` / `publishable` (NOT `secret_key`).
- CORS middleware: deny with `callback(null, false)`, not throw — throwing turns non-allowlisted origins into 500s.
- `optionalTrialAccount()` in pricing.ts reads the `Authorization: Bearer` header and calls `getTrialAccountByToken()` from `lib/trial/session.ts` (NOT `getTrialAccountFromToken` — that name doesn't exist).
