---
name: Claim status history guard
description: How the statusChanging guard for claim_status_history works — to_status is nullable, null→null is excluded by the third condition alone.
---

# claim_status_history — statusChanging guard

## The rule

`to_status` in `claim_status_history` is **nullable** (DDL: `VARCHAR`, no NOT NULL). The `statusChanging` guard is:

```typescript
const statusChanging =
  incomingStatus !== undefined &&
  incomingStatus !== (pin.claimStatus ?? null);   // handles null→null automatically
```

Two conditions are sufficient:
- `!== undefined` — the field was present in the request body at all
- `!== currentValue` — the value actually changed (both normalised to null)

The null → null case is excluded by the second condition: both sides are null, so they compare equal → `statusChanging = false`. No extra `!== null` guard is needed, and adding one would silently swallow `'approved' → null` (status clearing), producing a pin update with no audit trace.

**Why:** `to_status VARCHAR` (nullable) is the right shape — clearing a status IS an auditable business event. The live activity feed renders it as "Approved → None" (server-side `humanizeStatus(null)` → "None").

**How to apply:**
- Do NOT add `&& incomingStatus !== null` to the statusChanging guard.
- Do NOT make `to_status NOT NULL` — the ALTER in migration 038 made it nullable.
- Tests: `insurance.test.ts` "claim_status_history audit trail" describe block verifies 2 rows (set → clear) and the no-op guard.

## Verification

Set 'filed', then clear to null → two history rows:
- Row 1: `from_status = null`, `to_status = 'filed'`
- Row 2: `from_status = 'filed'`, `to_status = null`
