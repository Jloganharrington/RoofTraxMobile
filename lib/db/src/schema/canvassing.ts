import { sql } from 'drizzle-orm';
import { pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

import { companiesTable, usersTable } from './auth';

// Canvassing time tracking (Phase M-B / B2). One row per clock-in. A
// session is "open" while `endedAt` is null; clock-out stamps `endedAt`.
// Duration is intentionally NOT stored — it is derived server-side from
// (endedAt - startedAt) when aggregating hours, keeping this table to raw
// values only (consistent with the platform's no-stored-derived-values
// rule). At most one open session per user is enforced in the route layer.
export const canvassingSessionsTable = pgTable('canvassing_sessions', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  userId: varchar('user_id')
    .notNull()
    .references(() => usersTable.id),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
});

export type CanvassingSession = typeof canvassingSessionsTable.$inferSelect;
export type InsertCanvassingSession = typeof canvassingSessionsTable.$inferInsert;
