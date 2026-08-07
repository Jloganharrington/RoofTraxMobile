---
name: Profitability view
description: History of pin_profitability view migrations, formula corrections, and API shape.
---

## View history

- **026**: created `pin_profitability` view; basic payments / expenses / commissions.
- **027**: added `expected_total_cents` (integer) + `cash_margin_pct` + `projected_margin_pct`  (numeric).
  - `expected_total_cents` column type is **integer** — must stay integer across all future `CREATE OR REPLACE VIEW` calls.
- **028**: pins table gained `canvassing_commission_cents`.
- **030**: appended `canvassing_commission_cents` (int, pos 19), `approved_co_cents` (bigint, pos 20), `revised_contract_cents` (bigint, pos 21), `net_project_margin_cents` (bigint, pos 22).
- **029** (FINANCIALS STEP 5, Step 2): `data-migrations/029_profitability_view_step5.sql`
  - Fixed `revised_contract_cents` = `_parse_legacy_money_cents(contract_amount) + approved_co_cents` (previously used `expected_total`, wrong for insurance leads).
  - Fixed `expected_total_cents` baseline → now uses `revised_contract_cents` instead of raw contract; insurance = `GREATEST(revised, approvedRcv)`.
  - Added `net_project_margin_pct` (numeric, pos 23).
  - **Type guard**: `SUM(integer)` → bigint in postgres; `expected_total_cents` must be cast `::int` in the CTE because position 16 was declared integer in migration 027. New columns (21–23) are bigint/numeric and are fine.

## API shape (after migration 029)

File: `artifacts/api-server/src/routes/profitability.ts`

- `projectedMarginPct` **removed** from response (Step 2d). The column still exists in the view at position 18 for column-order compatibility.
- New fields exposed: `canvassingCommissionCents`, `approvedCoCents`, `revisedContractCents`, `netProjectMarginCents`, `netProjectMarginPct`.

## UI shape (after Step 3)

File: `artifacts/rooftrax-web/src/pages/leads/LeadProfile.tsx`

- `FinKpiCards`: "Net Profit" → "Net Project Margin" (shows `netProjectMarginCents` + `netProjectMarginPct`%); Contract Value card shows "+$X CO → $Y" subline when `approvedCoCents > 0`.
- `CostBreakdownPanel` renamed → `ProjectFinancialsPanel` (accrual waterfall).
  - Rows: Contract Value → Change Orders (if nonzero) → Revised Contract → COGS → Job Overhead (collapsible, 5 lines) → Net Project Margin.
  - Overhead 5 lines: Lead Acquisition, Referral Fee, Sales Commission, Canvassing Commission, PM Commission; last three have mark-paid buttons.
  - Committed-but-unpaid subtotal row appears when any overhead has an amount but no paid date.
- `CommissionField` type and `OVERHEAD_FIELDS` replace old `COST_BREAKDOWN_FIELDS`; canvassing added as 4th entry.
- `useMarkCanvassingCommissionPaid` imported from `@workspace/api-client-react`.

## Key gotcha

After orval regenerates `lib/api-client-react/src/generated/`, run:
```
cd lib/api-client-react && npx tsc --build
```
rooftrax-web's tsconfig uses project references (`"references": [{"path": "../../lib/api-client-react"}]`) so TypeScript reads declaration files from `dist/`, not the source — stale dist = stale types even though orval updated the `.ts` source.
