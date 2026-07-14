import request from 'supertest';
import { expect } from 'vitest';

import app from '../../../app';

// Shared test helpers for building an inspection that satisfies every hard gate
// (S0-S9), so the M-F server-side gate re-run passes and the record can actually
// be submitted and locked. Used by both the M-F suite and the core inspection
// suite, since Phase M-F made a full passing gate + signature-on-file a
// precondition of submission.

function auth(sid: string) {
  return { Authorization: `Bearer ${sid}` };
}

export async function setSignature(sid: string, seed: string) {
  return request(app)
    .patch('/api/profile/signature')
    .set(auth(sid))
    .send({
      signatureUrl: `https://example.test/sig-${seed}.png`,
      signatureSha256: seed.repeat(64).slice(0, 64),
    });
}

export interface PassingInspection {
  inspectionId: string;
  photoHashes: { photoId: string; sha256: string }[];
  recordIds: Record<string, string[]>;
}

export async function buildPassingInspection(sid: string): Promise<PassingInspection> {
  const create = await request(app).post('/api/inspections').set(auth(sid)).send({});
  const inspectionId = create.body.inspection.id as string;

  const photoHashes: { photoId: string; sha256: string }[] = [];
  let hashSeed = 0;
  const nextHash = () => {
    hashSeed += 1;
    return hashSeed.toString(16).padStart(64, '0');
  };

  async function addPhoto(body: Record<string, unknown>) {
    const sha256 = nextHash();
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/photos`)
      .set(auth(sid))
      .send({ url: `https://example.test/${nextHash()}.jpg`, sha256, ...body });
    expect(res.status, `photo create ${JSON.stringify(body)}`).toBe(201);
    photoHashes.push({ photoId: res.body.photo.id, sha256 });
    return res.body.photo.id as string;
  }

  // S0 overview + S2 roof access.
  await addPhoto({ subjectType: 'inspection', stage: 'S0', triadRole: 'wide' });
  await addPhoto({ subjectType: 'inspection', stage: 'S2', triadRole: 'wide' });

  // S1 — a wide photo for all four elevation directions.
  const elevationIds: string[] = [];
  for (const direction of ['front', 'right', 'back', 'left'] as const) {
    const elev = await request(app)
      .post(`/api/inspections/${inspectionId}/elevations`)
      .set(auth(sid))
      .send({ direction });
    expect(elev.status).toBe(201);
    elevationIds.push(elev.body.elevation.id);
    await addPhoto({ subjectType: 'elevation', subjectId: elev.body.elevation.id, triadRole: 'wide' });
  }

  // S3 — one slope with a wide photo.
  const slope = await request(app)
    .post(`/api/inspections/${inspectionId}/slopes`)
    .set(auth(sid))
    .send({ label: 'Front slope', pitchRise: 6, pitchRun: 12 });
  expect(slope.status).toBe(201);
  const slopeId = slope.body.slope.id as string;
  await addPhoto({ subjectType: 'slope', subjectId: slopeId, triadRole: 'wide' });

  // S4 — a test square for that slope with its overview photo.
  const square = await request(app)
    .post(`/api/inspections/${inspectionId}/test-squares`)
    .set(auth(sid))
    .send({ slopeId, label: 'TS-1', sizeSqFt: 100 });
  expect(square.status).toBe(201);
  const testSquareId = square.body.testSquare.id as string;
  await addPhoto({ subjectType: 'test_square', subjectId: testSquareId, triadRole: 'wide' });

  // S7 — at least one measurement (tied to the documented slope).
  const measurement = await request(app)
    .post(`/api/inspections/${inspectionId}/measurements`)
    .set(auth(sid))
    .send({ subjectType: 'slope', subjectId: slopeId, measurementType: 'length', value: 40, unit: 'ft' });
  expect(measurement.status).toBe(201);

  // S8 methodology/signature + S9 final review, as stage_signoff attestations.
  const s8 = await request(app)
    .post(`/api/inspections/${inspectionId}/attestations`)
    .set(auth(sid))
    .send({ stage: 'S8', attestationType: 'stage_signoff', signatureData: 'x' });
  expect(s8.status).toBe(201);
  const s9 = await request(app)
    .post(`/api/inspections/${inspectionId}/attestations`)
    .set(auth(sid))
    .send({ stage: 'S9', attestationType: 'stage_signoff' });
  expect(s9.status).toBe(201);

  return {
    inspectionId,
    photoHashes,
    recordIds: { slopes: [slopeId], elevations: elevationIds, testSquares: [testSquareId] },
  };
}

export function manifestFor(p: PassingInspection) {
  return {
    protocolVersion: 'v1',
    generatedAtUtc: new Date().toISOString(),
    records: p.recordIds,
    photoHashes: p.photoHashes,
    gateResults: { deficiencies: [], softFlags: [] },
  };
}
