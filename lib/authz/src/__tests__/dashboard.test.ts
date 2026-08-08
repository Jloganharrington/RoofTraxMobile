import { describe, expect, it } from 'vitest';
import { type Capability, WIDGET_CATALOG, resolveCapabilities, selectWidgetsFor } from '../dashboard';

// Helper: extract keys from selectWidgetsFor result in order
function keys(input: Parameters<typeof selectWidgetsFor>[0]): string[] {
  return selectWidgetsFor(input).map(w => w.key);
}

// All 13 catalog keys in spec order (12 original + live_activity) — used for order-preservation checks
const CATALOG_ORDER = WIDGET_CATALOG.map(w => w.key);

describe('resolveCapabilities + selectWidgetsFor', () => {
  // ── Case 1 ──────────────────────────────────────────────────────────────
  describe('field_rep + canvasser + retail', () => {
    const input = { role: 'field_rep', department: 'canvasser', workflow: 'retail' } as const;

    it('gets exactly my_day, my_activity, recent_activity', () => {
      expect(keys(input)).toEqual([
        'my_day',
        'my_activity',
        'recent_activity',
      ]);
    });

    it('does NOT get action_required, sales_funnel, or canvassing_heatmap', () => {
      const caps = resolveCapabilities(input);
      expect(caps.has('action_required')).toBe(false);
      expect(caps.has('sales_funnel')).toBe(false);
      expect(caps.has('canvassing_heatmap')).toBe(false);
    });
  });

  // ── Case 2 ──────────────────────────────────────────────────────────────
  describe('field_rep + inspector_canvasser + insurance_retail', () => {
    const input = {
      role: 'field_rep',
      department: 'inspector_canvasser',
      workflow: 'insurance_retail',
    } as const;

    it('additionally gets pending_inspections and claim_blockers', () => {
      const caps = resolveCapabilities(input);
      expect(caps.has('pending_inspections')).toBe(true);
      expect(caps.has('claim_blockers')).toBe(true);
    });

    it('still does NOT get any minRole:manager widget', () => {
      const caps = resolveCapabilities(input);
      const managerOnlyKeys = WIDGET_CATALOG
        .filter(w => w.minRole === 'manager')
        .map(w => w.key);
      for (const k of managerOnlyKeys) {
        expect(caps.has(k as Capability), `should not have ${k}`).toBe(false);
      }
    });
  });

  // ── Case 3 ──────────────────────────────────────────────────────────────
  describe('manager + office + insurance_retail', () => {
    const input = {
      role: 'manager',
      department: 'office',
      workflow: 'insurance_retail',
    } as const;

    it('gets action_required, sales_funnel, insurance_claims, live_team, pending_inspections, live_activity', () => {
      const caps = resolveCapabilities(input);
      expect(caps.has('action_required')).toBe(true);
      expect(caps.has('sales_funnel')).toBe(true);
      expect(caps.has('insurance_claims')).toBe(true);
      expect(caps.has('live_team')).toBe(true);
      expect(caps.has('pending_inspections')).toBe(true);
      expect(caps.has('live_activity')).toBe(true);
    });
  });

  // ── Case 4 ──────────────────────────────────────────────────────────────
  describe('manager + canvasser + retail', () => {
    const input = {
      role: 'manager',
      department: 'canvasser',
      workflow: 'retail',
    } as const;

    it('gets action_required but NOT insurance_claims (workflow gate)', () => {
      const caps = resolveCapabilities(input);
      expect(caps.has('action_required')).toBe(true);
      expect(caps.has('insurance_claims')).toBe(false);
    });

    it('does NOT get pending_inspections (department gate)', () => {
      const caps = resolveCapabilities(input);
      expect(caps.has('pending_inspections')).toBe(false);
    });
  });

  // ── Case 5 ──────────────────────────────────────────────────────────────
  describe('admin and super_admin get a superset of manager', () => {
    const managerCaps = resolveCapabilities({
      role: 'manager',
      department: 'inspector_canvasser',
      workflow: 'insurance_retail',
    });

    for (const role of ['admin', 'super_admin'] as const) {
      it(`${role} is a superset of manager (same dept+workflow)`, () => {
        const caps = resolveCapabilities({
          role,
          department: 'inspector_canvasser',
          workflow: 'insurance_retail',
        });
        for (const k of managerCaps) {
          expect(caps.has(k), `${role} should have ${k} that manager has`).toBe(true);
        }
      });
    }
  });

  // ── Case 6 ──────────────────────────────────────────────────────────────
  describe('returned array preserves WIDGET_CATALOG order', () => {
    const inputs = [
      { role: 'field_rep',   department: 'canvasser',            workflow: 'retail'          } as const,
      { role: 'field_rep',   department: 'inspector_canvasser',  workflow: 'insurance_retail'} as const,
      { role: 'manager',     department: 'office',               workflow: 'insurance_retail'} as const,
      { role: 'manager',     department: 'canvasser',            workflow: 'retail'          } as const,
      { role: 'admin',       department: 'inspector_canvasser',  workflow: 'insurance_retail'} as const,
      { role: 'super_admin', department: 'inspector_canvasser',  workflow: 'insurance_retail'} as const,
    ];

    for (const input of inputs) {
      it(`${input.role} + ${input.department} + ${input.workflow}`, () => {
        const result = keys(input);
        const expectedOrder = CATALOG_ORDER.filter(k => result.includes(k));
        expect(result).toEqual(expectedOrder);
      });
    }
  });
});
