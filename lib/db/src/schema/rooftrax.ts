import { sql } from 'drizzle-orm';
import {
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { companiesTable, usersTable } from './auth';

export const ROLES = ['field_rep', 'manager', 'admin', 'super_admin'] as const;
// Which line(s) of business a user works. `insurance_retail` replaces the
// former separate `insurance` and `both` values — every insurance-capable
// rep can also see retail pins, so there is no longer a pure-insurance mode.
export const WORKFLOW_ASSIGNMENTS = ['retail', 'insurance_retail'] as const;
// Which dashboard/module a user lands in. `canvasser` is the existing
// door-knocking flow; `inspector_canvasser` additionally gets the forensic
// inspection module (content ships in a later phase — this only stores and
// gates the assignment).
export const DEPARTMENTS = ['canvasser', 'inspector_canvasser'] as const;
export const PIN_WORKFLOWS = ['retail', 'insurance'] as const;
export const DAMAGE_TYPES = ['roof', 'siding', 'roof_and_siding'] as const;
export const DOOR_KNOCK_RESULTS = [
  'no_answer',
  'no_appointment',
  'appointment',
] as const;
// Homeowner-contact outcome captured on insurance/damage pins. When
// "call_to_schedule" is selected, the rep must also capture the
// customer's name and phone number so the office can follow up.
export const CONTACT_OUTCOMES = [
  'no_soliciting',
  'priority_inspection',
  'call_to_schedule',
] as const;

export type Role = (typeof ROLES)[number];
export type WorkflowAssignment = (typeof WORKFLOW_ASSIGNMENTS)[number];
export type Department = (typeof DEPARTMENTS)[number];
export type PinWorkflow = (typeof PIN_WORKFLOWS)[number];
export type DamageType = (typeof DAMAGE_TYPES)[number];
export type DoorKnockResult = (typeof DOOR_KNOCK_RESULTS)[number];
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];

// Per-user role + workflow assignment + department. Row is created lazily
// on first profile access (defaults: field_rep / insurance_retail /
// canvasser), mirroring the source app's behavior.
export const userProfilesTable = pgTable('user_profiles', {
  userId: varchar('user_id')
    .primaryKey()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  role: varchar('role', { enum: ROLES }).notNull().default('field_rep'),
  workflowAssignment: varchar('workflow_assignment', {
    enum: WORKFLOW_ASSIGNMENTS,
  })
    .notNull()
    .default('insurance_retail'),
  department: varchar('department', { enum: DEPARTMENTS })
    .notNull()
    .default('canvasser'),
  // Signature-on-file (M-F / F0). Captured once on the profile and reused
  // across every inspection declaration, so the inspector never re-draws a
  // signature per submission. The image itself lives in tenant-scoped object
  // storage (read access enforced by objectOwnershipTable); we store only the
  // servable URL, a SHA-256 of the exact bytes (integrity proof), and when it
  // was captured. All nullable: a profile with no signature on file blocks
  // submission until one is captured.
  signatureUrl: text('signature_url'),
  signatureSha256: text('signature_sha256'),
  signatureSignedAt: timestamp('signature_signed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Retail door-knock detail captured when doorKnockResult === "appointment".
export interface RetailData {
  ownerName1: string;
  ownerName2?: string | null;
  phone?: string | null;
  email?: string | null;
  interestedRoof: boolean;
  interestedSiding: boolean;
  interestedWindows: boolean;
  interestedDoors: boolean;
  interestNotes?: string | null;
  appointmentDate?: string | null;
  notes?: string | null;
}

export const pinsTable = pgTable('pins', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar('user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  // Denormalized from the creating user's company so every pin query can
  // be scoped by companyId without joining through users.
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),
  address: text('address'),
  workflow: varchar('workflow', { enum: PIN_WORKFLOWS }).notNull(),
  damageType: varchar('damage_type', { enum: DAMAGE_TYPES }),
  photoUrl: text('photo_url'),
  doorKnockResult: varchar('door_knock_result', { enum: DOOR_KNOCK_RESULTS }),
  retailData: jsonb('retail_data').$type<RetailData>(),
  contactOutcome: varchar('contact_outcome', { enum: CONTACT_OUTCOMES }),
  customerName: text('customer_name'),
  customerPhone: text('customer_phone'),
  status: varchar('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Tracks which user/company an uploaded object storage entity belongs to,
// recorded when the presigned upload URL is issued (before the file itself
// exists). GET /storage/objects/*path uses this to enforce that only
// authenticated users from the same company can read the file back.
export const objectOwnershipTable = pgTable('object_ownership', {
  objectPath: varchar('object_path').primaryKey(),
  userId: varchar('user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Latest known GPS position per rep — internal team-position awareness.
export const userLocationsTable = pgTable('user_locations', {
  userId: varchar('user_id')
    .primaryKey()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type UserProfile = typeof userProfilesTable.$inferSelect;
export type Pin = typeof pinsTable.$inferSelect;
export type InsertPin = typeof pinsTable.$inferInsert;
export type UserLocation = typeof userLocationsTable.$inferSelect;
export type ObjectOwnership = typeof objectOwnershipTable.$inferSelect;
