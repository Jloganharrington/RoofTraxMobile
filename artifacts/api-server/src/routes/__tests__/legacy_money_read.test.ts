/**
 * Proves: a pin with legacy money varchar columns populated but ZERO rows
 * in the new payments table still loads correctly — no 500, no crash.
 * Migration 023 adds a table; it must not break existing pin reads.
 *
 * The legacy varchar columns (deposit_amount, acv_amount, etc.) still exist
 * on the pins table. The test verifies the lead GET returns 200 and that the
 * payments endpoint returns an empty array for such a pin (backfill skip-path).
 */
import { companiesTable, db, pinsTable, pool, userProfilesTable, usersTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../app';
import { createSession } from '../../lib/auth';

const RUN_ID = Date.now().toString(36);
const CO = `LMR-${RUN_ID}`.toUpperCase();
let userId: string;
let pinId: string;
let sid: string;

beforeAll(async () => {
  await db.insert(companiesTable).values({ id: CO, name: 'Legacy Money Read' });
  const [u] = await db.insert(usersTable)
    .values({ companyId: CO, email: `lmr-${RUN_ID}@t.invalid` })
    .returning();
  userId = u.id;
  await db.insert(userProfilesTable).values({ userId, role: 'manager' });
  sid = await createSession({
    user: { id: u.id, email: u.email, firstName: null, lastName: null, profileImageUrl: null, companyId: CO },
    access_token: 'tok',
  });

  // Insert a pin whose legacy varchar money columns are all populated —
  // simulates pre-migration data (or data written directly to DB before 023).
  const { rows } = await pool.query(
    `INSERT INTO pins (company_id, user_id, latitude, longitude, workflow,
       deposit_amount, deposit_date, deposit_payment_method,
       acv_amount, supplement_amount, final_payment_amount)
     VALUES ($1, $2, 38.9, -77.0, 'insurance',
       '$12,500.00', NOW(), 'Check',
       '$8,000.00', '$2,500.00', '$1,200.00')
     RETURNING id`,
    [CO, userId],
  );
  pinId = rows[0].id;
});

afterAll(async () => {
  await db.delete(pinsTable).where(eq(pinsTable.id, pinId)).catch(() => {});
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, userId)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, CO)).catch(() => {});
});

describe('legacy money read — backfill skip-path', () => {
  it('GET /pins/:pinId → 200, lead exists (legacy varchar money fields do not crash the read)', async () => {
    // The endpoint returns { lead: { ... } } — legacy columns on the DB row
    // must not cause a response-parse 500.
    const res = await request(app)
      .get(`/api/pins/${pinId}`)
      .set({ Authorization: `Bearer ${sid}` });
    expect(res.status).toBe(200);
    expect(res.body.lead).toBeDefined();
    expect(res.body.lead.id).toBe(pinId);
  });

  it('GET /pins/:pinId/payments → 200, empty array (zero ledger rows — backfill skip-path)', async () => {
    // A pin with legacy money data but no payments table rows must return an
    // empty ledger, not a 404 or 500.
    const res = await request(app)
      .get(`/api/pins/${pinId}/payments`)
      .set({ Authorization: `Bearer ${sid}` });
    expect(res.status).toBe(200);
    expect(res.body.payments).toEqual([]);
  });
});
