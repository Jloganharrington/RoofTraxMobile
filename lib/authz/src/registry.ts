/**
 * lib/authz/src/registry.ts
 *
 * Single source of truth for every permission in the system.
 *
 * ─── Resolution kinds ────────────────────────────────────────────────────────
 *
 *  minRole      — actor's role must be ≥ minRole (same-company, no resource needed)
 *  ownerOrRole  — actor owns the resource OR actor's role ≥ minRole.
 *                 "owns" = actorId equals the resource's ownerUserId field.
 *                 The "Rep is Owner and Manager+" shape.
 *  selfOnly     — actor must be acting on their own user record (no role gate)
 *  floor        — system-internal; can never be granted or revoked by any actor
 *  department   — actor's department must be in the listed set (any role)
 *  workflow     — actor's workflow must be in the listed set (any role)
 *
 * ─── Domains (25) ────────────────────────────────────────────────────────────
 *  lead • inspection • report • claim • contract • change_order •
 *  payment • expense • commission • overhead • profitability •
 *  coc • catalog • team • company •
 *  invoice • profile • notification • canvassing • activity •
 *  calendar • geocode • crm • weather • dashboard
 */

import type { Department, Role, WorkflowAssignment } from './vocabulary';

// ── Domain ───────────────────────────────────────────────────────────────────

export const DOMAINS = [
  'lead',
  'inspection',
  'report',
  'claim',
  'contract',
  'change_order',
  'payment',
  'expense',
  'commission',
  'overhead',
  'profitability',
  'coc',
  'catalog',
  'team',
  'company',
  // ── UI + utility domains ─────────────────────────────────────────────────
  'invoice',
  'profile',
  'notification',
  'canvassing',
  'activity',
  'calendar',
  'geocode',
  'crm',
  'weather',
  'dashboard',
] as const;

export type Domain = (typeof DOMAINS)[number];

// ── Permission keys ──────────────────────────────────────────────────────────
// Exactly 113 keys. Keep sorted within each domain block.

export const PERMISSION_KEYS = [
  // lead (8)
  'lead.advance_stage',
  'lead.assign',
  'lead.bulk_create',
  'lead.create',
  'lead.delete',
  'lead.read',
  'lead.set_appointment',
  'lead.update',

  // inspection (6)
  'inspection.assign',
  'inspection.create',
  'inspection.delete',
  'inspection.read',
  'inspection.update',
  'inspection.delete_agreement',
  'inspection.upload_photo',

  // report (10)
  'report.attest',
  'report.compile',
  'report.deliver',
  'report.read',
  'report.settings_edit',
  'report.settings_view',
  'report.supplement_attest',
  'report.supplement_compile',
  'report.supplement_create',
  'report.supplement_deliver',

  // claim (13)
  'claim.attest',
  'claim.compile',
  'claim.create',
  'claim.deliver',
  'claim.read',
  'claim.section_approve',
  'claim.section_generate',
  'claim.section_lock',
  'claim.status_update',
  'claim.supplement_attest',
  'claim.supplement_compile',
  'claim.supplement_create',
  'claim.supplement_deliver',

  // contract (6)
  'contract.create',
  'contract.generate_document',
  'contract.read',
  'contract.select',
  'contract.sign',
  'contract.void',

  // change_order (7)
  'change_order.approve',
  'change_order.create',
  'change_order.delete',
  'change_order.read',
  'change_order.sign',
  'change_order.update',
  'change_order.void',

  // payment (4)
  'payment.create',
  'payment.delete',
  'payment.update',
  'payment.view',

  // expense (5)
  'expense.create',
  'expense.delete',
  'expense.manage',
  'expense.update',
  'expense.view',

  // commission (2)
  'commission.manage',
  'commission.view',

  // overhead (3)
  'overhead.manage',
  'overhead.update',
  'overhead.view',

  // profitability (3)
  'profitability.bulk_export',
  'profitability.export_csv',
  'profitability.view',

  // coc (5)
  'coc.create',
  'coc.deliver',
  'coc.read',
  'coc.sign',
  'coc.void',

  // catalog (8)
  'catalog.ahj_add',
  'catalog.ahj_delete',
  'catalog.ahj_edit',
  'catalog.ahj_wizard',
  'catalog.price_book_add',
  'catalog.price_book_delete',
  'catalog.price_book_edit',
  'catalog.price_book_view',
  'catalog.selections_manage',

  // team (7)
  'team.assign_manager',
  'team.delete',
  'team.edit',
  'team.invite',
  'team.override_permissions',
  'team.view',
  'team.view_stats',

  // company (7)
  'company.edit_ai_settings',
  'company.edit_fipsa_settings',
  'company.edit_lead_sources',
  'company.edit_logo',
  'company.edit_report_colors',
  'company.edit_settings',
  'company.view_settings',
  // invoice (6)
  'invoice.create',
  'invoice.delete',
  'invoice.read',
  'invoice.send',
  'invoice.update',
  'invoice.void',

  // profile (2)
  'profile.read',
  'profile.update',

  // notification (2)
  'notification.manage',
  'notification.push_receipts',

  // canvassing (1)
  'canvassing.use',

  // activity (1)
  'activity.view',

  // calendar (1)
  'calendar.view',

  // geocode (1)
  'geocode.use',

  // crm (1)
  'crm.view',

  // weather (1)
  'weather.view',

  // dashboard (2)
  'dashboard.manage_layout',
  'dashboard.view',
] as const;

export type Permission = (typeof PERMISSION_KEYS)[number];

// ── Resolution shape ─────────────────────────────────────────────────────────

export type DefaultResolution =
  /** Actor's role ≥ minRole. No resource required. */
  | { readonly kind: 'minRole'; readonly minRole: Role }
  /**
   * Actor is the resource owner (actorId === resource.ownerUserId)
   * OR actor's role ≥ minRole.
   * Passing the resource is required when using can() for these permissions.
   */
  | { readonly kind: 'ownerOrRole'; readonly minRole: Role }
  /** Actor is acting on their own user record — no role gate. */
  | { readonly kind: 'selfOnly' }
  /** System-internal — can never be granted or revoked at any level. */
  | { readonly kind: 'floor' }
  /** Actor's department must be in the set; any role. */
  | { readonly kind: 'department'; readonly departments: readonly Department[] }
  /** Actor's workflow must be in the set; any role. */
  | { readonly kind: 'workflow'; readonly workflows: readonly WorkflowAssignment[] };

// ── Entry shape ──────────────────────────────────────────────────────────────

export interface PermissionEntry {
  readonly key: Permission;
  readonly domain: Domain;
  readonly label: string;
  readonly default: DefaultResolution;
  /**
   * Optional human note surfaced in the settings UI (e.g. to explain
   * a composite rule that the resolution kind alone doesn't capture).
   */
  readonly note?: string;
}

// ── Registry ─────────────────────────────────────────────────────────────────
// 94 entries. Grouped by domain; sorted alphabetically within each group.

export const PERMISSION_REGISTRY: readonly PermissionEntry[] = [

  // ── lead (8) ──────────────────────────────────────────────────────────────
  {
    key:    'lead.advance_stage',
    domain: 'lead',
    label:  'Advance pipeline stage',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
  },
  {
    key:    'lead.assign',
    domain: 'lead',
    label:  'Assign lead to a rep',
    default: { kind: 'minRole', minRole: 'manager' },
    note:   'Not yet wired to a route; placeholder for the POST /leads/:id/assign endpoint.',
  },
  {
    key:    'lead.bulk_create',
    domain: 'lead',
    label:  'Bulk-import leads',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'lead.create',
    domain: 'lead',
    label:  'Create a new lead',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'lead.delete',
    domain: 'lead',
    label:  'Delete a lead permanently',
    default: { kind: 'minRole', minRole: 'manager' },
  },
  {
    key:    'lead.read',
    domain: 'lead',
    label:  'View lead details',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'lead.set_appointment',
    domain: 'lead',
    label:  'Set or change appointment date',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
  },
  {
    key:    'lead.update',
    domain: 'lead',
    label:  'Edit lead fields',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
  },

  // ── inspection (6) ────────────────────────────────────────────────────────
  {
    key:    'inspection.assign',
    domain: 'inspection',
    label:  'Assign an inspection to an inspector',
    default: { kind: 'minRole', minRole: 'manager' },
  },
  {
    key:    'inspection.create',
    domain: 'inspection',
    label:  'Start a new inspection',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'inspection.delete',
    domain: 'inspection',
    label:  'Delete an inspection permanently',
    default: { kind: 'minRole', minRole: 'admin' },
    note:   'Tightened from manager+ to admin+ (pen-test FINDING). ' +
            'Mobile only surfaces this action to super_admin (inspections.tsx:307), ' +
            'so no mobile breakage.',
  },
  {
    key:    'inspection.read',
    domain: 'inspection',
    label:  'View inspection details and photos',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'inspection.update',
    domain: 'inspection',
    label:  'Edit inspection data',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
  },
  {
    key:    'inspection.delete_agreement',
    domain: 'inspection',
    label:  'Delete an inspection agreement permanently (admin erase)',
    default: { kind: 'minRole', minRole: 'super_admin' },
  },
  {
    key:    'inspection.upload_photo',
    domain: 'inspection',
    label:  'Upload photos to an inspection',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
  },

  // ── report (10) ───────────────────────────────────────────────────────────
  {
    key:    'report.attest',
    domain: 'report',
    label:  'Attest / sign off on a proof package version',
    default: { kind: 'minRole', minRole: 'manager' },
  },
  {
    key:    'report.compile',
    domain: 'report',
    label:  'Run AI compilation for a proof package',
    default: { kind: 'minRole', minRole: 'manager' },
  },
  {
    key:    'report.deliver',
    domain: 'report',
    label:  'Mark proof package as delivered to homeowner',
    default: { kind: 'minRole', minRole: 'manager' },
  },
  {
    key:    'report.read',
    domain: 'report',
    label:  'View a compiled proof package',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'report.settings_edit',
    domain: 'report',
    label:  'Edit BP-library entries and agent prompts',
    default: { kind: 'minRole', minRole: 'super_admin' },
  },
  {
    key:    'report.settings_view',
    domain: 'report',
    label:  'View BP-library and agent prompt settings',
    default: { kind: 'minRole', minRole: 'super_admin' },
  },
  {
    key:    'report.supplement_attest',
    domain: 'report',
    label:  'Attest a supplement version',
    default: { kind: 'minRole', minRole: 'manager' },
  },
  {
    key:    'report.supplement_compile',
    domain: 'report',
    label:  'Compile a supplement proof package',
    default: { kind: 'minRole', minRole: 'manager' },
  },
  {
    key:    'report.supplement_create',
    domain: 'report',
    label:  'Start a supplement to an attested package',
    default: { kind: 'minRole', minRole: 'manager' },
  },
  {
    key:    'report.supplement_deliver',
    domain: 'report',
    label:  'Deliver a supplement to homeowner',
    default: { kind: 'minRole', minRole: 'manager' },
  },

  // ── claim (13) ────────────────────────────────────────────────────────────
  {
    key:    'claim.attest',
    domain: 'claim',
    label:  'Attest the compiled claim',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'claim.compile',
    domain: 'claim',
    label:  'Compile the claim package',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'claim.create',
    domain: 'claim',
    label:  'Open a claim on a lead',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'claim.deliver',
    domain: 'claim',
    label:  'Mark the claim as delivered',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'claim.read',
    domain: 'claim',
    label:  'View claim sections and status',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'claim.section_approve',
    domain: 'claim',
    label:  'Approve a generated claim section',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'claim.section_generate',
    domain: 'claim',
    label:  'Run AI generation for a claim section',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'claim.section_lock',
    domain: 'claim',
    label:  'Lock an approved claim section',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'claim.status_update',
    domain: 'claim',
    label:  'Update claim status (new loss, approved, denied, etc.)',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'claim.supplement_attest',
    domain: 'claim',
    label:  'Attest a claim supplement',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'claim.supplement_compile',
    domain: 'claim',
    label:  'Compile a claim supplement package',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'claim.supplement_create',
    domain: 'claim',
    label:  'Start a supplement on a delivered claim',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'claim.supplement_deliver',
    domain: 'claim',
    label:  'Deliver a claim supplement',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },

  // ── contract (6) ──────────────────────────────────────────────────────────
  {
    key:    'contract.create',
    domain: 'contract',
    label:  'Create a contract for a lead',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'contract.generate_document',
    domain: 'contract',
    label:  'Generate the contract PDF',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'contract.read',
    domain: 'contract',
    label:  'View a contract and its document',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'contract.select',
    domain: 'contract',
    label:  'Select a price-book package for a contract',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'contract.sign',
    domain: 'contract',
    label:  'Submit contract to homeowner portal for signing',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'contract.void',
    domain: 'contract',
    label:  'Void an existing contract',
    default: { kind: 'minRole', minRole: 'manager' },
  },

  // ── change_order (7) ──────────────────────────────────────────────────────
  {
    key:    'change_order.approve',
    domain: 'change_order',
    label:  'Approve a signed change order',
    default: { kind: 'minRole', minRole: 'manager' },
  },
  {
    key:    'change_order.create',
    domain: 'change_order',
    label:  'Create a change order on a lead',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'change_order.delete',
    domain: 'change_order',
    label:  'Delete an unsigned change order',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'change_order.read',
    domain: 'change_order',
    label:  'View change order details and line items',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'change_order.sign',
    domain: 'change_order',
    label:  'Submit a change order for homeowner signature',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'change_order.update',
    domain: 'change_order',
    label:  'Edit a change order and its line items',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'change_order.void',
    domain: 'change_order',
    label:  'Void a change order',
    default: { kind: 'minRole', minRole: 'manager' },
  },

  // ── payment (4) ───────────────────────────────────────────────────────────
  {
    key:    'payment.create',
    domain: 'payment',
    label:  'Record a payment',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
  },
  {
    key:    'payment.delete',
    domain: 'payment',
    label:  'Delete a payment record',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
  },
  {
    key:    'payment.update',
    domain: 'payment',
    label:  'Edit a recorded payment',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
  },
  {
    key:    'payment.view',
    domain: 'payment',
    label:  'View payment records for a lead',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
  },

  // ── expense (5) ───────────────────────────────────────────────────────────
  {
    key:    'expense.create',
    domain: 'expense',
    label:  'Record a vendor expense',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
  },
  {
    key:    'expense.delete',
    domain: 'expense',
    label:  'Delete a vendor expense record',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
  },
  {
    key:    'expense.manage',
    domain: 'expense',
    label:  'Mark expenses as paid; admin-level expense management',
    default: { kind: 'minRole', minRole: 'manager' },
    note:   'Exception from the Section 8 ownerOrRole default — kept at manager+.',
  },
  {
    key:    'expense.update',
    domain: 'expense',
    label:  'Edit a vendor expense',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
  },
  {
    key:    'expense.view',
    domain: 'expense',
    label:  'View vendor expenses for a lead',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
  },

  // ── commission (2) ────────────────────────────────────────────────────────
  {
    key:    'commission.manage',
    domain: 'commission',
    label:  'Update commission amounts; mark commissions paid',
    default: { kind: 'minRole', minRole: 'manager' },
    note:   'Exception from the Section 8 ownerOrRole default — kept at manager+.',
  },
  {
    key:    'commission.view',
    domain: 'commission',
    label:  'View commission totals and breakdown',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
  },

  // ── overhead (3) ──────────────────────────────────────────────────────────
  {
    key:    'overhead.manage',
    domain: 'overhead',
    label:  'Mark overhead line items as paid',
    default: { kind: 'minRole', minRole: 'manager' },
    note:   'Exception from the Section 8 ownerOrRole default — kept at manager+.',
  },
  {
    key:    'overhead.update',
    domain: 'overhead',
    label:  'Update overhead amounts for a lead',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
  },
  {
    key:    'overhead.view',
    domain: 'overhead',
    label:  'View overhead line items for a lead',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
  },

  // ── profitability (3) ─────────────────────────────────────────────────────
  {
    key:    'profitability.bulk_export',
    domain: 'profitability',
    label:  'Bulk-export profitability data across all leads',
    default: { kind: 'minRole', minRole: 'admin' },
  },
  {
    key:    'profitability.export_csv',
    domain: 'profitability',
    label:  'Export profitability data for a single lead to CSV',
    default: { kind: 'minRole', minRole: 'manager' },
  },
  {
    key:    'profitability.view',
    domain: 'profitability',
    label:  'View profit margin, cost, and payment summary',
    default: { kind: 'minRole', minRole: 'manager' },
  },

  // ── coc (5) ───────────────────────────────────────────────────────────────
  {
    key:    'coc.create',
    domain: 'coc',
    label:  'Start a completion certificate for a project',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
  },
  {
    key:    'coc.deliver',
    domain: 'coc',
    label:  'Mark a completion certificate as delivered',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
  },
  {
    key:    'coc.read',
    domain: 'coc',
    label:  'View a completion certificate',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
  },
  {
    key:    'coc.sign',
    domain: 'coc',
    label:  'Sign a completion certificate',
    default: { kind: 'ownerOrRole', minRole: 'manager' },
    note:   'Also granted to field_reps in the "office" department regardless of ' +
            'ownership, matching canSignCompletionCertificate(). The resolver ' +
            'implements this department shortcut explicitly.',
  },
  {
    key:    'coc.void',
    domain: 'coc',
    label:  'Void a completion certificate',
    default: { kind: 'minRole', minRole: 'manager' },
  },

  // ── catalog (8) ───────────────────────────────────────────────────────────
  {
    key:    'catalog.ahj_add',
    domain: 'catalog',
    label:  'Add a new AHJ material requirement entry',
    default: { kind: 'minRole', minRole: 'field_rep' },
    note:   'Any authenticated member — rep+ — may contribute AHJ data.',
  },
  {
    key:    'catalog.ahj_delete',
    domain: 'catalog',
    label:  'Delete an AHJ entry from the catalog',
    default: { kind: 'minRole', minRole: 'admin' },
  },
  {
    key:    'catalog.ahj_edit',
    domain: 'catalog',
    label:  'Edit an existing AHJ catalog entry',
    default: { kind: 'minRole', minRole: 'field_rep' },
    note:   'Any authenticated member — rep+ — may correct AHJ data.',
  },
  {
    key:    'catalog.ahj_wizard',
    domain: 'catalog',
    label:  'Manage AHJ wizard sources, runs, items, and pack assembly',
    default: { kind: 'minRole', minRole: 'super_admin' },
    note:   'All 10 AHJ wizard admin endpoints — source ingest, extraction runs, item verification, and pack assembly. Separate from catalog.ahj_add/edit which cover the field-rep submission surface.',
  },
  {
    key:    'catalog.price_book_add',
    domain: 'catalog',
    label:  'Add price book items or packages',
    default: { kind: 'minRole', minRole: 'admin' },
  },
  {
    key:    'catalog.price_book_delete',
    domain: 'catalog',
    label:  'Delete price book items or packages',
    default: { kind: 'minRole', minRole: 'admin' },
  },
  {
    key:    'catalog.price_book_edit',
    domain: 'catalog',
    label:  'Edit price book items or packages',
    default: { kind: 'minRole', minRole: 'admin' },
  },
  {
    key:    'catalog.price_book_view',
    domain: 'catalog',
    label:  'View price book items and packages',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'catalog.selections_manage',
    domain: 'catalog',
    label:  'Manage material selection categories, brands, products, and options',
    default: { kind: 'minRole', minRole: 'admin' },
  },

  // ── team (7) ──────────────────────────────────────────────────────────────
  {
    key:    'team.assign_manager',
    domain: 'team',
    label:  'Set a team member\'s reporting manager',
    default: { kind: 'minRole', minRole: 'admin' },
    note:   'Used in Step 4 reporting-tree enforcement.',
  },
  {
    key:    'team.delete',
    domain: 'team',
    label:  'Remove a team member from the company',
    default: { kind: 'minRole', minRole: 'manager' },
    note:   'Rank enforcement (actorOutranks) applied in addition to role gate.',
  },
  {
    key:    'team.edit',
    domain: 'team',
    label:  "Edit a team member's role, department, or workflow assignment",
    default: { kind: 'minRole', minRole: 'manager' },
    note:   'Rank enforcement (actorOutranks) applied in addition to role gate.',
  },
  {
    key:    'team.invite',
    domain: 'team',
    label:  'Invite a new team member to the company',
    default: { kind: 'minRole', minRole: 'manager' },
    note:   'Route not yet implemented; placeholder for the onboarding flow.',
  },
  {
    key:    'team.override_permissions',
    domain: 'team',
    label:  'Grant or revoke per-user permission overrides',
    default: { kind: 'minRole', minRole: 'admin' },
    note:   'Used in Step 5 override system — cannot grant what you do not hold.',
  },
  {
    key:    'team.view',
    domain: 'team',
    label:  'View team roster and user profiles',
    default: { kind: 'minRole', minRole: 'manager' },
  },
  {
    key:    'team.view_stats',
    domain: 'team',
    label:  'View org-level statistics (admin stats endpoint)',
    default: { kind: 'minRole', minRole: 'admin' },
  },

  // ── company (7) ───────────────────────────────────────────────────────────
  {
    key:    'company.edit_ai_settings',
    domain: 'company',
    label:  'Configure AI model and prompt settings',
    default: { kind: 'minRole', minRole: 'admin' },
  },
  {
    key:    'company.edit_fipsa_settings',
    domain: 'company',
    label:  'Configure FIPSA reporting settings',
    default: { kind: 'minRole', minRole: 'admin' },
  },
  {
    key:    'company.edit_lead_sources',
    domain: 'company',
    label:  'Manage the list of valid lead sources',
    default: { kind: 'minRole', minRole: 'manager' },
  },
  {
    key:    'company.edit_logo',
    domain: 'company',
    label:  'Upload or replace the company logo',
    default: { kind: 'minRole', minRole: 'admin' },
  },
  {
    key:    'company.edit_report_colors',
    domain: 'company',
    label:  'Configure the report color scheme',
    default: { kind: 'minRole', minRole: 'super_admin' },
  },
  {
    key:    'company.edit_settings',
    domain: 'company',
    label:  'Edit company name, address, and general settings',
    default: { kind: 'minRole', minRole: 'admin' },
  },
  {
    key:    'company.view_settings',
    domain: 'company',
    label:  'View company profile and basic settings',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },

  // ── invoice (6) ──────────────────────────────────────────────────────────────
  {
    key:    'invoice.read',
    domain: 'invoice',
    label:  'View invoices for a lead',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'invoice.create',
    domain: 'invoice',
    label:  'Create an invoice on a lead',
    default: { kind: 'minRole', minRole: 'manager' },
  },
  {
    key:    'invoice.update',
    domain: 'invoice',
    label:  'Edit an invoice',
    default: { kind: 'minRole', minRole: 'manager' },
  },
  {
    key:    'invoice.delete',
    domain: 'invoice',
    label:  'Delete an invoice',
    default: { kind: 'minRole', minRole: 'manager' },
  },
  {
    key:    'invoice.send',
    domain: 'invoice',
    label:  'Send an invoice email to the homeowner',
    default: { kind: 'minRole', minRole: 'manager' },
  },
  {
    key:    'invoice.void',
    domain: 'invoice',
    label:  'Void an invoice',
    default: { kind: 'minRole', minRole: 'manager' },
  },

  // ── profile (2) ──────────────────────────────────────────────────────────────
  {
    key:    'profile.read',
    domain: 'profile',
    label:  'View own user profile',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'profile.update',
    domain: 'profile',
    label:  'Edit own profile, signature, credentials, and SMTP settings',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },

  // ── notification (2) ─────────────────────────────────────────────────────────
  {
    key:    'notification.manage',
    domain: 'notification',
    label:  'Manage own notification preferences and push tokens',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'notification.push_receipts',
    domain: 'notification',
    label:  'Process push notification receipts (admin action)',
    default: { kind: 'minRole', minRole: 'manager' },
  },

  // ── canvassing (1) ───────────────────────────────────────────────────────────
  {
    key:    'canvassing.use',
    domain: 'canvassing',
    label:  'Clock in/out and view canvassing status',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },

  // ── activity (1) ─────────────────────────────────────────────────────────────
  {
    key:    'activity.view',
    domain: 'activity',
    label:  'View activity stats (own or team for managers)',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },

  // ── calendar (1) ─────────────────────────────────────────────────────────────
  {
    key:    'calendar.view',
    domain: 'calendar',
    label:  'View calendar events (own or team for managers)',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },

  // ── geocode (1) ──────────────────────────────────────────────────────────────
  {
    key:    'geocode.use',
    domain: 'geocode',
    label:  'Use geocoding (reverse and forward search)',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },

  // ── crm (1) ──────────────────────────────────────────────────────────────────
  {
    key:    'crm.view',
    domain: 'crm',
    label:  'View CRM status (requires inspection module access inline)',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },

  // ── weather (1) ──────────────────────────────────────────────────────────────
  {
    key:    'weather.view',
    domain: 'weather',
    label:  'View weather events (requires inspection module access inline)',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },

  // ── dashboard (2) ────────────────────────────────────────────────────────────
  {
    key:    'dashboard.view',
    domain: 'dashboard',
    label:  'View dashboard manifest and layout',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
  {
    key:    'dashboard.manage_layout',
    domain: 'dashboard',
    label:  'Edit or reset own dashboard layout',
    default: { kind: 'minRole', minRole: 'field_rep' },
  },
] as const satisfies readonly PermissionEntry[];

// ── Lookup helpers ────────────────────────────────────────────────────────────

/** O(1) lookup by key. */
export const PERMISSION_MAP: Readonly<Record<Permission, PermissionEntry>> =
  Object.fromEntries(
    PERMISSION_REGISTRY.map(e => [e.key, e]),
  ) as Readonly<Record<Permission, PermissionEntry>>;

/** All permissions belonging to a domain, in registry order. */
export function permissionsForDomain(domain: Domain): readonly PermissionEntry[] {
  return PERMISSION_REGISTRY.filter(e => e.domain === domain);
}

// ── Compile-time count assertion ──────────────────────────────────────────────
// This will produce a TS error if the registry diverges from 113.

type AssertExactly114 = (typeof PERMISSION_KEYS)['length'] extends 114 ? true : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _assert114: AssertExactly114 = true;
