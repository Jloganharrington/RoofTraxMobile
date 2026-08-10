---
name: requireWritableInspection middleware
description: Single decision point for inspection write routes — replaces the three-check (requirePermission + requireInspectionModuleAccess + loadWritableInspection) pattern.
---

## The rule
All inspection **write** routes must use `requireWritableInspection()` (or `{ allowLocked: true }` for locked-safe routes) as their sole middleware. Do NOT use `requirePermission('inspection.read')` on write routes — that key was semantically wrong and led to the three-check mess.

**Why:** Previously every write handler had three scattered decision points:
1. `requirePermission('inspection.read')` in middleware (wrong key, only checked role floor)
2. `requireInspectionModuleAccess(req, res)` inline (redundant DB query for role/dept already on actorCtx)
3. `loadWritableInspection(...)` inline (ownership + lock check)

Collapsed into `requireWritableInspection()` in `artifacts/api-server/src/middlewares/requireWritableInspection.ts`.

**How to apply:**
- Write routes (no lock bypass): `requireWritableInspection()`
- Write routes that accept locked inspections (addenda, supplement compile/attest/deliver, report attestation, submission, email-report): `requireWritableInspection({ allowLocked: true })`
- Read routes: keep `requirePermission('inspection.read')` + `requireInspectionModuleAccess()` inline (dept check still needed; no ownership gate)
- Manage routes: keep `requirePermission('inspection.manage')` + `requireInspectionModuleAccess()` inline

## ActorCtx.userId alias
`ActorCtx` has a `userId: string` backward-compat alias for `actorId`. It exists so handler bodies that reference `actor.userId` continue to compile during the write-route migration without a mass rename. Remove it once migration is complete.

## Department import quirk
`inspections.ts` imports other authz exports from `@workspace/authz` but `Department` type must be imported **separately** as `import type { Department } from '@workspace/authz'` — it is not re-exported alongside the function group import.

## requireInspectionModuleAccess optimization
The helper is now optimized: reads `role` and `department` directly from `req.actorCtx!` (no DB round-trip). It is still called by read/manage routes where `requireWritableInspection` is not present.

## inspection.delete registry fix
`inspection.delete` minRole corrected from `super_admin` → `admin`.
