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
  role: 'field_rep' | 'super_admin',
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
    canvasserA = await seedUser('canvasser-a', 'field_rep', 'canvasser', companyA);
    superAdminB = await seedUser('super-admin-b', 'super_admin', 'canvasser', companyB);
    inspectorB = await seedUser('inspector-b', 'field_rep', 'inspector_canvasser', companyB);
    userIds.push(inspectorA.userId, canvasserA.userId, superAdminB.userId, inspectorB.userId);
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
      .send({ hitType: 'impact' });
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
});
