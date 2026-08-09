/**
 * Notification catalog — capability-shaped, zero runtime deps.
 *
 * Lives alongside the widget catalog in lib/authz because both are gated by
 * role and both feed server-side filtering logic. The same shape rules apply:
 * no implementation code, no DB imports, no express imports.
 *
 * minRole — who may receive (and configure) a given type at all.
 *   field_rep  recipient rules that include 'assignee' or 'lead_owner'
 *   manager    recipient rules that are 'managers'-only
 *
 * supportsDigest — whether daily/weekly frequency will ever be honoured.
 *   v1 implements only 'immediate' and 'off'. Store all four values in the DB
 *   so no migration is needed when digests are wired. The Settings UI must
 *   show daily/weekly as visibly unavailable (not missing, not selectable).
 *   Push is always immediate-or-off; frequency applies to email only.
 *
 * Recipient rules (resolved server-side in the dispatch layer, Step 3):
 *   assignee                 inspections.inspector_user_id / pins.appointment_assigned_to
 *   lead_owner               pins.user_id
 *   managers                 every manager+ in the company
 *   lead_owner_and_managers  union, deduplicated
 *
 * NEVER notify the actor about their own action.
 */

import type { Role } from './vocabulary';

export type NotificationGroup  = 'money' | 'claims' | 'my_work' | 'attention';
export type RecipientRule      = 'assignee' | 'lead_owner' | 'managers' | 'lead_owner_and_managers';
export type NotificationFrequency = 'immediate' | 'daily' | 'weekly' | 'off';

export const NOTIFICATION_FREQUENCIES: readonly NotificationFrequency[] = [
  'immediate', 'daily', 'weekly', 'off',
];

export interface NotificationEntry {
  readonly type:           string;
  readonly label:          string;
  readonly group:          NotificationGroup;
  readonly minRole:        Role;
  readonly recipientRule:  RecipientRule;
  readonly defaultEmail:   boolean;
  readonly defaultPush:    boolean;
  readonly supportsDigest: boolean;
}

// ── Catalog ──────────────────────────────────────────────────────────────────
// 16 types, 4 groups. Grounded in events this system actually emits.
// Do NOT add types whose trigger sites do not yet exist in the codebase.

export const NOTIFICATION_CATALOG: readonly NotificationEntry[] = [
  // ── MONEY ──────────────────────────────────────────────────────────────────
  {
    type:           'payment_recorded',
    label:          'Payment Received',
    group:          'money',
    minRole:        'manager',
    recipientRule:  'managers',
    defaultEmail:   true,
    defaultPush:    false,
    supportsDigest: true,
  },
  {
    type:           'contract_signed',
    label:          'Contract Signed',
    group:          'money',
    minRole:        'field_rep',
    recipientRule:  'lead_owner_and_managers',
    defaultEmail:   true,
    defaultPush:    true,
    supportsDigest: true,
  },
  {
    type:           'contract_voided',
    label:          'Contract Voided',
    group:          'money',
    minRole:        'manager',
    recipientRule:  'managers',
    defaultEmail:   true,
    defaultPush:    false,
    supportsDigest: true,
  },
  {
    type:           'change_order_signed',
    label:          'Change Order Signed',
    group:          'money',
    minRole:        'field_rep',
    recipientRule:  'lead_owner_and_managers',
    defaultEmail:   true,
    defaultPush:    true,
    supportsDigest: true,
  },
  {
    type:           'change_order_pending_approval',
    label:          'Change Order Pending Approval',
    group:          'money',
    minRole:        'manager',
    recipientRule:  'managers',
    defaultEmail:   true,
    defaultPush:    true,
    supportsDigest: false,  // time-sensitive: do not batch
  },
  {
    type:           'change_order_approved',
    label:          'Change Order Approved',
    group:          'money',
    minRole:        'field_rep',
    recipientRule:  'lead_owner_and_managers',
    defaultEmail:   true,
    defaultPush:    true,
    supportsDigest: true,
  },

  // ── CLAIMS ─────────────────────────────────────────────────────────────────
  {
    type:           'fipsa_signed',
    label:          'Field Inspection Agreement Signed',
    group:          'claims',
    minRole:        'field_rep',
    recipientRule:  'lead_owner_and_managers',
    defaultEmail:   true,
    defaultPush:    false,
    supportsDigest: true,
  },
  {
    type:           'fipsa_voided',
    label:          'Field Inspection Agreement Voided',
    group:          'claims',
    minRole:        'manager',
    recipientRule:  'managers',
    defaultEmail:   true,
    defaultPush:    false,
    supportsDigest: true,
  },
  {
    type:           'claim_status_changed',
    label:          'Claim Status Changed',
    group:          'claims',
    minRole:        'field_rep',
    recipientRule:  'lead_owner_and_managers',
    defaultEmail:   true,
    defaultPush:    false,
    supportsDigest: true,
  },
  {
    type:           'proof_package_delivered',
    label:          'Proof Package Delivered',
    group:          'claims',
    minRole:        'field_rep',
    recipientRule:  'lead_owner_and_managers',
    defaultEmail:   true,
    defaultPush:    true,
    supportsDigest: false,  // delivery is a distinct, high-value moment
  },

  // ── MY WORK ────────────────────────────────────────────────────────────────
  // Personal, actionable — push over email; never a digest candidate.
  {
    type:           'inspection_assigned',
    label:          'Inspection Assigned to You',
    group:          'my_work',
    minRole:        'field_rep',
    recipientRule:  'assignee',
    defaultEmail:   false,
    defaultPush:    true,
    supportsDigest: false,
  },
  {
    type:           'inspection_scheduled',
    label:          'Inspection Scheduled',
    group:          'my_work',
    minRole:        'field_rep',
    recipientRule:  'assignee',
    defaultEmail:   false,
    defaultPush:    true,
    supportsDigest: false,
  },
  {
    type:           'appointment_assigned',
    label:          'Appointment Assigned to You',
    group:          'my_work',
    minRole:        'field_rep',
    recipientRule:  'assignee',
    defaultEmail:   false,
    defaultPush:    true,
    supportsDigest: false,
  },

  // ── ATTENTION ──────────────────────────────────────────────────────────────
  {
    type:           'item_overdue',
    label:          'Item Overdue',
    group:          'attention',
    minRole:        'manager',
    recipientRule:  'managers',
    defaultEmail:   true,
    defaultPush:    false,
    supportsDigest: false,  // overdue items need attention now, not batched
  },
  {
    type:           'claim_blocked',
    label:          'Claim Blocked',
    group:          'attention',
    minRole:        'manager',
    recipientRule:  'managers',
    defaultEmail:   true,
    defaultPush:    false,
    supportsDigest: false,
  },
  {
    type:           'lead_needs_stage_review',
    label:          'Lead Needs Stage Review',
    group:          'attention',
    minRole:        'manager',
    recipientRule:  'managers',
    defaultEmail:   true,
    defaultPush:    false,
    supportsDigest: false,
  },
];

// ── Derived helpers (no runtime deps — pure array ops) ────────────────────────

/** All type keys in catalog order. */
export const NOTIFICATION_TYPES = NOTIFICATION_CATALOG.map(e => e.type) as string[];

/** Look up a catalog entry by type key. O(n) but n ≤ 16. */
export function findNotificationEntry(type: string): NotificationEntry | undefined {
  return NOTIFICATION_CATALOG.find(e => e.type === type);
}

/**
 * Filter the catalog to entries a user with the given role may receive.
 * Server-side only — never return the full catalog to a field_rep.
 */
export function catalogForRole(role: Role): readonly NotificationEntry[] {
  // Role ranking: field_rep < manager < admin < super_admin
  // minRole 'field_rep' → visible to everyone
  // minRole 'manager'   → visible to manager, admin, super_admin only
  const isManager = role === 'manager' || role === 'admin' || role === 'super_admin';
  if (isManager) return NOTIFICATION_CATALOG;
  return NOTIFICATION_CATALOG.filter(e => e.minRole === 'field_rep');
}
