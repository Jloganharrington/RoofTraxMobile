---
name: Permission system STEP 3 completion
description: All api-server routes now use requirePermission(key); key facts about the implementation
---

## STEP 3 result

All 31 domains (D1–D31) across every api-server route file are migrated.
Final registry: 115 keys. Tests: 997/997 passing. Commits: D1–D19 in prior sessions; D20–D31 in this session.

## Critical ownerOrRole middleware rule

`requirePermission(key)` used as middleware CANNOT enforce ownerOrRole without ownerId.
For ownerOrRole keys (inspection.update, lead.update, expense.*, etc.), use the next lower read key
as the middleware pre-gate (`inspection.read`, `lead.read`), then rely on the helper that already
does the ownerOrRole check inside the handler (loadWritableInspection, etc.).

**Why:** The middleware calls resolve(key, actorCtx) without ownerId → falls back to minRole check →
field_rep owners blocked → 97 test failures in D31 until this rule was applied.

**How to apply:** For any route using loadWritableInspection or similar ownership-checking helpers,
use `requirePermission('inspection.read')` as the middleware; for lead ownership routes use
`requirePermission('lead.read')`.

## inspection.delete is super_admin (not admin)

Updated in D31: inspection.delete = minRole super_admin. The code had roleRank(super_admin) check
before migration; the registry was originally admin+ (too permissive). Corrected.

## dashboardGuard.ts now calls loadActorCtx

requireWidgetCapability calls loadActorCtx internally so widget route handlers can use
req.actorCtx!.actorId. Without this, widget routes that used req.user!.id after the
global replacement got undefined at runtime.

## inspection.manage key (manager+)

Added for: unlock, curation/finalize, sections/captions/*, sections/:type/auto-approve,
sections/:type/lock, supplements/:suppId/sections/:type/lock, ahj-check uses catalog.ahj_wizard.

## getRole from pins.ts still needed

completionCertificates.ts, calendar.ts, and inspections.ts all import getRole from pins.ts
for ownerOrRole inline checks inside handlers. Do NOT remove the export.

## Next steps (STEP 4–7)

- STEP 4: Front-end capability gating (rooftrax-web) — use resolveCapabilities() to hide/disable
  UI elements the user can't access
- STEP 5: Mobile capability gating (Expo app)
- STEP 6: Integration tests against production-like auth flows
- STEP 7: Final audit — remove dead code (legacy getRole usages where replaced by requirePermission)
