---
name: Brain courier photo proxy + machine token design
description: How the App→Brain machine token is structured and how the internal photo proxy enforces tenant isolation.
---

## Machine token format

`BRAIN_MACHINE_TOKEN` accepts either:
- A single bare token (global scope, `companyId: null`) — works for single-tenant Brain deployments.
- A comma-separated list of `companyId:token` pairs for multi-tenant isolation.

`getBrainConfig()` always returns `tokens: BrainMachineToken[]`; call `machineTokenForCompany(config, companyId)` to pick the right one per inspection.

**Why:** the architect review flagged a broken-access-control gap — a global token lets Brain fetch any company's photos. Per-company scoping closes that without requiring per-company Brain deployments.

**How to apply:** when building any new machine-token-gated surface, use `resolveMachineToken(req)` (returns `BrainMachineToken | null` including `companyId` scope); enforce `scope.companyId !== null && row.companyId !== scope.companyId` in the query guard. Never check just token presence.

## Photo proxy scope guard

`GET /internal/photos/:photoId` (in `routes/internal.ts`):
1. Resolve token → scope.
2. DB query joins `inspection_photos` → `inspections`, selects `companyId` + `lockedAt`.
3. 404 for: no such photo, not locked (not yet submitted evidence), and token's `companyId ≠ photo's company (when scope is non-global).
4. 404 is the same code for all three — no probing leak.

## Brain-side env required

Brain must set `OBJECT_STORAGE_BASE_URL` → `https://<app-domain>/api/internal` and use the same `BRAIN_MACHINE_TOKEN` when fetching `objstore://photos/{photoId}` refs.

## Unknown Brain status values

Status endpoint (`GET /inspections/:id/status`) validates against a known-values const before accepting; an unrecognized status from a newer Brain degrades to `brain.available: false` rather than a 500.
