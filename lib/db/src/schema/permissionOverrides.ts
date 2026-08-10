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
