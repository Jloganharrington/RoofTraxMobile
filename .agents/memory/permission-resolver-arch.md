---
name: Permission resolver architecture
description: How the lib/authz resolver works, what's exported, and where the coc.sign special case lives.
---

## Location
`lib/authz/src/resolver.ts` — exported from `lib/authz/src/index.ts`

## Public API
```ts
resolve(permission: Permission, ctx: ResolveContext): ResolveResult  // { allowed: boolean; reason: string }
can(permission: Permission, ctx: ResolveContext): boolean             // shorthand for resolve().allowed
resolveResolution(res: DefaultResolution, permission: Permission, ctx: ResolveContext): ResolveResult
```

**IMPORTANT:** `ResolveResult` has `allowed: boolean` — NOT `verdict` or `permit`.
Pattern B guard: `const result = resolve(key, { ...actorCtx, ownerId: pin.userId }); if (!result.allowed) { res.status(403)... }`

**`loadActorCtx` also sets `req.actorCtx`** — it stamps `req.actorCtx = ctx` before returning, so Pattern-B handlers (which call it directly instead of going through the middleware) can safely use `req.actorCtx!.*` in nested callbacks (notify(), audit inserts, etc.) alongside the local `actorCtx` variable.

`resolveResolution` is exported for two purposes:
1. Unit-testing synthetic resolution kinds (floor, selfOnly, department, workflow) that have no registry entries yet.
2. Step 5 per-user override layer — mutate the DefaultResolution then call resolveResolution.

## ResolveContext shape
```ts
interface ResolveContext {
  role: Role | null;           // null = no profile row
  actorId: string;
  ownerId?: string | null;     // required for ownerOrRole / selfOnly
  department?: Department | null;
  workflowAssignment?: WorkflowAssignment | null;
}
```

## Role rank
field_rep=0, manager=1, admin=2, super_admin=3 (no `canvasser` — that's a Department).

## coc.sign office shortcut
`coc.sign` (`ownerOrRole`, minRole=manager) has an explicit special case in the resolver:
any member with a non-null role AND `department === 'office'` is allowed, regardless of ownership.
This matches the legacy `canSignCompletionCertificate()` helper. The shortcut is in the
resolver code, NOT in the registry kind — the registry entry stays `ownerOrRole`.

**Why:** the office-dept shortcut is a composite rule that doesn't map cleanly to a single
resolution kind. Keeping it in the resolver (documented in the registry entry's `note` field)
is simpler than adding a new kind for one permission.

## Test counts (as of implementation)
- resolver.test.ts: 610 tests covering all 94 registry permissions + synthetic kinds
- Sanity assertions: 74 minRole entries, 20 ownerOrRole entries (verified at test time)
