import {
  companiesTable,
  db,
  inspectionPhotosTable,
  inspectionsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';
import {
  backoffMsForAttempts,
  buildSubmittedInspection,
  deliverInspectionToBrain,
  getBrainConfig,
  photoObjstoreRef,
  runBrainCourierPass,
} from '../../lib/brainCourier';

// App → Brain courier. Verifies: config gating, payload mapping (all four
// damage flags, null pass-through for uncaptured blocks, objstore photo
// refs), delivery bookkeeping (delivered/failed/attempts), idempotent
// re-delivery skip, retry-worker backoff, machine-token photo proxy auth
// (never a session; locked-evidence scope), and the status return path
// (Brain state when reachable, local state — never an error — when not).

const RUN_ID = `bc-${Date.now().toString(36)}`;
const BRAIN_URL = 'https://brain.test';
const TOKEN = `machine-token-${RUN_ID}`;

let companyId: string;
let otherCompanyId: string;
let repSid: string;
let repId: string;

const auth = (sid: string) => ({ Authorization: `Bearer ${sid}` });

async function seedInspection(overrides: Partial<typeof inspectionsTable.$inferInsert> = {}) {
  const [row] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      inspectorUserId: repId,
      status: 'submitted',
      address: '123 Test Ln',
      interiorDamageFound: true,
      roofDamageFound: true,
      lockedAt: new Date(),
      submissionManifest: {
        protocolVersion: 'v2',
        generatedAtUtc: new Date().toISOString(),
        records: {},
        photoHashes: [],
        gateResults: { deficiencies: [], softFlags: [] },
      } as never,
      brainDeliveryStatus: 'pending',
      ...overrides,
    })
    .returning();
  return row;
}

beforeAll(async () => {
  process.env['BRAIN_BASE_URL'] = BRAIN_URL;
  process.env['BRAIN_MACHINE_TOKEN'] = TOKEN;

  companyId = `TEST-${RUN_ID}-A`.toUpperCase();
  otherCompanyId = `TEST-${RUN_ID}-B`.toUpperCase();
  await db.insert(companiesTable).values([
    { id: companyId, name: `BrainCo A ${RUN_ID}` },
    { id: otherCompanyId, name: `BrainCo B ${RUN_ID}` },
  ]);
  const [rep] = await db
    .insert(usersTable)
    .values({ companyId, email: `bc-rep-${RUN_ID}@example.test` })
    .returning();
  repId = rep.id;
  await db.insert(userProfilesTable).values({
    userId: repId,
    role: 'field_rep',
    department: 'inspector_canvasser',
    certifications: [{ name: 'HAAG' }],
    yearsExperience: 7,
  });
  repSid = await createSession({
    user: {
      id: rep.id,
      email: rep.email,
      firstName: rep.firstName,
      lastName: rep.lastName,
      profileImageUrl: rep.profileImageUrl,
      companyId,
    },
    access_token: 'test-access-token',
  });
});

afterAll(async () => {
  delete process.env['BRAIN_BASE_URL'];
  delete process.env['BRAIN_MACHINE_TOKEN'];
  await db
    .delete(inspectionsTable)
    .where(inArray(inspectionsTable.companyId, [companyId, otherCompanyId]));
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, repId));
  await db.delete(usersTable).where(inArray(usersTable.companyId, [companyId, otherCompanyId]));
  await db
    .delete(companiesTable)
    .where(inArray(companiesTable.id, [companyId, otherCompanyId]));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('config gating', () => {
  it('reads config when both vars present, null when either is missing', () => {
    expect(getBrainConfig()).toEqual({ baseUrl: BRAIN_URL, machineToken: TOKEN });
    delete process.env['BRAIN_BASE_URL'];
    expect(getBrainConfig()).toBeNull();
    process.env['BRAIN_BASE_URL'] = BRAIN_URL;
  });

  it('strips trailing slashes from the base URL', () => {
    process.env['BRAIN_BASE_URL'] = `${BRAIN_URL}///`;
    expect(getBrainConfig()?.baseUrl).toBe(BRAIN_URL);
    process.env['BRAIN_BASE_URL'] = BRAIN_URL;
  });
});

describe('payload builder', () => {
  it('maps all four damage flags, nulls uncaptured blocks, and refs photos by objstore id', async () => {
    const inspection = await seedInspection();
    const [photo] = await db
      .insert(inspectionPhotosTable)
      .values({
        companyId,
        inspectionId: inspection.id,
        subjectType: 'inspection',
        url: '/objects/uploads/nonexistent',
        sha256: 'abc123',
        preliminaryRole: 'damage_closeup_interior',
      })
      .returning();

    const payload = await buildSubmittedInspection(inspection);
    expect(payload.damageFlags).toEqual({
      roofDamageFound: true,
      sidingDamageFound: false,
      collateralDamageFound: false,
      interiorDamageFound: true,
    });
    // Uncaptured REPORT_DATA v2 blocks pass through as null — never {}.
    expect(payload.propertyProfile).toBeNull();
    expect(payload.repairabilityAssessment).toBeNull();
    expect(payload.temporaryRepairs).toBeNull();
    expect(payload.propertyProtectionPlan).toBeNull();
    expect(payload.inspector.certifications).toEqual([{ name: 'HAAG' }]);
    expect(payload.inspector.yearsExperience).toBe(7);
    expect(payload.photos).toHaveLength(1);
    expect(payload.photos[0].url).toBe(photoObjstoreRef(photo.id));
    expect(payload.photos[0].sha256).toBe('abc123');
    expect(payload.photos[0].preliminaryRole).toBe('damage_closeup_interior');
  });
});

describe('delivery', () => {
  it('stores the Brain submission id and marks delivered on success', async () => {
    const inspection = await seedInspection();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ submissionId: 'brain-sub-1' }), { status: 201 }),
    );

    await deliverInspectionToBrain(inspection.id, fetchMock as never);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BRAIN_URL}/submissions`);
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(init.body);
    expect(body.manifest).toMatchObject({ photoHashes: [], records: {} });
    expect(body.inspection.inspectionId).toBe(inspection.id);

    const [row] = await db
      .select()
      .from(inspectionsTable)
      .where(eq(inspectionsTable.id, inspection.id));
    expect(row.brainDeliveryStatus).toBe('delivered');
    expect(row.brainSubmissionId).toBe('brain-sub-1');
    expect(row.brainDeliveredAt).not.toBeNull();
    expect(row.brainLastError).toBeNull();
    expect(row.brainDeliveryAttempts).toBe(1);
  });

  it('records failure without throwing and increments attempts', async () => {
    const inspection = await seedInspection();
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED brain down'));

    await expect(
      deliverInspectionToBrain(inspection.id, fetchMock as never),
    ).resolves.toBeUndefined();

    const [row] = await db
      .select()
      .from(inspectionsTable)
      .where(eq(inspectionsTable.id, inspection.id));
    expect(row.brainDeliveryStatus).toBe('failed');
    expect(row.brainLastError).toContain('ECONNREFUSED');
    expect(row.brainDeliveryAttempts).toBe(1);
    expect(row.brainSubmissionId).toBeNull();
  });

  it('skips an already-delivered inspection (idempotent)', async () => {
    const inspection = await seedInspection({
      brainDeliveryStatus: 'delivered',
      brainSubmissionId: 'already-there',
    });
    const fetchMock = vi.fn();
    await deliverInspectionToBrain(inspection.id, fetchMock as never);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing for an unlocked inspection', async () => {
    const inspection = await seedInspection({
      lockedAt: null,
      submissionManifest: null,
      status: 'capturing',
    });
    const fetchMock = vi.fn();
    await deliverInspectionToBrain(inspection.id, fetchMock as never);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('retry worker', () => {
  it('uses exponential backoff capped at an hour', () => {
    expect(backoffMsForAttempts(0)).toBe(30_000);
    expect(backoffMsForAttempts(1)).toBe(30_000);
    expect(backoffMsForAttempts(2)).toBe(60_000);
    expect(backoffMsForAttempts(5)).toBe(480_000);
    expect(backoffMsForAttempts(50)).toBe(3_600_000);
  });

  it('retries a failed delivery whose backoff has elapsed', async () => {
    const inspection = await seedInspection({
      brainDeliveryStatus: 'failed',
      brainDeliveryAttempts: 1,
      brainLastAttemptAt: new Date(Date.now() - 10 * 60_000),
      brainLastError: 'earlier failure',
    });
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        new Response(JSON.stringify({ submissionId: 'brain-sub-retry' }), { status: 201 }),
      );

    const attempted = await runBrainCourierPass(fetchMock as never);
    expect(attempted).toBeGreaterThanOrEqual(1);

    const [row] = await db
      .select()
      .from(inspectionsTable)
      .where(eq(inspectionsTable.id, inspection.id));
    expect(row.brainDeliveryStatus).toBe('delivered');
    expect(row.brainSubmissionId).toBe('brain-sub-retry');
  });

  it('leaves a recently-attempted failure alone (backoff not elapsed)', async () => {
    const inspection = await seedInspection({
      brainDeliveryStatus: 'failed',
      brainDeliveryAttempts: 8,
      brainLastAttemptAt: new Date(Date.now() - 60_000),
    });
    const fetchMock = vi.fn();
    await runBrainCourierPass(fetchMock as never);

    const [row] = await db
      .select()
      .from(inspectionsTable)
      .where(eq(inspectionsTable.id, inspection.id));
    expect(row.brainDeliveryStatus).toBe('failed');
    expect(row.brainDeliveryAttempts).toBe(8);
  });
});

describe('photo proxy — GET /internal/photos/:photoId', () => {
  async function seedPhoto(inspectionId: string) {
    const [photo] = await db
      .insert(inspectionPhotosTable)
      .values({
        companyId,
        inspectionId,
        subjectType: 'inspection',
        url: '/objects/uploads/does-not-exist',
        sha256: 'deadbeef',
      })
      .returning();
    return photo;
  }

  it('rejects an unauthenticated request', async () => {
    const inspection = await seedInspection();
    const photo = await seedPhoto(inspection.id);
    const res = await request(app).get(`/api/internal/photos/${photo.id}`);
    expect(res.status).toBe(401);
  });

  it('rejects a wrong machine token and a user session token', async () => {
    const inspection = await seedInspection();
    const photo = await seedPhoto(inspection.id);
    const wrong = await request(app)
      .get(`/api/internal/photos/${photo.id}`)
      .set({ Authorization: 'Bearer not-the-token' });
    expect(wrong.status).toBe(401);
    // A rep's session token must NOT open the machine surface.
    const session = await request(app)
      .get(`/api/internal/photos/${photo.id}`)
      .set(auth(repSid));
    expect(session.status).toBe(401);
  });

  it('404s a photo on an unlocked inspection (not yet evidence)', async () => {
    const inspection = await seedInspection({
      lockedAt: null,
      submissionManifest: null,
      status: 'capturing',
    });
    const photo = await seedPhoto(inspection.id);
    const res = await request(app)
      .get(`/api/internal/photos/${photo.id}`)
      .set({ Authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(404);
  });

  it('404s an unknown photo id with a valid token', async () => {
    const res = await request(app)
      .get('/api/internal/photos/00000000-0000-0000-0000-000000000000')
      .set({ Authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(404);
  });
});

describe('return path — GET /inspections/:id/status', () => {
  it('returns the Brain status when reachable and drops the stub marker', async () => {
    const inspection = await seedInspection({
      brainDeliveryStatus: 'delivered',
      brainSubmissionId: 'brain-sub-status',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'package_ready' }), { status: 200 }),
      ),
    );

    const res = await request(app)
      .get(`/api/inspections/${inspection.id}/status`)
      .set(auth(repSid));
    expect(res.status).toBe(200);
    expect(res.body.brain).toEqual({
      available: true,
      deliveryStatus: 'delivered',
      brainSubmissionId: 'brain-sub-status',
      lastError: null,
      status: 'package_ready',
    });
    expect(res.body.receipt.isStub).toBe(false);
  });

  it('never fails when the Brain is down — returns local state, brain unavailable', async () => {
    const inspection = await seedInspection({
      brainDeliveryStatus: 'delivered',
      brainSubmissionId: 'brain-sub-down',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('brain unreachable')));

    const res = await request(app)
      .get(`/api/inspections/${inspection.id}/status`)
      .set(auth(repSid));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('submitted');
    expect(res.body.brain.available).toBe(false);
    expect(res.body.brain.status).toBeNull();
    expect(res.body.brain.deliveryStatus).toBe('delivered');
    expect(res.body.receipt.isStub).toBe(true);
  });

  it('reports undelivered state without calling the Brain', async () => {
    const inspection = await seedInspection({
      brainDeliveryStatus: 'failed',
      brainLastError: 'ECONNREFUSED',
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await request(app)
      .get(`/api/inspections/${inspection.id}/status`)
      .set(auth(repSid));
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.body.brain).toMatchObject({
      available: false,
      deliveryStatus: 'failed',
      lastError: 'ECONNREFUSED',
      brainSubmissionId: null,
    });
  });
});
