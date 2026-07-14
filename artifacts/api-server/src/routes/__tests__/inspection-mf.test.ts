import {
  companiesTable,
  companyCrmConfigTable,
  db,
  inspectionAddendaTable,
  inspectionsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';
import {
  buildPassingInspection,
  manifestFor,
  setSignature,
  type PassingInspection,
} from './helpers/passingInspection';

// Phase M-F ("Brain v0") end-to-end proof through the real HTTP routes:
//   F0 signature-on-file (capture / apply / block submit without one)
//   F1 on-site pre-flight gate re-run (parity + peer-403)
//   F2 submit hardening (photo-hash verify, server gate re-run, record lock,
//      append-only addenda, idempotent replay)
//   F3 status + STUB package receipt
//   F4 CRM seam status (pending by default, never fabricated)
// plus tenant isolation and the "no bypass" guarantee on the new writes.

const RUN_ID = `mf-${Date.now().toString(36)}`;

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
    .values({ companyId, email: `${label}-${RUN_ID}@example.test` })
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

describe('Phase M-F — Brain v0 hardening', () => {
  const companyA = `${RUN_ID}-A`.toUpperCase();
  const companyB = `${RUN_ID}-B`.toUpperCase();
  let inspectorA: SeededUser;
  let peerA: SeededUser;
  let managerA: SeededUser;
  let inspectorB: SeededUser;
  const userIds: string[] = [];

  beforeAll(async () => {
    await db.insert(companiesTable).values([
      { id: companyA, name: 'MF Co A' },
      { id: companyB, name: 'MF Co B' },
    ]);
    inspectorA = await seedUser('mf-insp-a', 'field_rep', 'inspector_canvasser', companyA);
    peerA = await seedUser('mf-peer-a', 'field_rep', 'inspector_canvasser', companyA);
    managerA = await seedUser('mf-mgr-a', 'manager', 'inspector_canvasser', companyA);
    inspectorB = await seedUser('mf-insp-b', 'field_rep', 'inspector_canvasser', companyB);
    userIds.push(inspectorA.userId, peerA.userId, managerA.userId, inspectorB.userId);
  });

  afterAll(async () => {
    await db.delete(companyCrmConfigTable).where(inArray(companyCrmConfigTable.companyId, [companyA, companyB]));
    const insp = await db
      .select({ id: inspectionsTable.id })
      .from(inspectionsTable)
      .where(inArray(inspectionsTable.companyId, [companyA, companyB]));
    if (insp.length > 0) {
      await db.delete(inspectionAddendaTable).where(
        inArray(inspectionAddendaTable.inspectionId, insp.map((i) => i.id)),
      );
    }
    await db.delete(inspectionsTable).where(inArray(inspectionsTable.companyId, [companyA, companyB]));
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    await db.delete(companiesTable).where(inArray(companiesTable.id, [companyA, companyB]));
  });

  // ---- F0: signature-on-file ----
  describe('F0 signature-on-file', () => {
    it('captures a signature on the profile and stamps signedAt server-side', async () => {
      const before = await request(app).get('/api/profile/me').set(auth(managerA.sid));
      expect(before.body.profile.signatureUrl).toBeNull();

      const res = await setSignature(managerA.sid, 'a');
      expect(res.status).toBe(200);
      expect(res.body.profile.signatureUrl).toContain('sig-a');
      expect(res.body.profile.signatureSignedAt).not.toBeNull();

      const after = await request(app).get('/api/profile/me').set(auth(managerA.sid));
      expect(after.body.profile.signatureSha256).toBe('a'.repeat(64));
    });

    it('blocks submission (422 signature_required) when the inspector has no signature on file', async () => {
      // inspectorA has not set a signature yet at this point.
      const p = await buildPassingInspection(inspectorA.sid);
      const res = await request(app)
        .post(`/api/inspections/${p.inspectionId}/submission`)
        .set(auth(inspectorA.sid))
        .send({ manifest: manifestFor(p) });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('signature_required');
    });
  });

  // ---- F2: submit hardening ----
  describe('F2 submit hardening', () => {
    it('rejects a manifest whose photo hash does not match stored evidence (422 photo_hash_mismatch)', async () => {
      await setSignature(inspectorA.sid, 'b');
      const p = await buildPassingInspection(inspectorA.sid);
      const tampered = manifestFor(p);
      tampered.photoHashes[0] = { photoId: tampered.photoHashes[0].photoId, sha256: 'f'.repeat(64) };

      const res = await request(app)
        .post(`/api/inspections/${p.inspectionId}/submission`)
        .set(auth(inspectorA.sid))
        .send({ manifest: tampered });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('photo_hash_mismatch');
    });

    it('rejects an incomplete inspection on the server gate re-run (422 gate_deficiencies)', async () => {
      const create = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const inspectionId = create.body.inspection.id as string;
      const res = await request(app)
        .post(`/api/inspections/${inspectionId}/submission`)
        .set(auth(inspectorA.sid))
        .send({
          manifest: {
            protocolVersion: 'v1',
            generatedAtUtc: new Date().toISOString(),
            records: {},
            photoHashes: [],
            gateResults: { deficiencies: [], softFlags: [] },
          },
        });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('gate_deficiencies');
      expect(res.body.deficiencies.length).toBeGreaterThan(0);
    });

    it('submits a complete + signed inspection, locks it, and stamps the on-file signature onto the manifest', async () => {
      await setSignature(inspectorA.sid, 'c');
      const p = await buildPassingInspection(inspectorA.sid);
      const res = await request(app)
        .post(`/api/inspections/${p.inspectionId}/submission`)
        .set(auth(inspectorA.sid))
        .send({ manifest: manifestFor(p) });
      expect(res.status).toBe(200);
      expect(res.body.inspection.status).toBe('submitted');
      expect(res.body.inspection.lockedAt).not.toBeNull();

      // The server stamped the authoritative on-file signature into the manifest.
      const status = await request(app)
        .get(`/api/inspections/${p.inspectionId}/status`)
        .set(auth(inspectorA.sid));
      expect(status.body.submissionManifest.signatureOnFile.sha256).toBe('c'.repeat(64));
    });

    it('rejects a normal child write on a locked record (409) but replays submission idempotently (200)', async () => {
      await setSignature(inspectorA.sid, 'd');
      const p = await buildPassingInspection(inspectorA.sid);
      await request(app)
        .post(`/api/inspections/${p.inspectionId}/submission`)
        .set(auth(inspectorA.sid))
        .send({ manifest: manifestFor(p) })
        .expect(200);

      const lockedWrite = await request(app)
        .post(`/api/inspections/${p.inspectionId}/slopes`)
        .set(auth(inspectorA.sid))
        .send({ label: 'Post-lock slope' });
      expect(lockedWrite.status).toBe(409);

      const replay = await request(app)
        .post(`/api/inspections/${p.inspectionId}/submission`)
        .set(auth(inspectorA.sid))
        .send({ manifest: manifestFor(p) });
      expect(replay.status).toBe(200);
      expect(replay.body.inspection.status).toBe('submitted');
    });

    it('forbids an addendum before the record is locked (409 inspection_not_locked)', async () => {
      const create = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const res = await request(app)
        .post(`/api/inspections/${create.body.inspection.id}/addenda`)
        .set(auth(inspectorA.sid))
        .send({ body: 'Premature correction before lock.' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('inspection_not_locked');
    });

    it('allows an append-only addendum on a locked record, idempotent by client id', async () => {
      await setSignature(inspectorA.sid, 'e');
      const p = await buildPassingInspection(inspectorA.sid);
      await request(app)
        .post(`/api/inspections/${p.inspectionId}/submission`)
        .set(auth(inspectorA.sid))
        .send({ manifest: manifestFor(p) })
        .expect(200);

      const addId = `add-${RUN_ID}-1`;
      const first = await request(app)
        .post(`/api/inspections/${p.inspectionId}/addenda`)
        .set(auth(inspectorA.sid))
        .send({ id: addId, body: 'Correction: north slope pitch is 7/12.' });
      expect(first.status).toBe(201);

      const retry = await request(app)
        .post(`/api/inspections/${p.inspectionId}/addenda`)
        .set(auth(inspectorA.sid))
        .send({ id: addId, body: 'Correction: north slope pitch is 7/12.' });
      expect(retry.status).toBe(200);
      expect(retry.body.addendum.id).toBe(addId);
    });
  });

  // ---- F1: pre-flight ----
  describe('F1 pre-flight gate re-run', () => {
    it('returns the same deficiencies the submission gate would (parity)', async () => {
      const create = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const inspectionId = create.body.inspection.id as string;
      const res = await request(app)
        .post(`/api/inspections/${inspectionId}/preflight`)
        .set(auth(inspectorA.sid));
      expect(res.status).toBe(200);
      expect(res.body.preflight.deficiencies.length).toBeGreaterThan(0);

      const p = await buildPassingInspection(inspectorA.sid);
      const clean = await request(app)
        .post(`/api/inspections/${p.inspectionId}/preflight`)
        .set(auth(inspectorA.sid));
      expect(clean.body.preflight.deficiencies).toHaveLength(0);
    });

    it('forbids a same-company peer (403) from pre-flighting a record they do not own', async () => {
      const create = await request(app).post('/api/inspections').set(auth(inspectorA.sid)).send({});
      const inspectionId = create.body.inspection.id as string;
      const res = await request(app)
        .post(`/api/inspections/${inspectionId}/preflight`)
        .set(auth(peerA.sid));
      expect(res.status).toBe(403);
    });
  });

  // ---- F3: status + stub receipt ----
  describe('F3 status & STUB receipt', () => {
    it('returns a clearly-labeled stub receipt once submitted, and null before', async () => {
      await setSignature(inspectorA.sid, '9');
      const p = await buildPassingInspection(inspectorA.sid);

      const pre = await request(app)
        .get(`/api/inspections/${p.inspectionId}/status`)
        .set(auth(inspectorA.sid));
      expect(pre.body.receipt).toBeNull();

      await request(app)
        .post(`/api/inspections/${p.inspectionId}/submission`)
        .set(auth(inspectorA.sid))
        .send({ manifest: manifestFor(p) })
        .expect(200);

      const post = await request(app)
        .get(`/api/inspections/${p.inspectionId}/status`)
        .set(auth(inspectorA.sid));
      expect(post.body.status).toBe('submitted');
      expect(post.body.receipt.isStub).toBe(true);
      expect(post.body.receipt.verifiedPhotoCount).toBe(p.photoHashes.length);
    });
  });

  // ---- F4: CRM seam ----
  describe('F4 CRM seam status', () => {
    it('reports every thread as pending by default and never fabricates a scheduled feed', async () => {
      const res = await request(app).get('/api/crm/status').set(auth(inspectorA.sid));
      expect(res.status).toBe(200);
      const values = Object.values(res.body.crm as Record<string, unknown>);
      expect(values.length).toBeGreaterThan(0);
      // Nothing is "active" without a provisioned per-tenant config.
      expect(JSON.stringify(res.body.crm)).not.toContain('"active"');

      const scheduled = await request(app)
        .get('/api/inspections/scheduled')
        .set(auth(inspectorA.sid));
      expect(scheduled.status).toBe(200);
      expect(scheduled.body.scheduled).toEqual([]);
    });
  });

  // ---- tenant isolation + no-bypass on the new surfaces ----
  describe('tenant isolation & no bypass on M-F surfaces', () => {
    it('never lets another company reach status, preflight, or addenda for a record', async () => {
      await setSignature(inspectorA.sid, '7');
      const p = await buildPassingInspection(inspectorA.sid);

      const crossStatus = await request(app)
        .get(`/api/inspections/${p.inspectionId}/status`)
        .set(auth(inspectorB.sid));
      expect(crossStatus.status).toBe(404);

      const crossPreflight = await request(app)
        .post(`/api/inspections/${p.inspectionId}/preflight`)
        .set(auth(inspectorB.sid));
      expect(crossPreflight.status).toBe(404);

      const crossAddendum = await request(app)
        .post(`/api/inspections/${p.inspectionId}/addenda`)
        .set(auth(inspectorB.sid))
        .send({ body: 'cross-tenant note' });
      expect(crossAddendum.status).toBe(404);
    });

    it('rejects unauthenticated access to the new endpoints (401)', async () => {
      await expect(request(app).get('/api/crm/status').then((r) => r.status)).resolves.toBe(401);
      await expect(
        request(app).patch('/api/profile/signature').send({}).then((r) => r.status),
      ).resolves.toBe(401);
    });
  });
});
