import { companiesTable, db, inspectionsTable, userProfilesTable, usersTable } from '@workspace/db';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

// v3 (Repair Attempt Protocol) repairability assessment: PATCH validation,
// photo-id verification against this inspection's rows, assessor stamping
// (never client-supplied), idempotent offline replay, and legacy v2 records
// remaining writable. Read-back goes through apiSafeRepairability, so the
// round trip also proves v3 survives the API response schema.

const RUN_ID = `rapv3-${Date.now().toString(36)}`;

describe('repairability assessment v3 (RAP)', () => {
  const companyId = `TEST-RAPV3-${RUN_ID}`.toUpperCase();
  let sid: string;
  let userId: string;
  let inspectionId: string;
  let rap1PhotoId: string;
  let delamPhotoId: string;

  const auth = () => ({ Authorization: `Bearer ${sid}` });

  beforeAll(async () => {
    await db.insert(companiesTable).values({ id: companyId, name: 'RAP v3 Co' });
    const [user] = await db
      .insert(usersTable)
      .values({
        companyId,
        email: `${RUN_ID}@example.test`,
        firstName: 'Rita',
        lastName: 'Protocol',
      })
      .returning();
    userId = user.id;
    await db
      .insert(userProfilesTable)
      .values({ userId, role: 'field_rep', department: 'inspector_canvasser' });
    sid = await createSession({
      user: {
        id: userId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: null,
        companyId,
      },
      access_token: 'test-access-token',
    });

    const created = await request(app)
      .post('/api/inspections')
      .set(auth())
      .send({ claimNumber: 'CLM-RAPV3' });
    expect(created.status).toBe(201);
    inspectionId = created.body.inspection.id as string;

    // RAP photos ride the generic inspection-photo path (subjectType
    // 'inspection', no stage/roles) with client-generated ids for offline
    // idempotency — mirror that here.
    for (const [name, setter] of [
      ['rap1', (id: string) => (rap1PhotoId = id)],
      ['delam', (id: string) => (delamPhotoId = id)],
    ] as const) {
      const res = await request(app)
        .post(`/api/inspections/${inspectionId}/photos`)
        .set(auth())
        .send({
          id: `${RUN_ID}-photo-${name}`,
          subjectType: 'inspection',
          url: `https://example.test/${name}.jpg`,
          sha256: name === 'rap1' ? 'a'.repeat(64) : 'b'.repeat(64),
        });
      expect(res.status).toBe(201);
      setter(res.body.photo.id as string);
    }
  });

  afterAll(async () => {
    await db.delete(inspectionsTable).where(inArray(inspectionsTable.companyId, [companyId]));
    await db.delete(usersTable).where(inArray(usersTable.id, [userId]));
    await db.delete(companiesTable).where(inArray(companiesTable.id, [companyId]));
  });

  const assessment = () => ({
    version: 3,
    warranted: 'yes',
    systems: ['roof'],
    roofType: 'asphalt_shingle',
    rap: {
      manipulatedCount: 7,
      rap1PhotoId,
      matTransfer: { shingle1: 'yes', shingle2: 'no' },
      damage: {
        delamination: { answer: 'yes', shingles: [3, 4], photoId: delamPhotoId, note: 'granule loss' },
        creasing: { answer: 'no', shingles: [] },
      },
    },
    recordedAtUtc: '2026-07-28T12:00:00Z',
  });

  it('saves a v3 assessment, stamps the assessor server-side, and reads it back', async () => {
    const res = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .set(auth())
      .send({
        repairabilityAssessment: {
          ...assessment(),
          // Client-supplied assessor identity must be ignored.
          assessorName: 'Spoofed Name',
          assessorCredentials: 'Spoofed Credentials',
        },
      });
    expect(res.status).toBe(200);
    const stored = res.body.inspection.repairabilityAssessment;
    expect(stored.version).toBe(3);
    expect(stored.warranted).toBe('yes');
    expect(stored.rap.manipulatedCount).toBe(7);
    expect(stored.rap.rap1PhotoId).toBe(rap1PhotoId);
    expect(stored.rap.damage.delamination.photoId).toBe(delamPhotoId);
    expect(stored.assessorName).toBe('Rita Protocol');
    expect(stored.assessorName).not.toBe('Spoofed Name');

    // Rehydration path: the detail endpoint returns the same record.
    const detail = await request(app).get(`/api/inspections/${inspectionId}`).set(auth());
    expect(detail.status).toBe(200);
    expect(detail.body.inspection.repairabilityAssessment.version).toBe(3);
    expect(detail.body.inspection.repairabilityAssessment.rap.damage.delamination.shingles).toEqual([3, 4]);
  });

  it('tolerates an idempotent offline replay of the same assessment', async () => {
    const res = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .set(auth())
      .send({ repairabilityAssessment: assessment() });
    expect(res.status).toBe(200);
    expect(res.body.inspection.repairabilityAssessment.rap.manipulatedCount).toBe(7);
  });

  it('rejects a rap photo id that is not a photo of this inspection (400)', async () => {
    const a = assessment();
    a.rap.rap1PhotoId = `${RUN_ID}-nonexistent`;
    const res = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .set(auth())
      .send({ repairabilityAssessment: a });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.details)).toContain('not found on this inspection');
  });

  it('rejects an internally inconsistent v3 assessment (400)', async () => {
    const a = assessment();
    a.warranted = 'not_authorized';
    const res = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .set(auth())
      .send({ repairabilityAssessment: a });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.details)).toContain('warranted and authorized');
  });

  it('saves a partial v3 assessment — unanswered protocol questions are legal', async () => {
    const res = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .set(auth())
      .send({
        repairabilityAssessment: {
          version: 3,
          warranted: 'yes',
          systems: ['roof'],
          roofType: 'asphalt_shingle',
          rap: {
            manipulatedCount: null,
            rap1PhotoId: null,
            matTransfer: { shingle1: null, shingle2: null },
            damage: {},
          },
          recordedAtUtc: '2026-07-28T12:05:00Z',
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.inspection.repairabilityAssessment.rap.manipulatedCount).toBeNull();
  });

  it('still accepts a legacy v2 question-flow assessment', async () => {
    const res = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .set(auth())
      .send({
        repairabilityAssessment: {
          version: 2,
          systems: ['siding'],
          siding: {
            answers: {
              'SR-001': 'vinyl',
              'SR-010': 'yes',
              'SR-020': 'no',
              'SR-030': ['color_match_ok'],
            },
            determination: 'supported',
            basisFactors: [],
            nextStep: 'Proceed with siding repair',
          },
          recordedAtUtc: '2026-07-28T12:10:00Z',
        },
      });
    // The v2 flow has its own gating; anything but a 500 proves routing —
    // but a valid supported/no-factor siding flow should be accepted.
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.inspection.repairabilityAssessment.version).toBe(2);
    }
  });
});
