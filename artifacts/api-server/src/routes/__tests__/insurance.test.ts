/**
 * GET /pins/:pinId/insurance     — any authenticated company member
 * PATCH /pins/:pinId/insurance   — manager+ only
 *
 * Gate: field_rep → 403; manager/admin/super_admin → 200.
 * Cross-company: pin from company B is 404 for company A users.
 * Validation: invalid claimStatus → 400.
 * Partial update: omitted fields are preserved.
 */

import {
  claimStatusHistoryTable,
  companiesTable,
  db,
  pinsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

const RUN_ID = `ins-${Date.now().toString(36)}`;

const COMPANY_A = `INSA-${RUN_ID}`.toUpperCase();
const COMPANY_B = `INSB-${RUN_ID}`.toUpperCase();

interface Seeded {
  repSid:      string;
  managerSid:  string;
  adminSid:    string;
  superSid:    string;
  pinIdA:      string;
  pinIdB:      string; // foreign company — should 404
}

async function seedUser(companyId: string, email: string, role: string) {
  const [u] = await db
    .insert(usersTable)
    .values({ companyId, email })
    .returning();
  await db.insert(userProfilesTable).values({ userId: u.id, role: role as never });
  const sid = await createSession({
    user: {
      id:              u.id,
      email:           u.email,
      firstName:       u.firstName,
      lastName:        u.lastName,
      profileImageUrl: u.profileImageUrl,
      companyId,
    },
    access_token: 'test-access-token',
  });
  return { userId: u.id, sid };
}

let s: Seeded;

beforeAll(async () => {
  await db.insert(companiesTable).values([
    { id: COMPANY_A, name: `InsTest A ${RUN_ID}` },
    { id: COMPANY_B, name: `InsTest B ${RUN_ID}` },
  ]);

  const rep     = await seedUser(COMPANY_A, `ins-rep-${RUN_ID}@test.invalid`,   'field_rep');
  const manager = await seedUser(COMPANY_A, `ins-mgr-${RUN_ID}@test.invalid`,   'manager');
  const admin   = await seedUser(COMPANY_A, `ins-adm-${RUN_ID}@test.invalid`,   'admin');
  const superU  = await seedUser(COMPANY_A, `ins-sup-${RUN_ID}@test.invalid`,   'super_admin');
  const repB    = await seedUser(COMPANY_B, `ins-repb-${RUN_ID}@test.invalid`,  'manager');

  const [pinA] = await db
    .insert(pinsTable)
    .values({
      companyId: COMPANY_A,
      userId:    manager.userId,
      latitude:  38.9,
      longitude: -77.0,
      workflow:  'insurance',
    })
    .returning();

  const [pinB] = await db
    .insert(pinsTable)
    .values({
      companyId: COMPANY_B,
      userId:    repB.userId,
      latitude:  38.9,
      longitude: -77.0,
      workflow:  'insurance',
    })
    .returning();

  s = {
    repSid:     rep.sid,
    managerSid: manager.sid,
    adminSid:   admin.sid,
    superSid:   superU.sid,
    pinIdA:     pinA.id,
    pinIdB:     pinB.id,
  };
});

afterAll(async () => {
  await db.delete(pinsTable).where(eq(pinsTable.companyId, COMPANY_A));
  await db.delete(pinsTable).where(eq(pinsTable.companyId, COMPANY_B));
  await db.delete(userProfilesTable).where(
    eq(userProfilesTable.userId,
      (await db.select({ id: usersTable.id }).from(usersTable)
        .where(eq(usersTable.companyId, COMPANY_A))
        .limit(1))[0]?.id ?? '',
    ),
  );
  await db.delete(usersTable).where(eq(usersTable.companyId, COMPANY_A));
  await db.delete(usersTable).where(eq(usersTable.companyId, COMPANY_B));
  await db.delete(companiesTable).where(eq(companiesTable.id, COMPANY_A));
  await db.delete(companiesTable).where(eq(companiesTable.id, COMPANY_B));
});

const auth = (sid: string) => ({ Authorization: `Bearer ${sid}` });

// ---------------------------------------------------------------------------
// GET /pins/:pinId/insurance
// ---------------------------------------------------------------------------
describe('GET /pins/:pinId/insurance', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get(`/api/pins/${s.pinIdA}/insurance`);
    expect(res.status).toBe(401);
  });

  it('returns 200 for field_rep (read-only tab)', async () => {
    const res = await request(app)
      .get(`/api/pins/${s.pinIdA}/insurance`)
      .set(auth(s.repSid));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('insurance');
  });

  it('returns 200 for manager', async () => {
    const res = await request(app)
      .get(`/api/pins/${s.pinIdA}/insurance`)
      .set(auth(s.managerSid));
    expect(res.status).toBe(200);
    expect(res.body.insurance).toBeDefined();
  });

  it('returns 404 for a pin in a different company', async () => {
    const res = await request(app)
      .get(`/api/pins/${s.pinIdB}/insurance`)
      .set(auth(s.managerSid));
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /pins/:pinId/insurance — manager+ gate
// ---------------------------------------------------------------------------
describe('PATCH /pins/:pinId/insurance — auth gate', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .patch(`/api/pins/${s.pinIdA}/insurance`)
      .send({ claimStatus: 'filed' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for field_rep', async () => {
    const res = await request(app)
      .patch(`/api/pins/${s.pinIdA}/insurance`)
      .set(auth(s.repSid))
      .send({ claimStatus: 'filed' });
    expect(res.status).toBe(403);
  });

  it('returns 404 for a pin in a different company', async () => {
    const res = await request(app)
      .patch(`/api/pins/${s.pinIdB}/insurance`)
      .set(auth(s.managerSid))
      .send({ claimStatus: 'filed' });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /pins/:pinId/insurance — field writes
// ---------------------------------------------------------------------------
describe('PATCH /pins/:pinId/insurance — writes', () => {
  it('manager can write insurance carrier and claim number', async () => {
    const res = await request(app)
      .patch(`/api/pins/${s.pinIdA}/insurance`)
      .set(auth(s.managerSid))
      .send({ insuranceCarrier: 'State Farm', claimNumber: 'SF-001' });
    expect(res.status).toBe(200);
    expect(res.body.insurance.insuranceCarrier).toBe('State Farm');
    expect(res.body.insurance.claimNumber).toBe('SF-001');
  });

  it('admin can set claimStatus to a valid value', async () => {
    const res = await request(app)
      .patch(`/api/pins/${s.pinIdA}/insurance`)
      .set(auth(s.adminSid))
      .send({ claimStatus: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.insurance.claimStatus).toBe('approved');
  });

  it('super_admin can set bettermentsAmountCents', async () => {
    const res = await request(app)
      .patch(`/api/pins/${s.pinIdA}/insurance`)
      .set(auth(s.superSid))
      .send({ bettermentsAmountCents: 25000 });
    expect(res.status).toBe(200);
    expect(res.body.insurance.bettermentsAmountCents).toBe(25000);
  });

  it('partial update preserves fields not in payload', async () => {
    // Pre-write a known value
    await request(app)
      .patch(`/api/pins/${s.pinIdA}/insurance`)
      .set(auth(s.managerSid))
      .send({ supplementNotes: 'roof decking not included' });

    // Subsequent PATCH with a different field should not wipe supplementNotes
    const res = await request(app)
      .patch(`/api/pins/${s.pinIdA}/insurance`)
      .set(auth(s.managerSid))
      .send({ adjusterName: 'Jane Doe' });
    expect(res.status).toBe(200);
    expect(res.body.insurance.adjusterName).toBe('Jane Doe');
    expect(res.body.insurance.supplementNotes).toBe('roof decking not included');
  });
});

// ---------------------------------------------------------------------------
// PATCH /pins/:pinId/insurance — validation
// ---------------------------------------------------------------------------
describe('PATCH /pins/:pinId/insurance — validation', () => {
  it('rejects an invalid claimStatus with 400', async () => {
    const res = await request(app)
      .patch(`/api/pins/${s.pinIdA}/insurance`)
      .set(auth(s.managerSid))
      .send({ claimStatus: 'not_a_real_status' });
    expect(res.status).toBe(400);
  });

  it('rejects a negative bettermentsAmountCents with 400', async () => {
    const res = await request(app)
      .patch(`/api/pins/${s.pinIdA}/insurance`)
      .set(auth(s.managerSid))
      .send({ bettermentsAmountCents: -100 });
    expect(res.status).toBe(400);
  });

  it('accepts null to clear a field', async () => {
    const res = await request(app)
      .patch(`/api/pins/${s.pinIdA}/insurance`)
      .set(auth(s.managerSid))
      .send({ claimStatus: null });
    expect(res.status).toBe(200);
    expect(res.body.insurance.claimStatus).toBeNull();
  });

  // ── Profile-endpoint bypass closed (#303) ─────────────────────────────────
  //
  // PATCH /pins/:pinId/profile uses canEditPin() which would allow a field rep
  // who owns the pin to write insurance fields.  After removing those fields
  // from LeadProfileBody, the profile endpoint silently strips them and leaves
  // the insurance data unchanged — even when a valid Zod-shaped request body
  // carries the fields.
  //
  // Test sequence:
  //   a. Manager sets insuranceCarrier via the dedicated insurance endpoint.
  //   b. Field rep attempts to overwrite insuranceCarrier via /profile.
  //      The request is accepted (200) for other fields, but the insurance
  //      field is silently stripped.
  //   c. A subsequent GET /insurance confirms the value is still the one the
  //      manager set in step (a) — the rep's attempt had no effect.

  it('14. field rep cannot overwrite insuranceCarrier via PATCH /profile (bypass closed)', async () => {
    // The bypass only applies to a pin the rep OWNS (canEditPin allows reps to
    // edit their own pins' general fields).  Create a rep-owned pin, let the
    // manager set insuranceCarrier via /insurance, then have the rep attempt to
    // overwrite it via /profile.  The field must survive unchanged.

    // Look up the rep's userId by email (set during seedUser in beforeAll)
    const [repRow] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, `ins-rep-${RUN_ID}@test.invalid`));
    const repUserId = repRow!.id;

    // Insert a pin owned by the rep
    const [repPin] = await db
      .insert(pinsTable)
      .values({ companyId: COMPANY_A, userId: repUserId, latitude: 38.9, longitude: -77.0, workflow: 'insurance' })
      .returning();
    const repPinId = repPin!.id;

    try {
      // (a) manager sets the carrier via the insurance endpoint
      const setRes = await request(app)
        .patch(`/api/pins/${repPinId}/insurance`)
        .set(auth(s.managerSid))
        .send({ insuranceCarrier: 'Carrier-Manager-Set' });
      expect(setRes.status).toBe(200);
      expect(setRes.body.insurance.insuranceCarrier).toBe('Carrier-Manager-Set');

      // (b) field rep (pin owner) tries to overwrite via /profile.
      //     The request is accepted (200) because the rep owns the pin, but
      //     insuranceCarrier is not in LeadProfileBody — Zod strips it silently.
      const profileRes = await request(app)
        .patch(`/api/pins/${repPinId}/profile`)
        .set(auth(s.repSid))
        .send({ insuranceCarrier: 'Carrier-Rep-Bypass-Attempt', notes: 'rep note' });
      expect(profileRes.status).toBe(200);

      // (c) verify insuranceCarrier was NOT changed
      const getRes = await request(app)
        .get(`/api/pins/${repPinId}/insurance`)
        .set(auth(s.managerSid));
      expect(getRes.status).toBe(200);
      expect(getRes.body.insurance.insuranceCarrier).toBe('Carrier-Manager-Set');
    } finally {
      await db.delete(pinsTable).where(eq(pinsTable.id, repPinId));
    }
  });
});

// ---------------------------------------------------------------------------
// claim_status_history audit trail
// ---------------------------------------------------------------------------
// Two-step sequence: set a status, then clear it.
// Expected history rows after both writes:
//   Row 1: from_status = null,     to_status = 'filed'
//   Row 2: from_status = 'filed',  to_status = null   (clearing event)
//
// Also verifies the no-op guard: writing the SAME status again adds no row.
// ---------------------------------------------------------------------------

describe('claim_status_history audit trail', () => {
  let historyPinId: string;

  beforeAll(async () => {
    // Fresh pin with no prior claim_status for an isolated test sequence.
    const [p] = await db
      .insert(pinsTable)
      .values({ companyId: COMPANY_A, userId: (await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.companyId, COMPANY_A)).limit(1))[0]!.id, latitude: 38.9, longitude: -77.0, workflow: 'insurance' })
      .returning();
    historyPinId = p!.id;
  });

  afterAll(async () => {
    await db.delete(pinsTable).where(eq(pinsTable.id, historyPinId));
  });

  it('produces one history row when setting status for the first time', async () => {
    const res = await request(app)
      .patch(`/api/pins/${historyPinId}/insurance`)
      .set(auth(s.managerSid))
      .send({ claimStatus: 'filed' });
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(claimStatusHistoryTable)
      .where(eq(claimStatusHistoryTable.pinId, historyPinId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fromStatus).toBeNull();     // no prior status
    expect(rows[0]!.toStatus).toBe('filed');
  });

  it('produces no row when setting the SAME status again (no-op guard)', async () => {
    const res = await request(app)
      .patch(`/api/pins/${historyPinId}/insurance`)
      .set(auth(s.managerSid))
      .send({ claimStatus: 'filed' });          // same value — no change
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(claimStatusHistoryTable)
      .where(eq(claimStatusHistoryTable.pinId, historyPinId));
    expect(rows).toHaveLength(1);               // still only one row
  });

  it('produces a second history row with to_status = null when clearing the status', async () => {
    const res = await request(app)
      .patch(`/api/pins/${historyPinId}/insurance`)
      .set(auth(s.managerSid))
      .send({ claimStatus: null });             // clearing the status
    expect(res.status).toBe(200);
    expect(res.body.insurance.claimStatus).toBeNull();

    const rows = await db
      .select()
      .from(claimStatusHistoryTable)
      .where(eq(claimStatusHistoryTable.pinId, historyPinId))
      .orderBy(claimStatusHistoryTable.createdAt);

    expect(rows).toHaveLength(2);

    // First row: null → 'filed'
    expect(rows[0]!.fromStatus).toBeNull();
    expect(rows[0]!.toStatus).toBe('filed');

    // Second row: 'filed' → null  (the clearing event)
    expect(rows[1]!.fromStatus).toBe('filed');
    expect(rows[1]!.toStatus).toBeNull();
  });
});
