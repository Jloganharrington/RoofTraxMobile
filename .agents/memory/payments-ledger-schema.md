---
name: Payments ledger schema (Step 1)
description: payments table added in migration 023; LeadProfileBody bypass route closed; orval-generated hooks use {pinId, data} for POST mutation.
---

## What was done in Step 1
- Migration: `data-migrations/023_payments_ledger.sql` — `payments` table + `_parse_legacy_money_cents()` helper + 4 backfill INSERTs (idempotent via `md5` deterministic IDs + `ON CONFLICT DO NOTHING`).
- `lib/db/src/schema/rooftrax.ts`: `PAYMENT_TYPES`, `paymentsTable`, `Payment`, `InsertPayment`.
- `lib/api-spec/openapi.yaml`: 4 paths + 5 schemas.
- `artifacts/api-server/src/routes/payments.ts`: 4 routes with IDOR guard.
- `artifacts/api-server/src/routes/pins.ts` + `inspections.ts`: removed `depositAmount`, `depositDate`, `depositPaymentMethod`, `acvAmount`, `supplementAmount`, `finalPaymentAmount` from `LeadProfileBody` — bug fix (iii).
- `artifacts/rooftrax-web/src/pages/leads/LeadProfile.tsx`: `FinancialsTab` rewritten with payments ledger UI using generated hooks.

## Generated hook signatures (from orval)
- `useGetPayments(pinId: string)` → query
- `useCreatePayment()` → mutation vars: `{pinId: string; data: CreatePaymentInput}`
- `useUpdatePayment()` → mutation vars: `{paymentId: string; data: UpdatePaymentInput}`
- `useDeletePayment()` → mutation vars: `{paymentId: string}`

## Money invariant
- Server: `amountCents integer min:1` — never a float, never a string
- UI: `parseDollarToCents(str)` converts at the edge; `formatCents(n)` displays
- SQL helper: `_parse_legacy_money_cents(text)` for backfill only

## Fields kept in LeadProfileBody (descriptive, not payment records)
`contractAmount`, `deductibleAmount`, `rcvAmount`, `approvedRcvAmount`, `approvedAcvAmount`, `depreciationAmount`
