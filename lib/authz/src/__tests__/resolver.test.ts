/**
 * lib/authz/src/__tests__/resolver.test.ts
 *
 * Full permission resolver test matrix.
 *
 * ─── Coverage goals ──────────────────────────────────────────────────────────
 *
 * Section A — minRole permissions (74 entries)
 *   A1. Every permission: boundary role → allowed
 *   A2. Every permission: one step below boundary → denied (where below exists)
 *   A3. Every permission: super_admin → always allowed (role inheritance)
 *   A4. Every permission: null role → always denied
 *
 * Section B — ownerOrRole permissions (20 entries)
 *   B1. Owner with role BELOW minRole → allowed (owner shortcut)
 *   B2. Non-owner with role AT minRole → allowed (role gate)
 *   B3. Non-owner with role BELOW minRole → denied
 *   B4. Null role, IS owner → allowed (owner shortcut still fires)
 *   B5. No ownerId supplied (undefined) → falls through to role gate only
 *
 * Section C — coc.sign office shortcut
 *   C1. Office-dept field_rep, not owner → allowed
 *   C2. Non-office field_rep, not owner → denied
 *   C3. Office-dept null role → denied (must have a role)
 *   C4. Office-dept field_rep, IS owner → allowed (owner path, not shortcut)
 *
 * Section D — synthetic resolution kinds (floor / selfOnly / department / workflow)
 *   D1–D8: tested directly via resolveResolution() since no registry entry uses
 *   these kinds yet.
 *
 * Section E — can() convenience wrapper
 *   E1. Returns boolean, not ResolveResult.
 */

import { describe, expect, it } from 'vitest';
import type { DefaultResolution, Permission } from '../registry';
import { PERMISSION_REGISTRY } from '../registry';
import type { ResolveContext } from '../resolver';
import { can, resolve, resolveResolution } from '../resolver';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const ACTOR  = 'uid-actor';
const OWNER  = 'uid-actor';   // same as ACTOR — actor IS the owner
const OTHER  = 'uid-other';   // different user — actor is NOT the owner

const ROLES_IN_ORDER = ['field_rep', 'manager', 'admin', 'super_admin'] as const;

/** Role immediately below `role`, or null when `role` is already the lowest. */
function roleBelow(role: string): (typeof ROLES_IN_ORDER)[number] | null {
  const idx = ROLES_IN_ORDER.indexOf(role as (typeof ROLES_IN_ORDER)[number]);
  return idx > 0 ? ROLES_IN_ORDER[idx - 1] : null;
}

// ── Extract registry slices ───────────────────────────────────────────────────

type MinRoleEntry   = (typeof PERMISSION_REGISTRY[number]) & { default: { kind: 'minRole';    minRole: (typeof ROLES_IN_ORDER)[number] } };
type OwnerOrEntry   = (typeof PERMISSION_REGISTRY[number]) & { default: { kind: 'ownerOrRole'; minRole: (typeof ROLES_IN_ORDER)[number] } };

const minRolePerms: MinRoleEntry[]  = PERMISSION_REGISTRY.filter(
  (e): e is MinRoleEntry => e.default.kind === 'minRole',
);
const ownerOrRolePerms: OwnerOrEntry[] = PERMISSION_REGISTRY.filter(
  (e): e is OwnerOrEntry => e.default.kind === 'ownerOrRole',
);

// ── Section A — minRole boundary matrix ──────────────────────────────────────

describe('A — minRole permissions', () => {
  it('A0: sanity — there are 74 minRole entries in the registry', () => {
    expect(minRolePerms.length).toBe(74);
  });

  it.each(minRolePerms)(
    'A1 $key: role=$default.minRole → allowed',
    (entry) => {
      const minRole = (entry.default as { kind: 'minRole'; minRole: (typeof ROLES_IN_ORDER)[number] }).minRole;
      const ctx: ResolveContext = { role: minRole, actorId: ACTOR };
      expect(resolve(entry.key, ctx)).toMatchObject({ allowed: true });
    },
  );

  it.each(
    minRolePerms.filter(e =>
      roleBelow((e.default as { kind: 'minRole'; minRole: string }).minRole) !== null,
    ),
  )(
    'A2 $key: role below $default.minRole → denied',
    (entry) => {
      const minRole = (entry.default as { kind: 'minRole'; minRole: (typeof ROLES_IN_ORDER)[number] }).minRole;
      const below   = roleBelow(minRole)!;
      const ctx: ResolveContext = { role: below, actorId: ACTOR };
      const result = resolve(entry.key, ctx);
      expect(result).toMatchObject({ allowed: false });
    },
  );

  it.each(minRolePerms)(
    'A3 $key: super_admin → always allowed',
    (entry) => {
      expect(resolve(entry.key, { role: 'super_admin', actorId: ACTOR })).toMatchObject({ allowed: true });
    },
  );

  it.each(minRolePerms)(
    'A4 $key: null role → always denied',
    (entry) => {
      expect(resolve(entry.key, { role: null, actorId: ACTOR })).toMatchObject({ allowed: false });
    },
  );
});

// ── Section B — ownerOrRole boundary matrix ───────────────────────────────────

describe('B — ownerOrRole permissions', () => {
  it('B0: sanity — there are 20 ownerOrRole entries in the registry', () => {
    expect(ownerOrRolePerms.length).toBe(20);
  });

  it.each(ownerOrRolePerms)(
    'B1 $key: field_rep IS owner → allowed (owner shortcut, below manager)',
    (entry) => {
      // field_rep is always below manager (the minRole for all ownerOrRole entries)
      const ctx: ResolveContext = { role: 'field_rep', actorId: ACTOR, ownerId: OWNER };
      expect(resolve(entry.key, ctx)).toMatchObject({ allowed: true });
    },
  );

  it.each(ownerOrRolePerms.filter(e => e.key !== 'coc.sign'))(
    'B2 $key: manager NOT owner → allowed (role gate)',
    (entry) => {
      const ctx: ResolveContext = { role: 'manager', actorId: ACTOR, ownerId: OTHER };
      expect(resolve(entry.key, ctx)).toMatchObject({ allowed: true });
    },
  );

  it.each(ownerOrRolePerms.filter(e => e.key !== 'coc.sign'))(
    'B3 $key: field_rep NOT owner → denied',
    (entry) => {
      const ctx: ResolveContext = { role: 'field_rep', actorId: ACTOR, ownerId: OTHER };
      expect(resolve(entry.key, ctx)).toMatchObject({ allowed: false });
    },
  );

  it.each(ownerOrRolePerms)(
    'B4 $key: null role, IS owner → allowed (owner shortcut does not need a role)',
    (entry) => {
      const ctx: ResolveContext = { role: null, actorId: ACTOR, ownerId: OWNER };
      // coc.sign office shortcut requires role !== null, but the owner path does not
      expect(resolve(entry.key, ctx)).toMatchObject({ allowed: true });
    },
  );

  it.each(ownerOrRolePerms.filter(e => e.key !== 'coc.sign'))(
    'B5 $key: ownerId omitted, field_rep → denied (role gate only)',
    (entry) => {
      const ctx: ResolveContext = { role: 'field_rep', actorId: ACTOR };  // no ownerId
      expect(resolve(entry.key, ctx)).toMatchObject({ allowed: false });
    },
  );

  it.each(ownerOrRolePerms)(
    'B6 $key: super_admin NOT owner → allowed (super_admin satisfies any minRole)',
    (entry) => {
      const ctx: ResolveContext = { role: 'super_admin', actorId: ACTOR, ownerId: OTHER };
      expect(resolve(entry.key, ctx)).toMatchObject({ allowed: true });
    },
  );

  it.each(ownerOrRolePerms)(
    'B7 $key: null role, NOT owner → denied',
    (entry) => {
      const ctx: ResolveContext = { role: null, actorId: ACTOR, ownerId: OTHER };
      expect(resolve(entry.key, ctx)).toMatchObject({ allowed: false });
    },
  );
});

// ── Section C — coc.sign office shortcut ─────────────────────────────────────

describe('C — coc.sign office shortcut', () => {
  it('C1: office-dept field_rep, not owner → allowed', () => {
    expect(
      resolve('coc.sign', { role: 'field_rep', actorId: ACTOR, ownerId: OTHER, department: 'office' }),
    ).toMatchObject({ allowed: true, reason: expect.stringContaining('office-department') });
  });

  it('C2: non-office field_rep, not owner → denied', () => {
    expect(
      resolve('coc.sign', { role: 'field_rep', actorId: ACTOR, ownerId: OTHER, department: 'canvasser' }),
    ).toMatchObject({ allowed: false });
  });

  it('C2b: canvasser dept and no department → denied', () => {
    expect(
      resolve('coc.sign', { role: 'field_rep', actorId: ACTOR, ownerId: OTHER }),
    ).toMatchObject({ allowed: false });
  });

  it('C3: office-dept but null role → denied (shortcut requires a non-null role)', () => {
    expect(
      resolve('coc.sign', { role: null, actorId: ACTOR, ownerId: OTHER, department: 'office' }),
    ).toMatchObject({ allowed: false });
  });

  it('C4: office-dept field_rep, IS owner → allowed (owner path)', () => {
    // Both paths (owner and office shortcut) lead to allowed — result is stable.
    expect(
      resolve('coc.sign', { role: 'field_rep', actorId: ACTOR, ownerId: OWNER, department: 'office' }),
    ).toMatchObject({ allowed: true });
  });

  it('C5: office-dept field_rep, ownerId omitted → allowed via office shortcut', () => {
    expect(
      resolve('coc.sign', { role: 'field_rep', actorId: ACTOR, department: 'office' }),
    ).toMatchObject({ allowed: true, reason: expect.stringContaining('office-department') });
  });

  it('C6: office-dept manager, not owner → allowed (manager satisfies role gate anyway)', () => {
    expect(
      resolve('coc.sign', { role: 'manager', actorId: ACTOR, ownerId: OTHER, department: 'office' }),
    ).toMatchObject({ allowed: true });
  });
});

// ── Section D — synthetic resolution kinds ────────────────────────────────────
// These kinds are defined in the DefaultResolution union but not used in the
// registry yet. We test them via resolveResolution() directly.

describe('D — synthetic resolution kinds (floor / selfOnly / department / workflow)', () => {
  // Use any valid permission as a nominal key — the value doesn't affect these paths.
  const ANY: Permission = 'lead.read';

  // ── floor ─────────────────────────────────────────────────────────────────
  it('D1: floor → always denied, even for super_admin', () => {
    const res: DefaultResolution = { kind: 'floor' };
    expect(resolveResolution(res, ANY, { role: 'super_admin', actorId: ACTOR })).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('system-internal'),
    });
  });

  it('D2: floor → denied for null role', () => {
    const res: DefaultResolution = { kind: 'floor' };
    expect(resolveResolution(res, ANY, { role: null, actorId: ACTOR })).toMatchObject({ allowed: false });
  });

  // ── selfOnly ──────────────────────────────────────────────────────────────
  it('D3: selfOnly → allowed when actorId === ownerId', () => {
    const res: DefaultResolution = { kind: 'selfOnly' };
    expect(
      resolveResolution(res, ANY, { role: null, actorId: ACTOR, ownerId: ACTOR }),
    ).toMatchObject({ allowed: true, reason: expect.stringContaining('selfOnly') });
  });

  it('D4: selfOnly → denied when actorId !== ownerId, even for super_admin', () => {
    const res: DefaultResolution = { kind: 'selfOnly' };
    expect(
      resolveResolution(res, ANY, { role: 'super_admin', actorId: ACTOR, ownerId: OTHER }),
    ).toMatchObject({ allowed: false });
  });

  it('D5: selfOnly → denied when ownerId is omitted', () => {
    const res: DefaultResolution = { kind: 'selfOnly' };
    expect(
      resolveResolution(res, ANY, { role: null, actorId: ACTOR }),
    ).toMatchObject({ allowed: false });
  });

  // ── department ────────────────────────────────────────────────────────────
  it('D6: department — matching dept → allowed regardless of role', () => {
    const res: DefaultResolution = { kind: 'department', departments: ['inspector_canvasser'] };
    expect(
      resolveResolution(res, ANY, { role: null, actorId: ACTOR, department: 'inspector_canvasser' }),
    ).toMatchObject({ allowed: true });
  });

  it('D7: department — non-matching dept → denied', () => {
    const res: DefaultResolution = { kind: 'department', departments: ['inspector_canvasser'] };
    expect(
      resolveResolution(res, ANY, { role: 'super_admin', actorId: ACTOR, department: 'office' }),
    ).toMatchObject({ allowed: false });
  });

  // ── workflow ──────────────────────────────────────────────────────────────
  it('D8: workflow — matching workflow → allowed', () => {
    const res: DefaultResolution = { kind: 'workflow', workflows: ['insurance_retail'] };
    expect(
      resolveResolution(res, ANY, { role: null, actorId: ACTOR, workflowAssignment: 'insurance_retail' }),
    ).toMatchObject({ allowed: true });
  });

  it('D9: workflow — non-matching → denied', () => {
    const res: DefaultResolution = { kind: 'workflow', workflows: ['insurance_retail'] };
    expect(
      resolveResolution(res, ANY, { role: 'super_admin', actorId: ACTOR, workflowAssignment: 'retail' }),
    ).toMatchObject({ allowed: false });
  });

  it('D10: workflow — null workflowAssignment → denied', () => {
    const res: DefaultResolution = { kind: 'workflow', workflows: ['retail'] };
    expect(
      resolveResolution(res, ANY, { role: 'admin', actorId: ACTOR }),
    ).toMatchObject({ allowed: false });
  });
});

// ── Section E — can() convenience wrapper ─────────────────────────────────────

describe('E — can() wrapper', () => {
  it('E1: can() returns true for an allowed permission', () => {
    expect(can('lead.read', { role: 'field_rep', actorId: ACTOR })).toBe(true);
  });

  it('E2: can() returns false for a denied permission', () => {
    expect(can('team.view_stats', { role: 'field_rep', actorId: ACTOR })).toBe(false);
  });

  it('E3: can() returns boolean, not an object', () => {
    const result = can('lead.read', { role: 'manager', actorId: ACTOR });
    expect(typeof result).toBe('boolean');
  });
});

// ── Section F — ResolveResult.reason is always a non-empty string ─────────────

describe('F — reason string is always present', () => {
  it.each(PERMISSION_REGISTRY)(
    'F $key: allowed=true has non-empty reason',
    (entry) => {
      // Use a context that is maximally permissive so we get an "allowed" result.
      const ctx: ResolveContext = { role: 'super_admin', actorId: ACTOR, ownerId: ACTOR, department: 'office', workflowAssignment: 'insurance_retail' };
      const result = resolve(entry.key, ctx);
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    },
  );

  it.each(PERMISSION_REGISTRY)(
    'F $key: allowed=false has non-empty reason',
    (entry) => {
      // Null role → denied on all minRole/ownerOrRole/floor/department/workflow entries.
      const ctx: ResolveContext = { role: null, actorId: ACTOR, ownerId: OTHER };
      const result = resolve(entry.key, ctx);
      // floor and some others are always denied; the rest depend on role.
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    },
  );
});
