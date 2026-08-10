---
name: Permission system STEP 3–7 completion
description: All api-server routes use requirePermission(key); web+mobile useCapabilities hooks live; 120 registry keys; 1010 tests
---

## STEP 3 result (D1–D31)

All 31 domains across every api-server route file migrated to requirePermission(key).
D32 added in STEP 6: bug_report, location, storage domains (5 new keys).
Final registry: **120 keys** across **31 domains**. Tests: **1010/1010** passing.

## STEP 4 — Web capability gating

- `artifacts/rooftrax-web/src/hooks/useCapabilities.ts` — wraps resolveCapabilities from @workspace/authz.
  Returns `{ caps, can(key), loading }`. Profile comes from useGetMyProfile().
- `UserAuthorizationPage.tsx` — now reads PERMISSION_REGISTRY live; grouped by domain with search;
  shows ✓/⚠/✗ per role based on DefaultResolution policy. Stays accurate when keys are added.
- Shell.tsx nav remains minRole-based (equivalent, no rework needed).

## STEP 5 — Mobile capability gating

- `@workspace/authz` added to `artifacts/mobile/package.json` devDependencies.
- `artifacts/mobile/hooks/useCapabilities.ts` — wraps resolveCapabilities using useProfile() data.
  Same `{ caps, can(key), loading }` API as the web hook.
- Existing screens continue to use inline role checks; migrate incrementally using `can(key)`.

## STEP 6 — Remaining server routes migrated (D32)

Files migrated to requirePermission:
- `bugReports.ts` — POST uses `bug_report.submit` (field_rep+); GET/GET-csv/PATCH use `bug_report.manage` (admin+).
  `loadActor` + inline isAdmin removed; uses req.actorCtx!.companyId.
- `storage.ts` — POST uses `storage.upload` (field_rep+); GET private uses `storage.read_private` (field_rep+).
- `location.ts` — POST /location/ping uses `location.ping` (field_rep+). GET /location/team already had team.view.

## STEP 7 — Handler body cleanup

- `templates.ts` line 312: `req.user!.id` → `req.actorCtx!.actorId`.
- `admin.ts` lines 136, 146, 215: `req.user!.id` → `req.actorCtx!.actorId` (canSetRoleDeptSpec/canSetWorkflow callers).
- `dashboard.ts` widget routes: `req.user!.companyId` → `req.actorCtx!.companyId` (all 8 occurrences).
- **Intentional survivors:** `req.user?.email` in agreement.ts + inspections.ts (email not on actorCtx);
  `getRole` export from pins.ts (still used for ownership checks in calendar.ts, completionCertificates.ts).
- Redundant inline `isAuthenticated()` guards remain in some handler bodies (weather.ts, agreement.ts,
  canvassing.ts, inspections.ts) — not harmful since requirePermission already gated them; safe to remove later.

## Critical ownerOrRole middleware rule

requirePermission(key) as middleware cannot enforce ownerOrRole without ownerId.
For ownerOrRole routes, use the read key as middleware pre-gate; ownership check stays in the handler.
**Why:** middleware resolve() has no ownerId → falls back to minRole → blocks field_rep owners.

## Registry structure rules

- `DOMAINS` array in registry.ts must include the domain before PermissionEntry.domain will accept it.
- Count assertion is compile-time: AssertExactly120. Update when adding keys.
- PERMISSION_REGISTRY entries must follow PERMISSION_KEYS tuple; all 5 new domains
  (bug_report, location, storage) added to both DOMAINS array AND PERMISSION_REGISTRY.

## getRole from pins.ts still needed

completionCertificates.ts, calendar.ts, inspections.ts import getRole from pins.ts for ownerOrRole
inline checks inside handlers. Do NOT remove the export until those checks are refactored.
