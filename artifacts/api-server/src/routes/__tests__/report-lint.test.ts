import {
  companiesTable,
  db,
  inspectionsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Mock object storage so tests can serve stored compiledData blobs from
// memory. Must be declared before the app import chain loads the route.
const storedBlobs = new Map<string, string>();
vi.mock('../../lib/objectStorage', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  class MockObjectStorageService {
    async getObjectEntityFile(path: string) {
      if (!storedBlobs.has(path)) throw new Error(`no blob at ${path}`);
      return {
        download: async () => [Buffer.from(storedBlobs.get(path)!, 'utf-8')],
      };
    }
    async uploadObjectBuffer(buf: Buffer) {
      const path = `/objects/uploads/test-${storedBlobs.size}`;
      storedBlobs.set(path, buf.toString('utf-8'));
      return path;
    }
    async tryGetSignedObjectUrl() {
      return null;
    }
  }
  return { ...actual, ObjectStorageService: MockObjectStorageService };
});

import app from '../../app';
import { createSession } from '../../lib/auth';

// Blocked-content gate: a compiled version whose lint status is `blocked`
// cannot be exported (preview without review flag) until a manager/admin
// explicitly resolves it; reviewers can still open it with ?review=1; old
// pre-lint blobs keep rendering unchanged.

const RUN_ID = `lint-${Date.now().toString(36)}`;
const auth = (sid: string) => ({ Authorization: `Bearer ${sid}` });
const companyA = `TEST-LINT-${RUN_ID}-A`.toUpperCase();

async function seedUser(label: string, role: 'field_rep' | 'manager') {
  const [user] = await db
    .insert(usersTable)
    .values({ companyId: companyA, email: `lint-${label}-${RUN_ID}@example.test` })
    .returning();
  await db.insert(userProfilesTable).values({ userId: user.id, role, department: 'inspector_canvasser' });
  const sid = await createSession({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      companyId: companyA,
    },
    access_token: 'test-access-token',
  });
  return { userId: user.id, sid };
}

let rep: { userId: string; sid: string };
let manager: { userId: string; sid: string };
const inspectionIds: string[] = [];

function baseCompiledData(extra: Record<string, unknown>) {
  return JSON.stringify({
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    inspector: { name: 'Test Inspector', email: 'i@example.test' },
    inspectionSnapshot: {
      id: 'snap', address: '1 Main St', claimNumber: null, policyNumber: null,
      insuredName: null, carrierName: null, dateOfLoss: null,
      roofDamageFound: true, sidingDamageFound: false,
      collateralDamageFound: false, interiorDamageFound: false, lockedAt: null,
    },
    aiSummary: { forensicSummary: 'Hail impacts documented.', repairabilityText: 'Repairable.' },
    propertyDetailsHtml: '<table class="detail-table"></table>',
    photoGroupings: [],
    attestationHtml: '<p>Attested.</p>',
    photoIndex: {},
    ...extra,
  });
}

async function seedCompiledInspection(path: string, blob: string) {
  storedBlobs.set(path, blob);
  const [row] = await db
    .insert(inspectionsTable)
    .values({
      companyId: companyA,
      inspectorUserId: rep.userId,
      phase: 'forensic',
      compiledReportPath: path,
      compiledReportReadyAt: new Date(),
      compiledReportVersions: [{ path, generatedAt: new Date().toISOString(), lintStatus: 'blocked' }],
    })
    .returning();
  inspectionIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  await db.insert(companiesTable).values([{ id: companyA, name: `LintCo ${RUN_ID}` }]);
  rep = await seedUser('rep', 'field_rep');
  manager = await seedUser('mgr', 'manager');
});

afterAll(async () => {
  if (inspectionIds.length) {
    await db.delete(inspectionsTable).where(inArray(inspectionsTable.id, inspectionIds));
  }
});

describe('blocked-content export gate', () => {
  it('blocked version: preview 409s, review=1 renders, resolve unlocks', async () => {
    const path = `/objects/uploads/${RUN_ID}-blocked`;
    const id = await seedCompiledInspection(
      path,
      baseCompiledData({
        contentClasses: {
          'aiSummary.forensicSummary': 'construction_fact',
          'aiSummary.repairabilityText': 'repairability_analysis',
          propertyDetailsHtml: 'construction_fact',
          photoGroupings: 'photo_narrative',
          attestationHtml: 'attestation',
          photoIndex: 'internal_metadata',
        },
        lint: {
          lintStatus: 'blocked',
          findings: [
            { fragmentRef: 'aiSummary.forensicSummary', ruleId: 'payment_demand', matchedText: 'insurer must pay', severity: 'blocked' },
          ],
        },
      }),
    );

    // Export path (no review flag) is refused with the findings.
    const gated = await request(app).get(`/api/inspections/${id}/report/preview-url`).set(auth(rep.sid));
    expect(gated.status).toBe(409);
    expect(gated.body.lintStatus).toBe('blocked');
    expect(gated.body.findings).toHaveLength(1);

    // review=1 is an authorization boundary, not a convention: field reps
    // stay gated even with the flag; only manager/admin may open for review.
    const repReview = await request(app)
      .get(`/api/inspections/${id}/report/preview-url?review=1`)
      .set(auth(rep.sid));
    expect(repReview.status).toBe(409);

    const review = await request(app)
      .get(`/api/inspections/${id}/report/preview-url?review=1`)
      .set(auth(manager.sid));
    expect(review.status).toBe(200);
    expect(review.body.html).toContain('Hail impacts documented.');

    // GET lint surfaces status + findings, unresolved.
    const lint = await request(app).get(`/api/inspections/${id}/report/lint`).set(auth(rep.sid));
    expect(lint.status).toBe(200);
    expect(lint.body.lintStatus).toBe('blocked');
    expect(lint.body.resolution).toBeNull();

    // Field reps cannot resolve.
    const repResolve = await request(app)
      .post(`/api/inspections/${id}/report/lint-resolve`)
      .set(auth(rep.sid))
      .send({});
    expect(repResolve.status).toBe(403);

    // Manager resolves — server-stamped, scoped to this blob path.
    const resolve = await request(app)
      .post(`/api/inspections/${id}/report/lint-resolve`)
      .set(auth(manager.sid))
      .send({ note: 'Reviewed with legal; phrasing acceptable in context.' });
    expect(resolve.status).toBe(200);
    expect(resolve.body.resolution.path).toBe(path);
    expect(resolve.body.resolution.resolvedBy).toBe(manager.userId);

    // Export now allowed; content was never rewritten.
    const after = await request(app).get(`/api/inspections/${id}/report/preview-url`).set(auth(rep.sid));
    expect(after.status).toBe(200);
    expect(after.body.html).toContain('Hail impacts documented.');
  });

  it('needs_review does not gate export', async () => {
    const path = `/objects/uploads/${RUN_ID}-review`;
    const id = await seedCompiledInspection(
      path,
      baseCompiledData({
        contentClasses: { 'aiSummary.forensicSummary': 'construction_fact' },
        lint: {
          lintStatus: 'needs_review',
          findings: [
            { fragmentRef: 'aiSummary.forensicSummary', ruleId: 'absolute_scope_mandate', matchedText: 'must be replaced', severity: 'needs_review' },
          ],
        },
      }),
    );
    const res = await request(app).get(`/api/inspections/${id}/report/preview-url`).set(auth(rep.sid));
    expect(res.status).toBe(200);
  });

  it('old pre-lint blobs (schemaVersion 3, no lint/contentClasses) render unchanged', async () => {
    const path = `/objects/uploads/${RUN_ID}-legacy`;
    const legacy = JSON.parse(baseCompiledData({})) as Record<string, unknown>;
    legacy.schemaVersion = 3;
    const id = await seedCompiledInspection(path, JSON.stringify(legacy));

    const res = await request(app).get(`/api/inspections/${id}/report/preview-url`).set(auth(rep.sid));
    expect(res.status).toBe(200);
    expect(res.body.html).toContain('Hail impacts documented.');
    expect(res.body.html).toContain('Attested.');

    // And GET lint reports legacy blobs as passed (grandfathered).
    const lint = await request(app).get(`/api/inspections/${id}/report/lint`).set(auth(rep.sid));
    expect(lint.body.lintStatus).toBe('passed');
  });
});
