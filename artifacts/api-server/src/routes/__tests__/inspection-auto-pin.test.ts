import { companiesTable, db, inspectionsTable, pinsTable, userProfilesTable, usersTable } from '@workspace/db';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

// Proves the auto-pin behavior of POST /inspections: starting an inspection
// without a pin drops one (linked via pinId), reuses an existing pin at the
// same spot instead of duplicating, and never double-drops on an idempotent
// offline replay of the same client id.

const RUN_ID = Date.now().toString(36);

function auth(sid: string) {
  return { Authorization: `Bearer ${sid}` };
}

describe('inspection auto-pin', () => {
  const companyId = `TEST-AUTOPIN-${RUN_ID}`.toUpperCase();
  let userId: string;
  let sid: string;

  beforeAll(async () => {
    await db.insert(companiesTable).values({ id: companyId, name: 'Auto Pin Co' });
    const [user] = await db
      .insert(usersTable)
      .values({ companyId, email: `autopin-${RUN_ID}@example.test` })
      .returning();
    userId = user.id;
    await db
      .insert(userProfilesTable)
      .values({ userId, role: 'field_rep', department: 'inspector_canvasser' });
    sid = await createSession({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
        companyId,
      },
      access_token: 'test-access-token',
    });
  });

  afterAll(async () => {
    await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));
    await db.delete(pinsTable).where(eq(pinsTable.companyId, companyId));
    await db.delete(usersTable).where(inArray(usersTable.id, [userId]));
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  });

  it('drops a linked insurance pin when an inspection starts without one', async () => {
    const res = await request(app)
      .post('/api/inspections')
      .set(auth(sid))
      .send({
        phase: 'preliminary',
        address: '123 Auto Pin Way',
        latitude: 38.95,
        longitude: -77.35,
      });
    expect(res.status).toBe(201);
    const pinId = res.body.inspection.pinId;
    expect(pinId).toBeTruthy();

    const [pin] = await db.select().from(pinsTable).where(eq(pinsTable.id, pinId));
    expect(pin).toBeTruthy();
    expect(pin.companyId).toBe(companyId);
    expect(pin.userId).toBe(userId);
    expect(pin.workflow).toBe('insurance');
    expect(pin.latitude).toBeCloseTo(38.95);
    expect(pin.address).toBe('123 Auto Pin Way');
  });

  it('reuses an existing pin at the same spot instead of duplicating', async () => {
    const res = await request(app)
      .post('/api/inspections')
      .set(auth(sid))
      .send({
        phase: 'preliminary',
        address: '123 auto pin way', // same address, different case
        latitude: 38.95,
        longitude: -77.35,
      });
    expect(res.status).toBe(201);
    expect(res.body.inspection.pinId).toBeTruthy();

    const pins = await db.select().from(pinsTable).where(eq(pinsTable.companyId, companyId));
    expect(pins.length).toBe(1);
  });

  it('does not double-drop on an idempotent replay of the same client id', async () => {
    const clientId = randomUUID();
    const body = {
      id: clientId,
      phase: 'preliminary',
      address: '456 Replay Rd',
      latitude: 39.11,
      longitude: -77.51,
    };
    const first = await request(app).post('/api/inspections').set(auth(sid)).send(body);
    expect(first.status).toBe(201);
    const pinId = first.body.inspection.pinId;
    expect(pinId).toBeTruthy();

    const replay = await request(app).post('/api/inspections').set(auth(sid)).send(body);
    expect(replay.status).toBe(200);
    expect(replay.body.inspection.pinId).toBe(pinId);

    const pins = await db.select().from(pinsTable).where(eq(pinsTable.companyId, companyId));
    expect(pins.length).toBe(2); // the first spot's pin + this one, no extras
  });

  it('respects an explicitly supplied pinId and skips no-coordinate creates', async () => {
    // No coordinates -> no pin.
    const noCoords = await request(app)
      .post('/api/inspections')
      .set(auth(sid))
      .send({ phase: 'preliminary', address: '789 Nowhere Ln' });
    expect(noCoords.status).toBe(201);
    expect(noCoords.body.inspection.pinId).toBeNull();

    // Explicit pinId -> kept as-is, still no extra pin.
    const [pin] = await db.select().from(pinsTable).where(eq(pinsTable.companyId, companyId));
    const withPin = await request(app)
      .post('/api/inspections')
      .set(auth(sid))
      .send({
        phase: 'preliminary',
        pinId: pin.id,
        latitude: 40.0,
        longitude: -76.0,
      });
    expect(withPin.status).toBe(201);
    expect(withPin.body.inspection.pinId).toBe(pin.id);

    const pins = await db.select().from(pinsTable).where(eq(pinsTable.companyId, companyId));
    expect(pins.length).toBe(2);
  });
});
