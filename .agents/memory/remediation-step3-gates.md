---
name: Remediation Step 3 gates — security findings 3-C, 3-F, 3-H, 3-I
description: What was gated, how it was gated, and what remains blocked on policy rulings.
---

## Implemented gates (no policy ruling required)

### FINDING 3-C — profitability endpoint role gate
`GET /pins/:pinId/profitability` in `profitability.ts` now checks `isManagerOrAdmin(role)` BEFORE the pin lookup.
Returns 403 for field_rep. **Why:** margin, cost, and payment totals are financial data field reps should not see.
`profitability.test.ts` updated: field_rep test now expects 403 (not 200).

### FINDING 3-F — pipelineStage removed from LeadProfileBody
`LeadProfileBody` in `pins.ts` no longer includes `pipelineStage`. Both PATCH handlers (pins.ts + inspections.ts) no longer accept it. **Why:** accepting pipelineStage via canEditPin() bypasses the advance-stage gate logic.

### FINDING 3-H — contractAmount gated to manager+
Both `pins.ts` and `inspections.ts` lead-profile PATCH handlers check `isManagerOrAdmin(role)` for `d.contractAmount !== undefined`. Returns 403 for field_rep. **Why:** contractAmount flows into revised_contract_cents on the profitability view; field reps changing it is a financial bypass.

### FINDING 3-I — non-positive money amounts rejected
Both PATCH handlers reject `contractAmount`, `deductibleAmount`, `rcvAmount` with value ≤ 0 (after parseFloat). Null is allowed ("clear the field"). Returns 400 with field name + received value.

---

## BLOCKED items (policy rulings needed)

### FINDING 3-D/3-E + PD-1/PD-2 — admin namespace gate
`admin.ts` uses `isManagerOrAdmin` on all routes. Managers can reach `GET /admin/stats` and `DELETE /admin/users/:id`. PD-1: should managers reach /admin/*? PD-2: should delete-user require admin+? CRM nav shows Team Management to managers, suggesting current behavior may be intentional.

**Recommended baseline if no ruling received:** Keep `isManagerOrAdmin` on GET/PATCH admin routes; upgrade `DELETE /admin/users/:id` to `isAdmin` (admin | super_admin) as a minimum.

### FINDING 3-G + PD-3 — canvasser invoice list
`GET /pins/:id/invoices` serves field_rep with no dept/role gate. PD-3: should canvassers see the invoice list?

### FINDING 3-B — inspection cross-tenant 403 → 404
**Already addressed.** `loadInspectionInCompany` uses `WHERE id = ? AND company_id = ?`, returning 404 for cross-tenant. Verified empirically: BBTest manager trying to GET a ZZTEST inspection → HTTP 404.

### Step 3 audit record — IMPLEMENTED (migration 044)
`pin_financial_changes` table: company_id, pin_id, field ('contract_amount'|'deductible_amount'|'rcv_amount'), old_value, new_value, changed_by_user_id, changed_at, reason (NOT NULL). All three financial fields now require manager+ AND reason. GET /pins/:pinId/financial-changes returns history (manager+ only). 11 tests — 682/682.

---

## pdfkit must be externalized in build.mjs (COC fix)
See `coc-extraction-and-pdf.md` — pdfkit AFM font paths break when bundled; add to `external` list.
