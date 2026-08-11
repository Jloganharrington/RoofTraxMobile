/**
 * lib/db/src/schema/permissionOverrides.ts
 *
 * Per-user permission overrides (Step 5).
 *
 * An admin-authored row explicitly grants or revokes a specific permission key
 * for a single user, bypassing the role default from the lib/authz registry.
 * The override is checked before the registry default in requirePermission()
 * and in the capability resolver endpoint.
 *
 * Invariants:
 * • One row per (companyId, userId, permission) — enforced by unique index.
 * • Tenant-scoped: companyId mirrors the user's companyId; cross-company rows
 *   are prevented by the route's company-scope check before write.
 * • "Cannot grant what you do not hold" — the API layer enforces that an actor
 *   granting a permission must themselves hold it (role or prior override).
 * • Revoking a permission the user wouldn't have by role is a no-op for access
 *   control but is still stored so the admin intent is visible in the UI.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { companiesTable, usersTable } from './auth';

export const userPermissionOverridesTable = pgTable(
  'user_permission_overrides',
  {
    id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
    // Tenant scope — mirrors the user row's companyId.
    companyId: varchar('company_id')
      .notNull()
      .references(() => companiesTable.id),
    // The user whose effective permission set is modified.
    userId: varchar('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    // The permission key being overridden (must be a valid PERMISSION_KEYS entry —
    // validated at the API layer; no DB enum so new keys need no migration).
    permission: varchar('permission', { length: 100 }).notNull(),
    // true  = explicit grant (overrides a registry deny for this user).
    // false = explicit revoke (overrides a registry allow for this user).
    granted: boolean('granted').notNull(),
    // The admin who set this override — kept for audit trail display in the UI.
    grantedByUserId: varchar('granted_by_user_id')
      .notNull()
      .references(() => usersTable.id),
    // Optional human note explaining why the override was made.
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One override per (company, user, permission).
    uniqueIndex('user_permission_overrides_user_perm_idx').on(
      table.companyId,
      table.userId,
      table.permission,
    ),
    // Batch-load all overrides for a user in one indexed scan.
    index('user_permission_overrides_user_idx').on(table.companyId, table.userId),
  ],
);

export type UserPermissionOverride = typeof userPermissionOverridesTable.$inferSelect;
export type InsertUserPermissionOverride = typeof userPermissionOverridesTable.$inferInsert;

// ── Permission override change log ────────────────────────────────────────────
/**
 * Append-only audit table for every grant, revoke, or clear of a per-user
 * permission override.  One row is written inside the same transaction as the
 * override change so the audit trail is always consistent with the live state.
 *
 * previousState / newState use the string enum 'granted' | 'revoked' | null:
 *   null  = no override was present (registry default applies)
 *   'granted' = an explicit allow override
 *   'revoked' = an explicit deny override
 */
export const permissionOverrideChangesTable = pgTable(
  'permission_override_changes',
  {
    id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
    companyId: varchar('company_id')
      .notNull()
      .references(() => companiesTable.id),
    targetUserId: varchar('target_user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    permission: varchar('permission', { length: 100 }).notNull(),
    // null means no prior override existed; 'granted' or 'revoked' otherwise.
    previousState: varchar('previous_state', { length: 10 }),
    // null means the override was cleared (DELETE); 'granted' or 'revoked' for set.
    newState: varchar('new_state', { length: 10 }),
    note: text('note').notNull(),
    actorUserId: varchar('actor_user_id')
      .notNull()
      .references(() => usersTable.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('perm_override_changes_company_user_created_idx').on(
      table.companyId,
      table.targetUserId,
      table.createdAt,
    ),
  ],
);

export type PermissionOverrideChange = typeof permissionOverrideChangesTable.$inferSelect;
export type InsertPermissionOverrideChange = typeof permissionOverrideChangesTable.$inferInsert;
