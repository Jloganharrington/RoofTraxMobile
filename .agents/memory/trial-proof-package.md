---
name: Trial Proof Package system
description: Paid trial intake on the marketing site — trial auth track, payments stub seam, deliverable delivery links, purge job
---

# Trial Proof Package

- **Separate auth track**: trial customers are NOT users. `trial_accounts` + `trial_sessions` (Bearer token via `requireTrialAuth`, `req.trialAccount`). Admin side reuses normal cookie auth + `requirePermission('team.view_stats')`.
- **Payments are stubbed** behind `lib/trial/payments.ts`. `createCheckout` throws `PaymentsNotConfigured` → route returns 503 `{code:'payments_not_configured'}` and the frontend treats it as "we'll reach out". Stripe wiring later must call the exported `recordSuccessfulPayment(submissionId, paymentId)` from its webhook — that function is the single idempotent seam (row-locked, re-checks package cap under lock). Dev path: `TRIAL_DEV_FAKE_PAYMENTS=1` (development env) + `POST /trial/submissions/:id/simulate-payment`.
- **Deliverable links**: GCS URL signing caps at 7 days, so a "30-day download link" must be a tokenized API route (`GET /trial/deliverable/:token`, `deliverable_token` column) that mints a fresh 15-min signed URL per click and enforces the retention window server-side.
  **Why:** signObjectURL 500s on ttlSec > 7 days — discovered when send-deliverable tried a 30-day signed URL.
- **Purge job** (`runTrialPurge`, hourly tick / once per UTC day): deletes upload objects AND the deliverable object, nulls claim fields + deliverable key/token. `deleteObjectEntity` now throws on non-404 failure so a submission is only marked purged when storage deletion succeeded (retries next run).
- **Frontend fetch convention in axiomrestore-web**: API is at root `/api/...` (matches `customFetch`). `${import.meta.env.BASE_URL}/api/...` is WRONG — it resolves to `/axiomrestore-web/api/...` which vite serves as index.html. (Signup.tsx had this bug too; fixed.)
- Unique index `(account_id, sequence_num)` on trial_submissions guards concurrent draft creation; POST /trial/submissions catches 23505 on `.cause` and returns the existing draft.
- Migration file: `data-migrations/054_trial_proof_package.sql` (includes later ALTER + index appends; applied live).
