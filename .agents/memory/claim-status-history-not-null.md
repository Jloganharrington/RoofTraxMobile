---
name: Claim status history NOT NULL guard
description: Why clearing claim_status (setting to null) must not produce a claim_status_history row.
---

# claim_status_history — to_status NOT NULL guard

## The rule

When writing a `claim_status_history` row in `PATCH /pins/:pinId/insurance`, the `statusChanging` guard must require **`incomingStatus !== null`** in addition to the usual "value actually changed" check:

```typescript
const statusChanging =
  incomingStatus !== undefined &&
  incomingStatus !== null &&           // ← required: to_status is NOT NULL
  incomingStatus !== (pin.claimStatus ?? null);
```

**Why:** `claim_status_history.to_status` is `VARCHAR NOT NULL`. Clearing the claim status (sending `{ claimStatus: null }`) sets `incomingStatus = null`. Without this guard, the INSERT tries to store `null` into a NOT NULL column → 500.

**How to apply:** Any code path that writes to `claim_status_history` must skip the INSERT when `toStatus` would be null. This means "approved → null (cleared)" produces no history row, which is acceptable — the clearing event isn't meaningful in claim-status vocabulary. The pin update itself still sets `claimStatus = null`.

## Impact

- The live activity feed's `claim_status_changed` events only appear for non-null transitions (first set, or any change to a valid enum value). Clearing the status is invisible in the feed.
- The authz test Case 3 now includes `live_activity` in the manager capability assertions.
