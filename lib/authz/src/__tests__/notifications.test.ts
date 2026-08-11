/**
 * Notification catalog — unit tests.
 *
 * Verifies:
 *   - all 20 types are present in catalog order
 *   - catalogForRole('field_rep') returns the 10 eligible types
 *   - catalogForRole('manager')   returns all 20
 *   - manager-only types are absent from the field_rep list
 *   - findNotificationEntry works for known and unknown keys
 *   - supportsDigest=false for MY_WORK and ATTENTION groups
 *   - every entry has required fields present and non-empty
 */

import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_CATALOG,
  catalogForRole,
  findNotificationEntry,
} from '../notifications';

const MANAGER_ONLY_TYPES = [
  'payment_recorded',
  'contract_voided',
  'change_order_pending_approval',
  'fipsa_voided',
  'item_overdue',
  'claim_blocked',
  'lead_needs_stage_review',
  // Staff lifecycle — deactivation sweep notifications (manager+ only)
  'staff_deactivated',
  'staff_inventory_reminder',
  'staff_escalation_reminder',
];

const FIELD_REP_ELIGIBLE_TYPES = [
  'contract_signed',
  'change_order_signed',
  'change_order_approved',
  'fipsa_signed',
  'claim_status_changed',
  'proof_package_delivered',
  'inspection_assigned',
  'inspection_scheduled',
  'appointment_assigned',
  'completion_certificate_signed',
];

describe('NOTIFICATION_CATALOG', () => {
  it('contains exactly 20 entries', () => {
    expect(NOTIFICATION_CATALOG).toHaveLength(20);
  });

  it('covers the four expected groups', () => {
    const groups = new Set(NOTIFICATION_CATALOG.map(e => e.group));
    expect(groups).toEqual(new Set(['money', 'claims', 'my_work', 'attention']));
  });

  it('every entry has non-empty type, label, group, recipientRule', () => {
    for (const entry of NOTIFICATION_CATALOG) {
      expect(entry.type,    `type missing on ${entry.label}`).toBeTruthy();
      expect(entry.label,   `label missing on ${entry.type}`).toBeTruthy();
      expect(entry.group,   `group missing on ${entry.type}`).toBeTruthy();
      expect(entry.recipientRule, `recipientRule missing on ${entry.type}`).toBeTruthy();
    }
  });

  it('MY_WORK entries do not support digest (personal/actionable)', () => {
    const myWork = NOTIFICATION_CATALOG.filter(e => e.group === 'my_work');
    expect(myWork.length).toBeGreaterThan(0);
    for (const entry of myWork) {
      expect(entry.supportsDigest, `${entry.type} should not support digest`).toBe(false);
    }
  });

  it('ATTENTION entries do not support digest (time-sensitive)', () => {
    const attention = NOTIFICATION_CATALOG.filter(e => e.group === 'attention');
    expect(attention.length).toBeGreaterThan(0);
    for (const entry of attention) {
      expect(entry.supportsDigest, `${entry.type} should not support digest`).toBe(false);
    }
  });
});

describe('catalogForRole', () => {
  it('field_rep — returns exactly 10 types', () => {
    const result = catalogForRole('field_rep');
    expect(result).toHaveLength(10);
  });

  it('field_rep — contains all expected assignee / lead_owner types', () => {
    const types = new Set(catalogForRole('field_rep').map(e => e.type));
    for (const t of FIELD_REP_ELIGIBLE_TYPES) {
      expect(types.has(t), `field_rep should see ${t}`).toBe(true);
    }
  });

  it('field_rep — does NOT contain manager-only types', () => {
    const types = new Set(catalogForRole('field_rep').map(e => e.type));
    for (const t of MANAGER_ONLY_TYPES) {
      expect(types.has(t), `field_rep should NOT see ${t}`).toBe(false);
    }
  });

  it('manager — returns all 20 types', () => {
    expect(catalogForRole('manager')).toHaveLength(20);
  });

  it('admin — returns all 20 types', () => {
    expect(catalogForRole('admin')).toHaveLength(20);
  });

  it('super_admin — returns all 20 types', () => {
    expect(catalogForRole('super_admin')).toHaveLength(20);
  });

  it('manager result includes all field_rep-eligible types', () => {
    const mgr   = new Set(catalogForRole('manager').map(e => e.type));
    const frep  = catalogForRole('field_rep').map(e => e.type);
    for (const t of frep) {
      expect(mgr.has(t), `manager should also see ${t}`).toBe(true);
    }
  });
});

describe('findNotificationEntry', () => {
  it('returns the entry for a known type', () => {
    const entry = findNotificationEntry('payment_recorded');
    expect(entry).toBeDefined();
    expect(entry!.label).toBe('Payment Received');
    expect(entry!.minRole).toBe('manager');
    expect(entry!.group).toBe('money');
  });

  it('returns undefined for an unknown type', () => {
    expect(findNotificationEntry('not_a_real_type')).toBeUndefined();
  });

  it('returns the inspection_assigned entry correctly', () => {
    const entry = findNotificationEntry('inspection_assigned');
    expect(entry).toBeDefined();
    expect(entry!.minRole).toBe('field_rep');
    expect(entry!.recipientRule).toBe('assignee');
    expect(entry!.defaultPush).toBe(true);
    expect(entry!.supportsDigest).toBe(false);
  });
});
