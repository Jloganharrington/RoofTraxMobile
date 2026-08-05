import type { Department, Role, WorkflowAssignment } from './vocabulary';
import { roleRank } from './permissions';

// ── Types ────────────────────────────────────────────────────────────────────

export type WidgetSize = 'sm' | 'md' | 'lg';

export interface WidgetEntry {
  readonly key: string;
  readonly title: string;
  readonly size: WidgetSize;
  readonly minRole?: Role;
  readonly requiresDepartment?: readonly Department[];
  readonly requiresWorkflow?: readonly WorkflowAssignment[];
}

// Capability is the union of all 12 widget keys, derived from the catalog
// definition below. Keep this list in sync with WIDGET_CATALOG.
const WIDGET_KEYS = [
  'my_day',
  'my_activity',
  'recent_activity',
  'pending_inspections',
  'claim_blockers',
  'action_required',
  'sales_funnel',
  'insurance_claims',
  'canvassing_heatmap',
  'knock_to_lead',
  'production_pipeline',
  'live_team',
] as const;

export type Capability = (typeof WIDGET_KEYS)[number];

// ── Catalog ──────────────────────────────────────────────────────────────────
// Exactly 12 entries in spec order. Do NOT add revenue / commission / quota /
// A-R aging / crew widgets — those tables do not exist in this schema.

export const WIDGET_CATALOG: readonly WidgetEntry[] = [
  { key: 'my_day',              title: 'My Day',              size: 'md' },
  { key: 'my_activity',         title: 'My Activity',         size: 'md' },
  { key: 'recent_activity',     title: 'Recent Activity',     size: 'md' },
  {
    key: 'pending_inspections',
    title: 'Pending Inspections',
    size: 'md',
    requiresDepartment: ['inspector_canvasser', 'office'],
  },
  {
    key: 'claim_blockers',
    title: 'Claim Blockers',
    size: 'md',
    requiresWorkflow: ['insurance_retail'],
  },
  { key: 'action_required',     title: 'Action Required',     size: 'lg', minRole: 'manager' },
  { key: 'sales_funnel',        title: 'Sales Funnel',        size: 'lg', minRole: 'manager' },
  {
    key: 'insurance_claims',
    title: 'Insurance Claims',
    size: 'lg',
    minRole: 'manager',
    requiresWorkflow: ['insurance_retail'],
  },
  { key: 'canvassing_heatmap',  title: 'Canvassing Heatmap',  size: 'lg', minRole: 'manager' },
  { key: 'knock_to_lead',       title: 'Knock to Lead',       size: 'md', minRole: 'manager' },
  { key: 'production_pipeline', title: 'Production Pipeline', size: 'lg', minRole: 'manager' },
  { key: 'live_team',           title: 'Live Team',           size: 'md', minRole: 'manager' },
];

// ── Resolver ─────────────────────────────────────────────────────────────────

export interface CapabilityInput {
  role: Role;
  department: Department;
  workflow: WorkflowAssignment;
}

/**
 * Pure function — no I/O, no async.
 * Returns the set of widget keys this user is permitted to see.
 */
export function resolveCapabilities(input: CapabilityInput): Set<Capability> {
  const caps = new Set<Capability>();
  for (const widget of WIDGET_CATALOG) {
    if (
      widget.minRole !== undefined &&
      roleRank(input.role) < roleRank(widget.minRole)
    ) {
      continue;
    }
    if (
      widget.requiresDepartment !== undefined &&
      !widget.requiresDepartment.includes(input.department)
    ) {
      continue;
    }
    if (
      widget.requiresWorkflow !== undefined &&
      !widget.requiresWorkflow.includes(input.workflow)
    ) {
      continue;
    }
    caps.add(widget.key as Capability);
  }
  return caps;
}

/**
 * Returns the subset of WIDGET_CATALOG entries visible to this user,
 * preserving catalog order.
 */
export function selectWidgetsFor(input: CapabilityInput): readonly WidgetEntry[] {
  const caps = resolveCapabilities(input);
  return WIDGET_CATALOG.filter(w => caps.has(w.key as Capability));
}
