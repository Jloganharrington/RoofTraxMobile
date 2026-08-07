---
name: Change Order Step 4 — CRM approval + email delivery
description: >
  Web CRM panels for change order approval and supplement candidates;
  per-user SMTP email on approve; emailedAt column; web hooks file.
---

## SMTP table split (critical gotcha)
SMTP credentials (smtpHost, smtpPort, smtpSecure, smtpUsername, smtpPasswordEnc, smtpFromEmail)
live on **`userProfilesTable`**, NOT `usersTable`.
The actor's email address is on **`usersTable`**.

To get both in one query for the approve-email path:
```ts
const [actor] = await db
  .select({
    email:           usersTable.email,
    smtpHost:        userProfilesTable.smtpHost,
    ...
  })
  .from(userProfilesTable)
  .innerJoin(usersTable, eq(userProfilesTable.userId, usersTable.id))
  .where(eq(userProfilesTable.userId, req.user.id));
```

**Why:** Selecting smtpHost from `usersTable` compiles silently in JS but throws TS2339 during typecheck — caught immediately.

## Web CO hooks
`artifacts/rooftrax-web/src/lib/changeOrdersApi.ts` — hand-typed React Query hooks
(useListPinChangeOrders, useApproveChangeOrder, useVoidChangeOrder) using customFetch.
Query key: `['change-orders', pinId]`.
Approve mutation also invalidates `['pinProfitability', pinId]` so waterfall updates.

## LeadProfile panels
- `ChangeOrdersPanel` — Zone 4 in FinancialsTab (below ExpenseTrackerPanel).
  Accepts: `{ pinId, isManager, isInsurance }`.
  Shows status badges, line-item accordion, Approve button (manager-only, gates on doc+sig),
  `emailedAt` "✉ Emailed" indicator, supplement-candidate badge on insurance jobs.
- `InsuranceTab` — now accepts `pinId` and shows a "Supplement Candidates" section
  for COs with `requiredToCompleteScope=true && !voidedAt`.
- `FinancialsTab` — gained `isInsurance` prop; passes it to ChangeOrdersPanel.

## emailedAt column
Added to `change_orders` via `ALTER TABLE … ADD COLUMN IF NOT EXISTS emailed_at timestamptz NULL`.
Present in `changeOrderShape()` response and OpenAPI ChangeOrder schema.
Stamped only on successful email delivery (best-effort, never blocks approval).

## Test coverage (tests 14a–14d in change-orders.test.ts)
- 14a: no SMTP → approve 200, emailedAt null
- 14b: GET list includes emailedAt field on every CO
- 14c: SMTP configured but object-storage read throws → approval still 200, emailedAt null
- 14d: field_rep → 403 on approve (authz unaffected by email path)
