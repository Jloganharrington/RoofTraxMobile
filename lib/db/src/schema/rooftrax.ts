import { sql } from 'drizzle-orm';
import {
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { usersTable } from './auth';

export const ROLES = ['field_rep', 'manager', 'admin'] as const;
export const WORKFLOW_ASSIGNMENTS = ['retail', 'insurance', 'both'] as const;
export const PIN_WORKFLOWS = ['retail', 'insurance'] as const;
export const DAMAGE_TYPES = ['roof', 'siding', 'roof_and_siding'] as const;
export const DOOR_KNOCK_RESULTS = [
  'no_answer',
  'no_appointment',
  'appointment',
] as const;

export type Role = (typeof ROLES)[number];
export type WorkflowAssignment = (typeof WORKFLOW_ASSIGNMENTS)[number];
export type PinWorkflow = (typeof PIN_WORKFLOWS)[number];
export type DamageType = (typeof DAMAGE_TYPES)[number];
export type DoorKnockResult = (typeof DOOR_KNOCK_RESULTS)[number];

// Per-user role + workflow assignment. Row is created lazily on first
// profile access (defaults: field_rep / insurance), mirroring the source
// app's behavior.
export const userProfilesTable = pgTable('user_profiles', {
  userId: varchar('user_id')
    .primaryKey()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  role: varchar('role', { enum: ROLES }).notNull().default('field_rep'),
  workflowAssignment: varchar('workflow_assignment', {
    enum: WORKFLOW_ASSIGNMENTS,
  })
    .notNull()
    .default('insurance'),
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
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),
  address: text('address'),
  workflow: varchar('workflow', { enum: PIN_WORKFLOWS }).notNull(),
  damageType: varchar('damage_type', { enum: DAMAGE_TYPES }),
  photoUrl: text('photo_url'),
  doorKnockResult: varchar('door_knock_result', { enum: DOOR_KNOCK_RESULTS }),
  retailData: jsonb('retail_data').$type<RetailData>(),
  status: varchar('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Latest known GPS position per rep — internal team-position awareness.
export const userLocationsTable = pgTable('user_locations', {
  userId: varchar('user_id')
    .primaryKey()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
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
