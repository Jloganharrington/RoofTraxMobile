import {
  attestationsTable,
  companiesTable,
  companyJurisdictionPacksTable,
  db,
  inspectionProductsTable,
  inspectionsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Portal access code assignment on report compile — the code is assigned on
// the FIRST compile via a conditional (isNull-guarded) update, so:
//   1. Two concurrent first compiles must persist exactly one code.
//   2. Later compiles must never change an existing code.
//   3. When every assignment attempt fails, the failure is surfaced (the
//      compile still succeeds, the code stays unassigned, and the next
//      compile recovers by assigning one).

// Mock object storage so compiled blobs live in memory. Must be declared
// before the app import chain loads the route module.
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

// Mock Gemini so compiles never hit the network and are fast + deterministic.
vi.mock('@workspace/integrations-gemini-ai', () => ({
  ai: {
    models: {
      generateContent: async () => ({
        text: JSON.stringify({
          propertyConstructionDetailsHtml: '<p>Asphalt shingle roof, one story.</p>',
          photoGroupings: [],
          inspectorAttestationHtml: '<p>Inspection personally conducted on site.</p>',
        }),
      }),
    },
  },
}));

// Wrap the real code generator so one test can force every attempt to fail
// (proving a total assignment failure is not silent and is recoverable).
let failCodeGeneration = false;
vi.mock('../../lib/portalAccess', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../../lib/portalAccess');
  return {
    ...actual,
    generatePortalAccessCode: () => {
      if (failCodeGeneration) throw new Error('forced portal code generation failure');
      return actual.generatePortalAccessCode();
    },
  };
});

import app from '../../app';
import { createSession } from '../../lib/auth';
import { logger } from '../../lib/logger';
import { normalizePortalAccessCode } from '../../lib/portalAccess';

const RUN_ID = `pcc-${Date.now().toString(36)}`;
const companyId = `TEST-PCC-${RUN_ID}`.toUpperCase();
const auth = (sid: string) => ({ Authorization: `Bearer ${sid}` });

let rep: { userId: string; sid: string };
const inspectionIds: string[] = [];

async function seedInspection(): Promise<string> {
  const [row] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      inspectorUserId: rep.userId,
      phase: 'forensic',
      address: `1 Main St, Fairfax, VA 22030`,
      // Satisfy readiness gate: forensic findings, RAP gate, estimate lines.
      roofDamageFound: true,
      rapGateReason: 'not_authorized',
      estimate: { lines: [{ description: 'Roofing system replacement', qty: 1, unitCost: 100 }] },
      aiSummary: {
        forensicSummary: 'Hail impacts documented across the roof system.',
        repairabilityText: 'Full replacement of the affected system is warranted.',
        generatedAt: new Date().toISOString(),
      },
    } as unknown as typeof inspectionsTable.$inferInsert)
    .returning();
  // Attestation + product satisfy the field_record_attested and product_id
  // readiness checks. Both cascade-delete with the inspection — no extra cleanup.
  await Promise.all([
    db.insert(attestationsTable).values({
      companyId,
      inspectionId: row.id,
      userId: rep.userId,
      attestationType: 'stage_signoff',
    } as typeof attestationsTable.$inferInsert),
    db.insert(inspectionProductsTable).values({
      companyId,
      inspectionId: row.id,
      identificationMethod: 'field_identified',
    } as typeof inspectionProductsTable.$inferInsert),
  ]);
  inspectionIds.push(row.id);
  return row.id;
}

async function readPortalCode(inspectionId: string): Promise<string | null> {
  const [row] = await db
    .select({ portalAccessCode: inspectionsTable.portalAccessCode })
    .from(inspectionsTable)
    .where(eq(inspectionsTable.id, inspectionId));
  return row?.portalAccessCode ?? null;
}

function compile(inspectionId: string) {
  return request(app)
    .post(`/api/inspections/${inspectionId}/report/compile`)
    .set(auth(rep.sid))
    .send({});
}

beforeAll(async () => {
  await db.insert(companiesTable).values({
    id: companyId,
    name: `PortalCo ${RUN_ID}`,
    contractorLegalName: 'PortalCo LLC',
    contractorLicenses: [{ state: 'VA', number: 'VA-123456' }],
    qualificationsText: 'Licensed Class A contractor.',
  } as typeof companiesTable.$inferInsert);
  await db.insert(companyJurisdictionPacksTable).values({
    companyId,
    jurisdiction: 'State of VA',
    state: 'VA',
  });

  const [user] = await db
    .insert(usersTable)
    .values({ companyId, email: `pcc-rep-${RUN_ID}@example.test` })
    .returning();
  await db
    .insert(userProfilesTable)
    .values({ userId: user.id, role: 'field_rep', department: 'inspector_canvasser' });
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
  rep = { userId: user.id, sid };
});

afterAll(async () => {
  if (inspectionIds.length) {
    await db.delete(inspectionsTable).where(inArray(inspectionsTable.id, inspectionIds));
  }
  await db.delete(companyJurisdictionPacksTable).where(eq(companyJurisdictionPacksTable.companyId, companyId));
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, rep.userId));
  await db.delete(usersTable).where(eq(usersTable.id, rep.userId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

describe('portal access code assignment on report compile', () => {
  it('two concurrent first compiles persist exactly one valid code', async () => {
    const inspectionId = await seedInspection();
    expect(await readPortalCode(inspectionId)).toBeNull();

    const [resA, resB] = await Promise.all([compile(inspectionId), compile(inspectionId)]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const code = await readPortalCode(inspectionId);
    expect(code).not.toBeNull();
    // Canonical, well-formed code (XXXX-XXXX-XXXX from the safe alphabet).
    expect(normalizePortalAccessCode(code!)).toBe(code);
  });

  it('a later compile never changes an already-assigned code', async () => {
    const inspectionId = await seedInspection();
    const first = await compile(inspectionId);
    expect(first.status).toBe(200);
    const code = await readPortalCode(inspectionId);
    expect(code).not.toBeNull();

    const second = await compile(inspectionId);
    expect(second.status).toBe(200);
    expect(await readPortalCode(inspectionId)).toBe(code);
  });

  it('total assignment failure is surfaced (error log), and the next compile recovers', async () => {
    const inspectionId = await seedInspection();

    // Capture error-level records emitted through the shared pino logger
    // (req.log is a child of it — child records flow through the same stream).
    const errorRecords: string[] = [];
    const { symbols } = await import('pino');
    const stream = (logger as unknown as Record<symbol, { write: (s: string) => void }>)[
      symbols.streamSym
    ];
    const originalWrite = stream ? stream.write.bind(stream) : null;
    if (stream && originalWrite) {
      stream.write = (s: string) => {
        errorRecords.push(s);
        originalWrite(s);
      };
    }

    failCodeGeneration = true;
    try {
      const res = await compile(inspectionId);
      // Compile itself still succeeds — the package is stored either way.
      expect(res.status).toBe(200);
      expect(await readPortalCode(inspectionId)).toBeNull();
      if (stream && originalWrite) {
        expect(
          errorRecords.some((r) => r.includes('Failed to assign portal access code after all retries')),
        ).toBe(true);
      }
    } finally {
      failCodeGeneration = false;
      if (stream && originalWrite) stream.write = originalWrite;
    }

    // Recovery path: the next compile assigns a code normally.
    const retry = await compile(inspectionId);
    expect(retry.status).toBe(200);
    const code = await readPortalCode(inspectionId);
    expect(code).not.toBeNull();
    expect(normalizePortalAccessCode(code!)).toBe(code);
  });
});
