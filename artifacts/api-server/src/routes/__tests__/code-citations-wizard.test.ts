import {
  companiesTable,
  companyStatePacksTable,
  db,
  inspectionsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// AI code-research wizard + per-compile citation selection:
//   1. The research endpoint is super-admin only, returns sanitized
//      suggestions, and filters malformed/duplicate entries from the model.
//   2. The rep-facing citation listing resolves the state like compile does.
//   3. Compile bakes ONLY the selected citations into the v6 blob; an absent
//      body keeps the include-all default.

// Mock object storage so compiled blobs live in memory (declared before the
// app import chain loads the route modules).
const storedBlobs = new Map<string, string>();
vi.mock('../../lib/objectStorage', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  class MockObjectStorageService {
    async getObjectEntityFile(path: string) {
      if (!storedBlobs.has(path)) throw new Error(`no blob at ${path}`);
      return { download: async () => [Buffer.from(storedBlobs.get(path)!, 'utf-8')] };
    }
    async uploadObjectBuffer(buf: Buffer) {
      const path = `/objects/uploads/test-${storedBlobs.size}-${Math.random().toString(36).slice(2)}`;
      storedBlobs.set(path, buf.toString('utf-8'));
      return path;
    }
    async tryGetSignedObjectUrl() {
      return null;
    }
  }
  return { ...actual, ObjectStorageService: MockObjectStorageService };
});

// Configurable Gemini mock: compile calls get the report-fragment shape,
// research calls get whatever `geminiResearchText` holds.
let geminiResearchText: string | (() => string) = JSON.stringify({ suggestions: [] });
vi.mock('@workspace/integrations-gemini-ai', () => ({
  ai: {
    models: {
      generateContent: async (args: { contents: Array<{ parts: Array<{ text: string }> }> }) => {
        const prompt = args.contents[0]?.parts[0]?.text ?? '';
        if (prompt.includes('building-code research assistant')) {
          const t = geminiResearchText;
          return { text: typeof t === 'function' ? t() : t };
        }
        return {
          text: JSON.stringify({
            propertyConstructionDetailsHtml: '<p>Asphalt shingle roof, one story.</p>',
            photoGroupings: [],
            inspectorAttestationHtml: '<p>Inspection personally conducted on site.</p>',
          }),
        };
      },
    },
  },
}));

import app from '../../app';
import { createSession } from '../../lib/auth';

const RUN_ID = `ccw-${Date.now().toString(36)}`;
const companyId = `TEST-CCW-${RUN_ID}`.toUpperCase();
const auth = (sid: string) => ({ Authorization: `Bearer ${sid}` });

const CITATIONS = [
  { key: 'drip_edge', element: 'Drip edge', title: 'Drip edge required', cite: 'IRC R905.2.8.5', body: 'Required at eaves and rakes.' },
  { key: 'ice_barrier', element: 'Ice barrier', title: 'Ice barrier required', cite: 'IRC R905.1.2', body: 'Required in cold regions.' },
];

let superAdmin: { userId: string; sid: string };
let rep: { userId: string; sid: string };
const inspectionIds: string[] = [];

async function seedUser(role: 'super_admin' | 'field_rep') {
  const [user] = await db
    .insert(usersTable)
    .values({ companyId, email: `ccw-${role}-${RUN_ID}@example.test` })
    .returning();
  await db
    .insert(userProfilesTable)
    .values({ userId: user.id, role, department: 'inspector_canvasser' });
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
  return { userId: user.id, sid };
}

async function seedInspection(): Promise<string> {
  const [row] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      inspectorUserId: rep.userId,
      phase: 'forensic',
      address: '1 Main St, Fairfax, VA 22030',
      aiSummary: {
        forensicSummary: 'Hail impacts documented across the roof system.',
        repairabilityText: 'Full replacement of the affected system is warranted.',
        generatedAt: new Date().toISOString(),
      },
    } as typeof inspectionsTable.$inferInsert)
    .returning();
  inspectionIds.push(row.id);
  return row.id;
}

async function compiledBlob(inspectionId: string): Promise<{ schemaVersion: number; reportData: { statePack: { codeCitations: Array<{ key: string }> } } }> {
  const [row] = await db
    .select({ compiledReportPath: inspectionsTable.compiledReportPath })
    .from(inspectionsTable)
    .where(eq(inspectionsTable.id, inspectionId));
  return JSON.parse(storedBlobs.get(row!.compiledReportPath!)!);
}

beforeAll(async () => {
  await db.insert(companiesTable).values({
    id: companyId,
    name: `WizardCo ${RUN_ID}`,
    contractorLegalName: 'WizardCo LLC',
    contractorLicenses: [{ state: 'VA', number: 'VA-123456' }],
    qualificationsText: 'Licensed Class A contractor.',
  } as typeof companiesTable.$inferInsert);
  await db.insert(companyStatePacksTable).values({ companyId, state: 'VA', codeCitations: CITATIONS });
  superAdmin = await seedUser('super_admin');
  rep = await seedUser('field_rep');
});

afterAll(async () => {
  if (inspectionIds.length) {
    await db.delete(inspectionsTable).where(inArray(inspectionsTable.id, inspectionIds));
  }
  await db.delete(companyStatePacksTable).where(eq(companyStatePacksTable.companyId, companyId));
  for (const u of [superAdmin, rep]) {
    await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, u.userId));
    await db.delete(usersTable).where(eq(usersTable.id, u.userId));
  }
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

describe('POST /companies/:companyId/state-packs/:state/code-research', () => {
  const path = `/api/companies/${companyId}/state-packs/VA/code-research`;

  it('requires super_admin', async () => {
    const res = await request(app).post(path).set(auth(rep.sid)).send({});
    expect(res.status).toBe(403);
  });

  it('returns sanitized suggestions and drops malformed, duplicate, and existing-key entries', async () => {
    geminiResearchText = JSON.stringify({
      suggestions: [
        { key: 'Drip Edge!!', element: 'Drip edge', title: 'Drip edge required', cite: 'IRC R905.2.8.5', body: 'Required at eaves.' },
        // Duplicate of the first after key normalization.
        { key: 'drip_edge', element: 'Drip edge', title: 'Dup', cite: 'X', body: 'Dup.' },
        // Existing key passed by the client — must be filtered.
        { key: 'ice_barrier', element: 'Ice barrier', title: 'Existing', cite: 'X', body: 'Existing.' },
        // Malformed: missing body.
        { key: 'flashing', element: 'Flashing', title: 'Flashing', cite: 'IRC R903.2' },
        'not-an-object',
      ],
    });
    const res = await request(app)
      .post(path)
      .set(auth(superAdmin.sid))
      .send({ query: 'drip edge', existingKeys: ['ice_barrier'] });
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual([
      { key: 'drip_edge', element: 'Drip edge', title: 'Drip edge required', cite: 'IRC R905.2.8.5', body: 'Required at eaves.' },
    ]);
  });

  it('surfaces model failures as 502 instead of empty success', async () => {
    geminiResearchText = () => {
      throw new Error('model unavailable');
    };
    const res = await request(app).post(path).set(auth(superAdmin.sid)).send({});
    expect(res.status).toBe(502);
    geminiResearchText = JSON.stringify({ suggestions: [] });
  });
});

describe('duplicate citation keys', () => {
  it('upsert rejects packs with duplicate citation keys', async () => {
    const res = await request(app)
      .put(`/api/companies/${companyId}/state-packs/VA`)
      .set(auth(superAdmin.sid))
      .send({
        pack: {
          homeownerRights: null,
          uppaDisclaimer: null,
          uppaStatute: null,
          codeCitations: [
            { key: 'drip_edge', element: 'Drip edge', title: 'A', cite: 'X', body: 'B.' },
            { key: 'Drip_Edge ', element: 'Drip edge', title: 'A2', cite: 'X2', body: 'B2.' },
          ],
        },
      });
    expect(res.status).toBe(400);
  });

  it('listing dedupes legacy packs that already contain duplicate keys', async () => {
    // Write duplicates directly (bypassing the API guard) to simulate legacy data.
    await db
      .update(companyStatePacksTable)
      .set({ codeCitations: [...CITATIONS, { ...CITATIONS[0]!, title: 'Legacy duplicate' }] })
      .where(eq(companyStatePacksTable.companyId, companyId));
    const inspectionId = await seedInspection();
    const res = await request(app)
      .get(`/api/inspections/${inspectionId}/report/code-citations`)
      .set(auth(rep.sid));
    expect(res.status).toBe(200);
    expect(res.body.citations.map((c: { key: string }) => c.key)).toEqual(['drip_edge', 'ice_barrier']);
    // Restore clean citations for the remaining tests.
    await db
      .update(companyStatePacksTable)
      .set({ codeCitations: CITATIONS })
      .where(eq(companyStatePacksTable.companyId, companyId));
  });
});

describe('GET /inspections/:id/report/code-citations', () => {
  it('lists the applicable state pack citations for the rep', async () => {
    const inspectionId = await seedInspection();
    const res = await request(app)
      .get(`/api/inspections/${inspectionId}/report/code-citations`)
      .set(auth(rep.sid));
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('VA');
    expect(res.body.citations.map((c: { key: string }) => c.key)).toEqual(['drip_edge', 'ice_barrier']);
  });
});

describe('per-compile citation selection', () => {
  it('bakes only the selected citations into the compiled blob', async () => {
    const inspectionId = await seedInspection();
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/report/compile`)
      .set(auth(rep.sid))
      .send({ codeCitationKeys: ['ice_barrier'] });
    expect(res.status).toBe(200);
    const blob = await compiledBlob(inspectionId);
    expect(blob.schemaVersion).toBeGreaterThanOrEqual(6);
    expect(blob.reportData.statePack.codeCitations.map((c) => c.key)).toEqual(['ice_barrier']);
  });

  it('includes all citations when no selection is sent', async () => {
    const inspectionId = await seedInspection();
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/report/compile`)
      .set(auth(rep.sid))
      .send({});
    expect(res.status).toBe(200);
    const blob = await compiledBlob(inspectionId);
    expect(blob.reportData.statePack.codeCitations.map((c) => c.key)).toEqual(['drip_edge', 'ice_barrier']);
  });
});
