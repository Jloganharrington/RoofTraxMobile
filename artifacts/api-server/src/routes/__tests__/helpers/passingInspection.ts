import request from 'supertest';
import { expect } from 'vitest';

import app from '../../../app';

// Shared test helpers for building an inspection that satisfies every hard
// gate of protocol v2 (arrival … submit), so the server-side gate re-run
// passes and the record can actually be submitted and locked. Used by both
// the M-F suite and the core inspection suite, since a full passing gate +
// signature-on-file is a precondition of submission.

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

  // Step 1 — arrival conditions (sky/wind/temp/personnel + GPS + time).
  const arrival = await request(app)
    .patch(`/api/inspections/${inspectionId}`)
    .set(auth(sid))
    .send({
      arrivalConditions: {
        sky: 'Sunny',
        windCondition: 'Calm',
        temp: '72F',
        personnelPresent: ['Homeowner'],
        timeLocal: '7/17/2026, 9:00:00 AM',
        gpsLatitude: 32.7767,
        gpsLongitude: -96.797,
        recordedAtUtc: new Date().toISOString(),
      },
    });
  expect(arrival.status).toBe(200);

  // Step 2 — a wide photo for all four elevations + the roof-access photo.
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
  await addPhoto({ subjectType: 'inspection', stage: 'elevation_access', triadRole: 'wide' });

  // Step 3 — one fully documented facet (area/material/pitch, no damage) and
  // one whole-roof linear. No damage means no test square is required.
  const slope = await request(app)
    .post(`/api/inspections/${inspectionId}/slopes`)
    .set(auth(sid))
    .send({
      label: 'F1',
      pitchRise: 6,
      pitchRun: 12,
      areaSqft: 320,
      materialType: 'Asphalt shingle',
      damageType: 'none',
      damagePresent: false,
    });
  expect(slope.status).toBe(201);
  const slopeId = slope.body.slope.id as string;

  const measurement = await request(app)
    .post(`/api/inspections/${inspectionId}/measurements`)
    .set(auth(sid))
    .send({ subjectType: 'inspection', measurementType: 'ridge_lf', value: 40, unit: 'lf' });
  expect(measurement.status).toBe(201);

  // Step 7 — at least one product record.
  const product = await request(app)
    .post(`/api/inspections/${inspectionId}/products`)
    .set(auth(sid))
    .send({ category: 'Shingle', brand: 'Acme', identificationMethod: 'field_identified' });
  expect(product.status).toBe(201);

  // Step 10 declaration + Step 11 final review, as stage_signoff attestations.
  const declaration = await request(app)
    .post(`/api/inspections/${inspectionId}/attestations`)
    .set(auth(sid))
    .send({ stage: 'declaration', attestationType: 'stage_signoff', signatureData: 'x' });
  expect(declaration.status).toBe(201);
  const finalReview = await request(app)
    .post(`/api/inspections/${inspectionId}/attestations`)
    .set(auth(sid))
    .send({ stage: 'submit', attestationType: 'stage_signoff' });
  expect(finalReview.status).toBe(201);

  return {
    inspectionId,
    photoHashes,
    recordIds: { slopes: [slopeId], elevations: elevationIds, testSquares: [] },
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
