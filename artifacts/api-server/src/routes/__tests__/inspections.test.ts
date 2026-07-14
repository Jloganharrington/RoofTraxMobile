import { companiesTable, db, inspectionsTable, userProfilesTable, usersTable } from '@workspace/db';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

// Proves the inspection module's permission gate (inspector_canvasser
// department or super_admin role) and tenant scoping end-to-end through
// the real HTTP routes, plus a thin create -> child-record smoke test.

const RUN_ID = Date.now().toString(36);

interface SeededUser {
  companyId: string;
  userId: string;
  sid: string;
}

async function seedUser(
  label: string,
  role: 'field_rep' | 'manager' | 'super_admin',
  department: 'canvasser' | 'inspector_canvasser',
  companyId: string,
): Promise<SeededUser> {
  const [user] = await db
    .insert(usersTable)
    .values({ companyId, email: `insp-${label}-${RUN_ID}@example.test` })
    .returning();
  await db.insert(userProfilesTable).values({ userId: user.id, role, department });

  const sid = await createSession({
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

  return { companyId, userId: user.id, sid };
}

function auth(sid: string) {
  return { Authorization: `Bearer ${sid}` };
}

describe('inspection routes', () => {
  const companyA = `TEST-INSPR-${RUN_ID}-A`.toUpperCase();
  const companyB = `TEST-INSPR-${RUN_ID}-B`.toUpperCase();
  let inspectorA: SeededUser;
  let inspectorA2: SeededUser;
  let managerA: SeededUser;
  let canvasserA: SeededUser;
  let superAdminB: SeededUser;
  let inspectorB: SeededUser;
  const userIds: string[] = [];

  beforeAll(async () => {
    await db.insert(companiesTable).values([
      { id: companyA, name: 'Inspection Route Co A' },
      { id: companyB, name: 'Inspection Route Co B' },
    ]);

    inspectorA = await seedUser('inspector-a', 'field_rep', 'inspector_canvasser', companyA);
    inspectorA2 = await seedUser('inspector-a2', 'field_rep', 'inspector_canvasser', companyA);
    managerA = await seedUser('manager-a', 'manager', 'inspector_canvasser', companyA);
    canvasserA = await seedUser('canvasser-a', 'field_rep', 'canvasser', companyA);
    superAdminB = await seedUser('super-admin-b', 'super_admin', 'canvasser', companyB);
    inspectorB = await seedUser('inspector-b', 'field_rep', 'inspector_canvasser', companyB);
    userIds.push(
      inspectorA.userId,
      inspectorA2.userId,
      managerA.userId,
      canvasserA.userId,
      superAdminB.userId,
      inspectorB.userId,
    );
  });

  afterAll(async () => {
    await db.delete(inspectionsTable).where(inArray(inspectionsTable.companyId, [companyA, companyB]));
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    await db.delete(companiesTable).where(inArray(companiesTable.id, [companyA, companyB]));
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/inspections');
    expect(res.status).toBe(401);
  });

  it('rejects a canvasser (non-inspector, non-super-admin) department', async () => {
    const res = await request(app).get('/api/inspections').set(auth(canvasserA.sid));
    expect(res.status).toBe(403);
  });

  it('allows an inspector_canvasser to create and list an inspection', async () => {
    const createRes = await request(app)
      .post('/api/inspections')
      .set(auth(inspectorA.sid))
      .send({ claimNumber: 'CLM-1', insuredName: 'Jane Doe' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.inspection.companyId).toBe(companyA);
    expect(createRes.body.inspection.inspectorUserId).toBe(inspectorA.userId);
    expect(createRes.body.inspection.status).toBe('scheduled');

    const listRes = await request(app).get('/api/inspections').set(auth(inspectorA.sid));
    expect(listRes.status).toBe(200);
    const ids = listRes.body.inspections.map((i: { id: string }) => i.id);
    expect(ids).toContain(createRes.body.inspection.id);
  });

  it('allows a super_admin to access the module regardless of department', async () => {
    const res = await request(app)
      .post('/api/inspections')
      .set(auth(superAdminB.sid))
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.inspection.companyId).toBe(companyB);
  });

  it('never lets one company see or reach another company\'s inspection', async () => {
    const createRes = await request(app)
      .post('/api/inspections')
      .set(auth(inspectorA.sid))
      .send({ claimNumber: 'CLM-CROSS' });
    const inspectionId = createRes.body.inspection.id as string;

    const crossGet = await request(app)
      .get(`/api/inspections/${inspectionId}`)
      .set(auth(inspectorB.sid));
    expect(crossGet.status).toBe(404);

    const crossPatch = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .set(auth(inspectorB.sid))
      .send({ status: 'capturing' });
    expect(crossPatch.status).toBe(404);

    const crossSlope = await request(app)
      .post(`/api/inspections/${inspectionId}/slopes`)
      .set(auth(inspectorB.sid))
      .send({ label: 'Sneaky slope' });
    expect(crossSlope.status).toBe(404);

    const listA = await request(app).get('/api/inspections').set(auth(inspectorA.sid));
    const idsA = listA.body.inspections.map((i: { id: string }) => i.id);
    expect(idsA).toContain(inspectionId);

    const listB = await request(app).get('/api/inspections').set(auth(inspectorB.sid));
    const idsB = listB.body.inspections.map((i: { id: string }) => i.id);
    expect(idsB).not.toContain(inspectionId);
  });

  it('scopes the "my inspections" list to the acting inspector, not the whole company', async () => {
    const mine = await request(app)
      .post('/api/inspections')
      .set(auth(inspectorA.sid))
      .send({ claimNumber: 'CLM-MINE' });
    const coworkers = await request(app)
      .post('/api/inspections')
      .set(auth(inspectorA2.sid))
      .send({ claimNumber: 'CLM-COWORKER' });

    const listA = await request(app).get('/api/inspections').set(auth(inspectorA.sid));
    const idsA = listA.body.inspections.map((i: { id: string }) => i.id);
    expect(idsA).toContain(mine.body.inspection.id);
    expect(idsA).not.toContain(coworkers.body.inspection.id);
  });

  it('creates attestations idempotently when a client id is supplied (retry-safe)', async () => {
    const createRes = await request(app)
      .post('/api/inspections')
      .set(auth(inspectorA.sid))
      .send({ claimNumber: 'CLM-ATTEST' });
    const inspectionId = createRes.body.inspection.id as string;

    const clientId = `att-${RUN_ID}-idem`;
    const body = { id: clientId, attestationType: 'equipment', stage: 'S0', details: { ok: true } };

    const first = await request(app)
      .post(`/api/inspections/${inspectionId}/attestations`)
      .set(auth(inspectorA.sid))
      .send(body);
    expect(first.status).toBe(201);
    expect(first.body.attestation.id).toBe(clientId);

    // A retried offline queue item resends the same payload; the server must
    // return the existing row (200) instead of duplicating it (201).
    const retry = await request(app)
      .post(`/api/inspections/${inspectionId}/attestations`)
      .set(auth(inspectorA.sid))
      .send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.attestation.id).toBe(clientId);
  });

  it('updates an inspection\'s status', async () => {
    const createRes = await request(app)
      .post('/api/inspections')
      .set(auth(inspectorA.sid))
      .send({});
    const inspectionId = createRes.body.inspection.id as string;

    const patchRes = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .set(auth(inspectorA.sid))
      .send({ status: 'capturing' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.inspection.status).toBe('capturing');
  });

  it('supports the full thin child-record chain: slope -> damage instance -> test square -> hit -> photo -> measurement -> attestation', async () => {
    const createRes = await request(app)
      .post('/api/inspections')
      .set(auth(inspectorA.sid))
      .send({});
    const inspectionId = createRes.body.inspection.id as string;

    const slopeRes = await request(app)
      .post(`/api/inspections/${inspectionId}/slopes`)
      .set(auth(inspectorA.sid))
      .send({ label: 'Front slope', pitchRise: 6, pitchRun: 12 });
    expect(slopeRes.status).toBe(201);
    const slopeId = slopeRes.body.slope.id as string;

    const elevationRes = await request(app)
      .post(`/api/inspections/${inspectionId}/elevations`)
      .set(auth(inspectorA.sid))
      .send({ direction: 'front' });
    expect(elevationRes.status).toBe(201);

    const damageRes = await request(app)
      .post(`/api/inspections/${inspectionId}/damage-instances`)
      .set(auth(inspectorA.sid))
      .send({ slopeId, damageType: 'hail', causationNote: 'Fresh granule loss, bruising visible' });
    expect(damageRes.status).toBe(201);
    expect(damageRes.body.damageInstance.slopeId).toBe(slopeId);

    const testSquareRes = await request(app)
      .post(`/api/inspections/${inspectionId}/test-squares`)
      .set(auth(inspectorA.sid))
      .send({ slopeId, label: 'TS-1', sizeSqFt: 100 });
    expect(testSquareRes.status).toBe(201);
    const testSquareId = testSquareRes.body.testSquare.id as string;

    const hitRes = await request(app)
      .post(`/api/inspections/${inspectionId}/test-squares/${testSquareId}/hits`)
      .set(auth(inspectorA.sid))
      .send({ hitType: 'hail_strike' });
    expect(hitRes.status).toBe(201);
    expect(hitRes.body.hit.testSquareId).toBe(testSquareId);

    const photoRes = await request(app)
      .post(`/api/inspections/${inspectionId}/photos`)
      .set(auth(inspectorA.sid))
      .send({
        subjectType: 'slope',
        subjectId: slopeId,
        triadRole: 'wide',
        url: 'https://example.test/photo.jpg',
        sha256: 'a'.repeat(64),
        exifJson: { make: 'Apple' },
      });
    expect(photoRes.status).toBe(201);
    expect(photoRes.body.photo.sha256).toBe('a'.repeat(64));

    const measurementRes = await request(app)
      .post(`/api/inspections/${inspectionId}/measurements`)
      .set(auth(inspectorA.sid))
      .send({ subjectType: 'slope', subjectId: slopeId, measurementType: 'length', value: 42, unit: 'ft' });
    expect(measurementRes.status).toBe(201);

    const attestationRes = await request(app)
      .post(`/api/inspections/${inspectionId}/attestations`)
      .set(auth(inspectorA.sid))
      .send({ stage: 'S8', signatureData: 'Jane Inspector' });
    expect(attestationRes.status).toBe(201);
    expect(attestationRes.body.attestation.userId).toBe(inspectorA.userId);
  });

  it('404s adding a hit to a test square that does not belong to the given inspection', async () => {
    const createResA = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
    const inspectionAId = createResA.body.inspection.id as string;
    const testSquareRes = await request(app)
      .post(`/api/inspections/${inspectionAId}/test-squares`)
      .set(auth(inspectorA.sid))
      .send({ label: 'TS-Orphan' });
    const testSquareId = testSquareRes.body.testSquare.id as string;

    const createResA2 = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
    const otherInspectionId = createResA2.body.inspection.id as string;

    const res = await request(app)
      .post(`/api/inspections/${otherInspectionId}/test-squares/${testSquareId}/hits`)
      .set(auth(inspectorA.sid))
      .send({ hitType: 'impact' });
    expect(res.status).toBe(404);
  });

  it('rejects invalid payloads with 400', async () => {
    const createRes = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
    const inspectionId = createRes.body.inspection.id as string;

    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/slopes`)
      .set(auth(inspectorA.sid))
      .send({});
    expect(res.status).toBe(400);
  });

  // C0: a same-company peer inspector can reach the module but must not be
  // able to mutate an inspection they don't own. Every write path is gated to
  // the assigned inspector OR a manager and above in the company.
  describe('C0 write-scoping: owner or manager+, never a same-company peer', () => {
    let inspectionId: string;
    let ownerTestSquareId: string;

    beforeAll(async () => {
      const createRes = await request(app)
        .post('/api/inspections')
        .set(auth(inspectorA.sid))
        .send({ claimNumber: 'CLM-C0' });
      inspectionId = createRes.body.inspection.id as string;

      // Owner-created test square so the peer's hit attempt fails on the write
      // gate, not on a missing square.
      const ts = await request(app)
        .post(`/api/inspections/${inspectionId}/test-squares`)
        .set(auth(inspectorA.sid))
        .send({ label: 'TS-C0' });
      ownerTestSquareId = ts.body.testSquare.id as string;
    });

    // Every mutating path on an existing inspection (PATCH carries the
    // storm-confirm and arrival fields). Built fresh per actor so ids stay
    // current across the beforeAll.
    function writeAttempts(sid: string): Array<[string, () => request.Test]> {
      return [
        ['PATCH inspection (status/storm/arrival)', () =>
          request(app).patch(`/api/inspections/${inspectionId}`).set(auth(sid)).send({ status: 'capturing' })],
        ['create slope', () =>
          request(app).post(`/api/inspections/${inspectionId}/slopes`).set(auth(sid)).send({ label: 'C0 slope' })],
        ['create elevation', () =>
          request(app).post(`/api/inspections/${inspectionId}/elevations`).set(auth(sid)).send({ direction: 'front' })],
        ['create damage instance', () =>
          request(app).post(`/api/inspections/${inspectionId}/damage-instances`).set(auth(sid)).send({ damageType: 'hail' })],
        ['create test square', () =>
          request(app).post(`/api/inspections/${inspectionId}/test-squares`).set(auth(sid)).send({ label: 'C0 TS' })],
        ['create test-square hit', () =>
          request(app).post(`/api/inspections/${inspectionId}/test-squares/${ownerTestSquareId}/hits`).set(auth(sid)).send({ hitType: 'hail_strike' })],
        ['create photo', () =>
          request(app).post(`/api/inspections/${inspectionId}/photos`).set(auth(sid)).send({ subjectType: 'inspection', url: 'https://example.test/c0.jpg', sha256: 'c'.repeat(64) })],
        ['create measurement', () =>
          request(app).post(`/api/inspections/${inspectionId}/measurements`).set(auth(sid)).send({ subjectType: 'slope', measurementType: 'length', value: 12 })],
        ['create attestation', () =>
          request(app).post(`/api/inspections/${inspectionId}/attestations`).set(auth(sid)).send({ stage: 'S2', signatureData: 'C0' })],
      ];
    }

    it('denies a same-company peer field_rep (403) on every inspection write path', async () => {
      for (const [name, run] of writeAttempts(inspectorA2.sid)) {
        const res = await run();
        expect(res.status, `peer must be forbidden: ${name}`).toBe(403);
      }
    });

    it('allows the owning inspector on every write path', async () => {
      for (const [name, run] of writeAttempts(inspectorA.sid)) {
        const res = await run();
        expect([200, 201], `owner must be allowed: ${name} (got ${res.status})`).toContain(res.status);
      }
    });

    it('allows a manager+ in the same company on every write path', async () => {
      for (const [name, run] of writeAttempts(managerA.sid)) {
        const res = await run();
        expect([200, 201], `manager must be allowed: ${name} (got ${res.status})`).toContain(res.status);
      }
    });
  });

  // C0: creation establishes ownership, so a field rep must not be able to
  // create an inspection owned by (or assigned to) someone else. Assignment is
  // a manager+ action, and the assignee must be in the actor's company.
  describe('C0 create-assignment policy', () => {
    it('lets a field rep create an inspection owned by themselves (explicit self)', async () => {
      const res = await request(app)
        .post('/api/inspections')
        .set(auth(inspectorA2.sid))
        .send({ inspectorUserId: inspectorA2.userId, claimNumber: 'CLM-SELF' });
      expect(res.status).toBe(201);
      expect(res.body.inspection.inspectorUserId).toBe(inspectorA2.userId);
    });

    it('forbids a field rep from creating an inspection assigned to another user (403)', async () => {
      const res = await request(app)
        .post('/api/inspections')
        .set(auth(inspectorA2.sid))
        .send({ inspectorUserId: inspectorA.userId, claimNumber: 'CLM-SPOOF' });
      expect(res.status).toBe(403);
    });

    it('lets a manager assign a new inspection to another user in the company', async () => {
      const res = await request(app)
        .post('/api/inspections')
        .set(auth(managerA.sid))
        .send({ inspectorUserId: inspectorA.userId, claimNumber: 'CLM-ASSIGN' });
      expect(res.status).toBe(201);
      expect(res.body.inspection.inspectorUserId).toBe(inspectorA.userId);
    });

    it('rejects assigning a new inspection to a user outside the company (400)', async () => {
      const res = await request(app)
        .post('/api/inspections')
        .set(auth(managerA.sid))
        .send({ inspectorUserId: inspectorB.userId, claimNumber: 'CLM-XCO' });
      expect(res.status).toBe(400);
    });
  });

  // M-C: the detail endpoint hydrates child arrays (so the mobile app reads
  // capture state without new endpoints), and child creates are idempotent by
  // client-supplied id so an offline outbox can safely replay them.
  describe('M-C detail hydration + child-create idempotency', () => {
    it('hydrates slopes, elevations, damage instances, and photos on GET /:id', async () => {
      const create = await request(app)
        .post('/api/inspections')
        .set(auth(inspectorA.sid))
        .send({ claimNumber: 'CLM-MC-DETAIL' });
      const inspectionId = create.body.inspection.id as string;

      const slope = await request(app)
        .post(`/api/inspections/${inspectionId}/slopes`)
        .set(auth(inspectorA.sid))
        .send({ label: 'Detail slope' });
      const slopeId = slope.body.slope.id as string;
      await request(app)
        .post(`/api/inspections/${inspectionId}/elevations`)
        .set(auth(inspectorA.sid))
        .send({ direction: 'front' });
      await request(app)
        .post(`/api/inspections/${inspectionId}/damage-instances`)
        .set(auth(inspectorA.sid))
        .send({ damageType: 'hail' });
      await request(app)
        .post(`/api/inspections/${inspectionId}/photos`)
        .set(auth(inspectorA.sid))
        .send({
          subjectType: 'slope',
          subjectId: slopeId,
          triadRole: 'wide',
          stage: 'S3',
          url: 'https://example.test/mc.jpg',
          sha256: 'd'.repeat(64),
        });

      const detail = await request(app)
        .get(`/api/inspections/${inspectionId}`)
        .set(auth(inspectorA.sid));
      expect(detail.status).toBe(200);
      expect(detail.body.inspection.slopes).toHaveLength(1);
      expect(detail.body.inspection.elevations).toHaveLength(1);
      expect(detail.body.inspection.damageInstances).toHaveLength(1);
      expect(detail.body.inspection.photos).toHaveLength(1);
      expect(detail.body.inspection.photos[0].stage).toBe('S3');
    });

    it('returns the existing child (200) on a retried create with the same client id', async () => {
      const create = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const inspectionId = create.body.inspection.id as string;

      const elevId = `elev-${RUN_ID}-idem`;
      const elevBody = { id: elevId, direction: 'front' };
      const elevFirst = await request(app)
        .post(`/api/inspections/${inspectionId}/elevations`)
        .set(auth(inspectorA.sid))
        .send(elevBody);
      expect(elevFirst.status).toBe(201);
      expect(elevFirst.body.elevation.id).toBe(elevId);
      const elevRetry = await request(app)
        .post(`/api/inspections/${inspectionId}/elevations`)
        .set(auth(inspectorA.sid))
        .send(elevBody);
      expect(elevRetry.status).toBe(200);
      expect(elevRetry.body.elevation.id).toBe(elevId);

      const slopeId = `slope-${RUN_ID}-idem`;
      const slopeBody = { id: slopeId, label: 'Idem slope' };
      const slopeFirst = await request(app)
        .post(`/api/inspections/${inspectionId}/slopes`)
        .set(auth(inspectorA.sid))
        .send(slopeBody);
      expect(slopeFirst.status).toBe(201);
      const slopeRetry = await request(app)
        .post(`/api/inspections/${inspectionId}/slopes`)
        .set(auth(inspectorA.sid))
        .send(slopeBody);
      expect(slopeRetry.status).toBe(200);
      expect(slopeRetry.body.slope.id).toBe(slopeId);

      const dmgId = `dmg-${RUN_ID}-idem`;
      const dmgBody = { id: dmgId, damageType: 'hail' };
      const dmgFirst = await request(app)
        .post(`/api/inspections/${inspectionId}/damage-instances`)
        .set(auth(inspectorA.sid))
        .send(dmgBody);
      expect(dmgFirst.status).toBe(201);
      const dmgRetry = await request(app)
        .post(`/api/inspections/${inspectionId}/damage-instances`)
        .set(auth(inspectorA.sid))
        .send(dmgBody);
      expect(dmgRetry.status).toBe(200);
      expect(dmgRetry.body.damageInstance.id).toBe(dmgId);
    });

    it('409s when a client id collides with a row in another company (never leaks it)', async () => {
      // Seed the id under company B.
      const createB = await request(app).post('/api/inspections').set(auth(inspectorB.sid)).send({});
      const inspectionBId = createB.body.inspection.id as string;
      const collidingId = `elev-${RUN_ID}-collision`;
      const seedB = await request(app)
        .post(`/api/inspections/${inspectionBId}/elevations`)
        .set(auth(inspectorB.sid))
        .send({ id: collidingId, direction: 'front' });
      expect(seedB.status).toBe(201);

      // Company A replays the same id: the global unique constraint blocks the
      // insert, and the company-scoped lookup can't see B's row, so it 409s
      // rather than returning another tenant's record.
      const createA = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const inspectionAId = createA.body.inspection.id as string;
      const collide = await request(app)
        .post(`/api/inspections/${inspectionAId}/elevations`)
        .set(auth(inspectorA.sid))
        .send({ id: collidingId, direction: 'front' });
      expect(collide.status).toBe(409);
    });

    it('409s when a client id is reused on a different inspection in the same company', async () => {
      const first = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const second = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const slopeId = `slope-${RUN_ID}-xinsp`;
      const seed = await request(app)
        .post(`/api/inspections/${first.body.inspection.id}/slopes`)
        .set(auth(inspectorA.sid))
        .send({ id: slopeId, label: 'Owned slope' });
      expect(seed.status).toBe(201);

      // Same tenant, same id, different inspection: must not silently return
      // the other inspection's row — the conflict lookup is inspection-scoped.
      const collide = await request(app)
        .post(`/api/inspections/${second.body.inspection.id}/slopes`)
        .set(auth(inspectorA.sid))
        .send({ id: slopeId, label: 'Colliding slope' });
      expect(collide.status).toBe(409);
    });

    it('replays a full offline mini-pass twice with no duplicates (force-quit / re-drain)', async () => {
      // Field-test B, off-device half: the outbox persists queued writes and
      // drains them on reconnect. If the app is force-quit mid-drain (or a
      // response is lost after commit), the SAME batch — same client ids —
      // drains again. This asserts the second drain is a no-op: every create
      // returns the existing row (200) and GET /:id counts don't budge.
      const create = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const inspectionId = create.body.inspection.id as string;
      const elevId = `elev-${RUN_ID}-mp`;
      const slopeId = `slope-${RUN_ID}-mp`;
      const dmgId = `dmg-${RUN_ID}-mp`;

      const batch: Array<{ path: string; body: Record<string, unknown> }> = [
        { path: `/api/inspections/${inspectionId}/elevations`, body: { id: elevId, direction: 'front' } },
        { path: `/api/inspections/${inspectionId}/slopes`, body: { id: slopeId, label: 'Mini-pass slope' } },
        { path: `/api/inspections/${inspectionId}/damage-instances`, body: { id: dmgId, slopeId, damageType: 'hail' } },
        { path: `/api/inspections/${inspectionId}/photos`, body: { id: `p-${RUN_ID}-elev`, subjectType: 'elevation', subjectId: elevId, triadRole: 'wide', stage: 'S1', url: 'https://example.test/e.jpg', sha256: '1'.repeat(64) } },
        { path: `/api/inspections/${inspectionId}/photos`, body: { id: `p-${RUN_ID}-roof`, subjectType: 'inspection', triadRole: 'wide', stage: 'S2', url: 'https://example.test/r.jpg', sha256: '2'.repeat(64) } },
        { path: `/api/inspections/${inspectionId}/photos`, body: { id: `p-${RUN_ID}-slope`, subjectType: 'slope', subjectId: slopeId, triadRole: 'wide', stage: 'S3', url: 'https://example.test/s.jpg', sha256: '3'.repeat(64) } },
        { path: `/api/inspections/${inspectionId}/photos`, body: { id: `p-${RUN_ID}-dw`, subjectType: 'damage_instance', subjectId: dmgId, triadRole: 'wide', stage: 'S5', url: 'https://example.test/dw.jpg', sha256: '4'.repeat(64) } },
        { path: `/api/inspections/${inspectionId}/photos`, body: { id: `p-${RUN_ID}-dm`, subjectType: 'damage_instance', subjectId: dmgId, triadRole: 'mid', stage: 'S5', url: 'https://example.test/dm.jpg', sha256: '5'.repeat(64) } },
        { path: `/api/inspections/${inspectionId}/photos`, body: { id: `p-${RUN_ID}-dc`, subjectType: 'damage_instance', subjectId: dmgId, triadRole: 'close', stage: 'S5', url: 'https://example.test/dc.jpg', sha256: '6'.repeat(64) } },
      ];

      // Drain in queue order (sequential), mirroring the outbox: FK-dependent
      // items (damage -> slope) must replay after their parent, not racing it.
      const drain = async () => {
        const statuses: number[] = [];
        for (const item of batch) {
          const res = await request(app).post(item.path).set(auth(inspectorA.sid)).send(item.body);
          statuses.push(res.status);
        }
        return statuses;
      };

      const first = await drain();
      expect(first).toEqual(batch.map(() => 201));

      const second = await drain();
      expect(second).toEqual(batch.map(() => 200));

      const detail = await request(app)
        .get(`/api/inspections/${inspectionId}`)
        .set(auth(inspectorA.sid));
      const insp = detail.body.inspection;
      expect(insp.elevations).toHaveLength(1);
      expect(insp.slopes).toHaveLength(1);
      expect(insp.damageInstances).toHaveLength(1);
      expect(insp.photos.filter((p: { id: string }) => p.id.startsWith(`p-${RUN_ID}-`))).toHaveLength(6);
    });

    it('creates photos idempotently by client id (retry-safe evidence writes)', async () => {
      const create = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const inspectionId = create.body.inspection.id as string;
      const photoId = `photo-${RUN_ID}-idem`;
      const body = {
        id: photoId,
        subjectType: 'inspection',
        stage: 'S2',
        triadRole: 'wide',
        url: 'https://example.test/idem.jpg',
        sha256: 'e'.repeat(64),
      };

      const first = await request(app)
        .post(`/api/inspections/${inspectionId}/photos`)
        .set(auth(inspectorA.sid))
        .send(body);
      expect(first.status).toBe(201);
      expect(first.body.photo.id).toBe(photoId);

      // A replayed outbox item (e.g. upload response lost after commit) must
      // return the existing evidence row, not duplicate it.
      const retry = await request(app)
        .post(`/api/inspections/${inspectionId}/photos`)
        .set(auth(inspectorA.sid))
        .send(body);
      expect(retry.status).toBe(200);
      expect(retry.body.photo.id).toBe(photoId);

      const detail = await request(app)
        .get(`/api/inspections/${inspectionId}`)
        .set(auth(inspectorA.sid));
      const matching = (detail.body.inspection.photos as Array<{ id: string }>).filter(
        (p) => p.id === photoId,
      );
      expect(matching).toHaveLength(1);
    });
  });

  // M-D: test squares (S4), classified hits, the inaccessible-slope escape
  // hatch (D2), orphan-photo prevention (D4), and the D0 attestation-scope fix.
  describe('M-D test squares, hits, inaccessible slopes & orphan guard', () => {
    it('creates a test square and hit idempotently, and hydrates them on GET /:id', async () => {
      const create = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const inspectionId = create.body.inspection.id as string;

      const tsId = `ts-${RUN_ID}-idem`;
      const tsBody = { id: tsId, label: 'S4 square' };
      const tsFirst = await request(app)
        .post(`/api/inspections/${inspectionId}/test-squares`)
        .set(auth(inspectorA.sid))
        .send(tsBody);
      expect(tsFirst.status).toBe(201);
      expect(tsFirst.body.testSquare.id).toBe(tsId);
      const tsRetry = await request(app)
        .post(`/api/inspections/${inspectionId}/test-squares`)
        .set(auth(inspectorA.sid))
        .send(tsBody);
      expect(tsRetry.status).toBe(200);
      expect(tsRetry.body.testSquare.id).toBe(tsId);

      const hitId = `hit-${RUN_ID}-idem`;
      const hitBody = { id: hitId, hitType: 'hail_strike' };
      const hitFirst = await request(app)
        .post(`/api/inspections/${inspectionId}/test-squares/${tsId}/hits`)
        .set(auth(inspectorA.sid))
        .send(hitBody);
      expect(hitFirst.status).toBe(201);
      expect(hitFirst.body.hit.hitType).toBe('hail_strike');
      const hitRetry = await request(app)
        .post(`/api/inspections/${inspectionId}/test-squares/${tsId}/hits`)
        .set(auth(inspectorA.sid))
        .send(hitBody);
      expect(hitRetry.status).toBe(200);
      expect(hitRetry.body.hit.id).toBe(hitId);

      const detail = await request(app).get(`/api/inspections/${inspectionId}`).set(auth(inspectorA.sid));
      expect(detail.status).toBe(200);
      expect(detail.body.inspection.testSquares).toHaveLength(1);
      // The counter must not double after the retry.
      expect(detail.body.inspection.testSquareHits).toHaveLength(1);
    });

    it('rejects a hit outside the controlled vocabulary (400)', async () => {
      const create = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const inspectionId = create.body.inspection.id as string;
      const ts = await request(app)
        .post(`/api/inspections/${inspectionId}/test-squares`)
        .set(auth(inspectorA.sid))
        .send({ label: 'Vocab square' });
      const bad = await request(app)
        .post(`/api/inspections/${inspectionId}/test-squares/${ts.body.testSquare.id}/hits`)
        .set(auth(inspectorA.sid))
        .send({ hitType: 'impact' });
      expect(bad.status).toBe(400);
    });

    it('409s when a hit client id is reused under a different square (parent-scoped)', async () => {
      const create = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const inspectionId = create.body.inspection.id as string;
      const tsA = await request(app)
        .post(`/api/inspections/${inspectionId}/test-squares`)
        .set(auth(inspectorA.sid))
        .send({ label: 'Square A' });
      const tsB = await request(app)
        .post(`/api/inspections/${inspectionId}/test-squares`)
        .set(auth(inspectorA.sid))
        .send({ label: 'Square B' });
      const hitId = `hit-${RUN_ID}-xsquare`;
      const seed = await request(app)
        .post(`/api/inspections/${inspectionId}/test-squares/${tsA.body.testSquare.id}/hits`)
        .set(auth(inspectorA.sid))
        .send({ id: hitId, hitType: 'mechanical' });
      expect(seed.status).toBe(201);
      // Same id, different parent square: must not silently return the other
      // square's hit — the conflict lookup is testSquareId-scoped.
      const collide = await request(app)
        .post(`/api/inspections/${inspectionId}/test-squares/${tsB.body.testSquare.id}/hits`)
        .set(auth(inspectorA.sid))
        .send({ id: hitId, hitType: 'mechanical' });
      expect(collide.status).toBe(409);
    });

    it('409s when an attestation client id is reused on a different inspection (D0)', async () => {
      const first = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const second = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const attId = `att-${RUN_ID}-xinsp`;
      const seed = await request(app)
        .post(`/api/inspections/${first.body.inspection.id}/attestations`)
        .set(auth(inspectorA.sid))
        .send({ id: attId, stage: 'S4', attestationType: 'stage_signoff', details: { kind: 'inaccessible_slope', slopeId: 's', reason: 'steep' } });
      expect(seed.status).toBe(201);
      // Before D0 the re-select was only id+company, so this replay leaked the
      // other inspection's attestation as a 200. It must 409.
      const collide = await request(app)
        .post(`/api/inspections/${second.body.inspection.id}/attestations`)
        .set(auth(inspectorA.sid))
        .send({ id: attId, stage: 'S4', attestationType: 'stage_signoff', details: {} });
      expect(collide.status).toBe(409);
    });

    it('documents an inaccessible slope as an S4 attestation and hydrates it', async () => {
      const create = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const inspectionId = create.body.inspection.id as string;
      const slope = await request(app)
        .post(`/api/inspections/${inspectionId}/slopes`)
        .set(auth(inspectorA.sid))
        .send({ label: 'Steep slope' });
      const att = await request(app)
        .post(`/api/inspections/${inspectionId}/attestations`)
        .set(auth(inspectorA.sid))
        .send({
          stage: 'S4',
          attestationType: 'stage_signoff',
          details: { kind: 'inaccessible_slope', slopeId: slope.body.slope.id, reason: 'Too steep to walk safely' },
        });
      expect(att.status).toBe(201);

      const detail = await request(app).get(`/api/inspections/${inspectionId}`).set(auth(inspectorA.sid));
      const hydrated = detail.body.inspection.attestations as Array<{ stage: string; details: { kind?: string } }>;
      expect(hydrated.some((a) => a.stage === 'S4' && a.details?.kind === 'inaccessible_slope')).toBe(true);
    });

    it('rejects a subject-attached photo with no subjectId (D4 orphan guard)', async () => {
      const create = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const inspectionId = create.body.inspection.id as string;

      // A test-square photo with no subjectId would be an orphan — rejected.
      const orphan = await request(app)
        .post(`/api/inspections/${inspectionId}/photos`)
        .set(auth(inspectorA.sid))
        .send({ subjectType: 'test_square', triadRole: 'wide', stage: 'S4', url: 'https://example.test/o.jpg', sha256: '7'.repeat(64) });
      expect(orphan.status).toBe(400);

      // A whole-inspection photo legitimately has no subjectId — allowed.
      const rootPhoto = await request(app)
        .post(`/api/inspections/${inspectionId}/photos`)
        .set(auth(inspectorA.sid))
        .send({ subjectType: 'inspection', triadRole: 'wide', stage: 'S2', url: 'https://example.test/root.jpg', sha256: '8'.repeat(64) });
      expect(rootPhoto.status).toBe(201);
    });

    it('replays a full S4 offline pass twice with no duplicates (square + overview + hit + close-up)', async () => {
      const create = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const inspectionId = create.body.inspection.id as string;
      const tsId = `ts-${RUN_ID}-op`;
      const hitId = `hit-${RUN_ID}-op`;

      const batch: Array<{ path: string; body: Record<string, unknown> }> = [
        { path: `/api/inspections/${inspectionId}/test-squares`, body: { id: tsId, label: 'Offline square' } },
        { path: `/api/inspections/${inspectionId}/photos`, body: { id: `p-${RUN_ID}-ov`, subjectType: 'test_square', subjectId: tsId, triadRole: 'wide', stage: 'S4', url: 'https://example.test/ov.jpg', sha256: 'a'.repeat(64) } },
        { path: `/api/inspections/${inspectionId}/test-squares/${tsId}/hits`, body: { id: hitId, hitType: 'hail_strike' } },
        { path: `/api/inspections/${inspectionId}/photos`, body: { id: `p-${RUN_ID}-cu`, subjectType: 'test_square_hit', subjectId: hitId, triadRole: 'close', stage: 'S4', url: 'https://example.test/cu.jpg', sha256: 'b'.repeat(64) } },
      ];

      const drain = async () => {
        const statuses: number[] = [];
        for (const item of batch) {
          const res = await request(app).post(item.path).set(auth(inspectorA.sid)).send(item.body);
          statuses.push(res.status);
        }
        return statuses;
      };

      expect(await drain()).toEqual(batch.map(() => 201));
      // Force-quit mid-drain: the same client ids replay and must all be no-ops.
      expect(await drain()).toEqual(batch.map(() => 200));

      const detail = await request(app).get(`/api/inspections/${inspectionId}`).set(auth(inspectorA.sid));
      const insp = detail.body.inspection;
      expect(insp.testSquares).toHaveLength(1);
      expect(insp.testSquareHits).toHaveLength(1);
      const s4Photos = (insp.photos as Array<{ id: string; sha256: string }>).filter((p) => p.id.startsWith(`p-${RUN_ID}-`));
      expect(s4Photos).toHaveLength(2);
      // Hashes are captured at shoot time and survive the replay unchanged.
      expect(s4Photos.find((p) => p.id === `p-${RUN_ID}-ov`)?.sha256).toBe('a'.repeat(64));
      expect(s4Photos.find((p) => p.id === `p-${RUN_ID}-cu`)?.sha256).toBe('b'.repeat(64));
    });
  });

  describe('M-C C4/C5 components, penetrations & products', () => {
    it('creates components, penetrations, and products and hydrates them on GET /:id', async () => {
      const create = await request(app)
        .post('/api/inspections')
        .set(auth(inspectorA.sid))
        .send({ claimNumber: 'CLM-C4C5' });
      const inspectionId = create.body.inspection.id as string;

      const component = await request(app)
        .post(`/api/inspections/${inspectionId}/components`)
        .set(auth(inspectorA.sid))
        .send({ componentType: 'drip_edge', status: 'present' });
      expect(component.status).toBe(201);
      expect(component.body.component.componentType).toBe('drip_edge');
      expect(component.body.component.status).toBe('present');

      const layer = await request(app)
        .post(`/api/inspections/${inspectionId}/components`)
        .set(auth(inspectorA.sid))
        .send({ componentType: 'layer_count', layerCount: 2 });
      expect(layer.status).toBe(201);
      expect(layer.body.component.layerCount).toBe(2);

      const penetration = await request(app)
        .post(`/api/inspections/${inspectionId}/penetrations`)
        .set(auth(inspectorA.sid))
        .send({ penetrationType: 'plumbing_vent', flashingCondition: 'Sealed' });
      expect(penetration.status).toBe(201);
      expect(penetration.body.penetration.penetrationType).toBe('plumbing_vent');

      const product = await request(app)
        .post(`/api/inspections/${inspectionId}/products`)
        .set(auth(inspectorA.sid))
        .send({ identificationMethod: 'unidentifiable', unidentifiableReason: 'No markings' });
      expect(product.status).toBe(201);
      expect(product.body.product.identificationMethod).toBe('unidentifiable');

      const detail = await request(app)
        .get(`/api/inspections/${inspectionId}`)
        .set(auth(inspectorA.sid));
      expect(detail.status).toBe(200);
      expect(detail.body.inspection.components).toHaveLength(2);
      expect(detail.body.inspection.penetrations).toHaveLength(1);
      expect(detail.body.inspection.products).toHaveLength(1);
    });

    it('denies a same-company peer field_rep (403) on every C4/C5 write path', async () => {
      const create = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const inspectionId = create.body.inspection.id as string;

      const attempts: Array<[string, request.Test]> = [
        [
          'components',
          request(app)
            .post(`/api/inspections/${inspectionId}/components`)
            .set(auth(inspectorA2.sid))
            .send({ componentType: 'decking', status: 'present' }),
        ],
        [
          'penetrations',
          request(app)
            .post(`/api/inspections/${inspectionId}/penetrations`)
            .set(auth(inspectorA2.sid))
            .send({ penetrationType: 'chimney' }),
        ],
        [
          'products',
          request(app)
            .post(`/api/inspections/${inspectionId}/products`)
            .set(auth(inspectorA2.sid))
            .send({ identificationMethod: 'field_identified', brand: 'GAF' }),
        ],
      ];
      for (const [name, req] of attempts) {
        const res = await req;
        expect(res.status, `peer must be forbidden: ${name}`).toBe(403);
      }
    });

    it('returns the existing row (200) on a retried create with the same client id', async () => {
      const create = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const inspectionId = create.body.inspection.id as string;

      const compId = `comp-${RUN_ID}-idem`;
      const compBody = { id: compId, componentType: 'ventilation', status: 'present' };
      expect(
        (await request(app).post(`/api/inspections/${inspectionId}/components`).set(auth(inspectorA.sid)).send(compBody)).status,
      ).toBe(201);
      const compRetry = await request(app)
        .post(`/api/inspections/${inspectionId}/components`)
        .set(auth(inspectorA.sid))
        .send(compBody);
      expect(compRetry.status).toBe(200);
      expect(compRetry.body.component.id).toBe(compId);

      const prodId = `prod-${RUN_ID}-idem`;
      const prodBody = { id: prodId, identificationMethod: 'itel_sample', itelSampleRef: 'Bag #7' };
      expect(
        (await request(app).post(`/api/inspections/${inspectionId}/products`).set(auth(inspectorA.sid)).send(prodBody)).status,
      ).toBe(201);
      const prodRetry = await request(app)
        .post(`/api/inspections/${inspectionId}/products`)
        .set(auth(inspectorA.sid))
        .send(prodBody);
      expect(prodRetry.status).toBe(200);
      expect(prodRetry.body.product.id).toBe(prodId);
    });

    it('409s when a component client id is reused on a different inspection in the same company', async () => {
      const first = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const second = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const penId = `pen-${RUN_ID}-xinsp`;
      const seed = await request(app)
        .post(`/api/inspections/${first.body.inspection.id}/penetrations`)
        .set(auth(inspectorA.sid))
        .send({ id: penId, penetrationType: 'skylight' });
      expect(seed.status).toBe(201);

      const collide = await request(app)
        .post(`/api/inspections/${second.body.inspection.id}/penetrations`)
        .set(auth(inspectorA.sid))
        .send({ id: penId, penetrationType: 'skylight' });
      expect(collide.status).toBe(409);
    });
  });
});
