/**
 * Company templates CRUD + validation tests.
 *
 * Covers:
 *  - 401/403 auth and role gates
 *  - Input validation (useCase, objectPath ownership)
 *  - MIME type allowlist (Fix 1)
 *  - Content-sniff rejection (Fix 1)  
 *  - 20 MB size cap (Fix 1)
 *  - HTML sanitization in storage (Fix 2)
 *  - use_case uniqueness — 409 with holder info (Fix 6)
 *  - Object lifecycle — PATCH replace deletes old object (Fix 4)
 *  - Object lifecycle — DELETE removes storage object + ownership row (Fix 4)
 *  - Full CRUD happy-path
 */

import {
  companiesTable,
  companyTemplatesTable,
  db,
  objectOwnershipTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';
import { ObjectStorageService } from '../../lib/objectStorage';

// ---------------------------------------------------------------------------
// Magic byte constants used in sniff tests
// ---------------------------------------------------------------------------

/** Valid %PDF magic (0x25 0x50 0x44 0x46) + 4 padding bytes */
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x00, 0x00, 0x00]);
/** Valid DOCX PK-ZIP magic (0x50 0x4B) + 6 padding bytes */
const DOCX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
/** MZ executable magic — rejected as PDF or HTML */
const EXE_MAGIC = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00]);
/** HTML bytes that include a <script> tag for sanitization tests */
const HTML_WITH_SCRIPT = Buffer.from(
  '<html><body><p>Hello world</p><script>alert("xss")</script></body></html>',
);

const RUN_ID = `tpl-${Date.now().toString(36)}`;

interface Seeded {
  companyId: string;
  adminId: string;
  repId: string;
  managerId: string;
  adminSid: string;
  repSid: string;
  managerSid: string;
}

async function seedCompany(label: string): Promise<Seeded> {
  const companyId = `TEST-${RUN_ID}-${label}`.toUpperCase();
  await db.insert(companiesTable).values({ id: companyId, name: `TplCo ${label}` });

  const mkUser = (role: string) =>
    db
      .insert(usersTable)
      .values({ companyId, email: `${role}-${label}-${RUN_ID}@example.test` })
      .returning()
      .then(([u]) => u);

  const admin = await mkUser('admin');
  const rep = await mkUser('rep');
  const manager = await mkUser('manager');

  await db.insert(userProfilesTable).values([
    { userId: admin.id, role: 'admin' },
    { userId: rep.id, role: 'field_rep' },
    { userId: manager.id, role: 'manager' },
  ]);

  const mkSid = (u: typeof admin) =>
    createSession({
      user: {
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        profileImageUrl: u.profileImageUrl,
        companyId,
      },
      access_token: 'test-access-token',
    });

  return {
    companyId,
    adminId: admin.id,
    repId: rep.id,
    managerId: manager.id,
    adminSid: await mkSid(admin),
    repSid: await mkSid(rep),
    managerSid: await mkSid(manager),
  };
}

const auth = (sid: string) => ({ Authorization: `Bearer ${sid}` });
const url = (companyId: string, suffix = '') =>
  `/api/companies/${companyId}/templates${suffix}`;

let a: Seeded;
let b: Seeded;

// Object paths registered in object_ownership for tests.
const ownedPathA          = `/objects/uploads/${RUN_ID}-a`;
const ownedPathA2         = `/objects/uploads/${RUN_ID}-a2`;
const ownedPathB          = `/objects/uploads/${RUN_ID}-b`;
const ownedPathHtml       = `/objects/uploads/${RUN_ID}-html`;
const ownedPathExePdf     = `/objects/uploads/${RUN_ID}-exe-as-pdf`;
const ownedPathOversize   = `/objects/uploads/${RUN_ID}-oversize`;
const ownedPathConflict1  = `/objects/uploads/${RUN_ID}-conflict1`;
const ownedPathConflict2  = `/objects/uploads/${RUN_ID}-conflict2`;
const ownedPathLifecycle1 = `/objects/uploads/${RUN_ID}-lc1`;
const ownedPathLifecycle2 = `/objects/uploads/${RUN_ID}-lc2`;

const ALL_OWNED_PATHS_A = [
  ownedPathA, ownedPathA2, ownedPathHtml, ownedPathExePdf, ownedPathOversize,
  ownedPathConflict1, ownedPathConflict2, ownedPathLifecycle1, ownedPathLifecycle2,
];

beforeAll(async () => {
  a = await seedCompany('a');
  b = await seedCompany('b');

  const aOwned = ALL_OWNED_PATHS_A.map((p) => ({
    objectPath: p,
    userId: a.adminId,
    companyId: a.companyId,
  }));
  await db.insert(objectOwnershipTable).values([
    ...aOwned,
    { objectPath: ownedPathB, userId: b.adminId, companyId: b.companyId },
  ]);
});

afterAll(async () => {
  await db
    .delete(companyTemplatesTable)
    .where(inArray(companyTemplatesTable.companyId, [a.companyId, b.companyId]));
  await db
    .delete(objectOwnershipTable)
    .where(
      inArray(objectOwnershipTable.objectPath, [...ALL_OWNED_PATHS_A, ownedPathB]),
    );
  for (const s of [a, b]) {
    await db
      .delete(userProfilesTable)
      .where(inArray(userProfilesTable.userId, [s.adminId, s.repId, s.managerId]));
    await db
      .delete(usersTable)
      .where(inArray(usersTable.id, [s.adminId, s.repId, s.managerId]));
    await db.delete(companiesTable).where(eq(companiesTable.id, s.companyId));
  }
});

// ---------------------------------------------------------------------------
// Default storage mock — every test starts with a working PDF storage object.
// Tests that need different behaviour override individual spies.
// ---------------------------------------------------------------------------

let spyHead: ReturnType<typeof vi.spyOn>;
let spyBytes: ReturnType<typeof vi.spyOn>;
let spyOverwrite: ReturnType<typeof vi.spyOn>;
let spyDelete: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  spyHead = vi
    .spyOn(ObjectStorageService.prototype, 'readObjectEntityHead')
    .mockResolvedValue({ firstBytes: PDF_MAGIC, sizeBytes: 1024 });

  spyBytes = vi
    .spyOn(ObjectStorageService.prototype, 'readObjectEntityBytes')
    .mockResolvedValue(Buffer.from('<p>safe html</p>'));

  spyOverwrite = vi
    .spyOn(ObjectStorageService.prototype, 'overwriteObjectEntityBytes')
    .mockResolvedValue(undefined);

  spyDelete = vi
    .spyOn(ObjectStorageService.prototype, 'deleteObjectEntity')
    .mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Auth / authz guards
// ---------------------------------------------------------------------------
describe('auth and role gates', () => {
  it('GET returns 401 when unauthenticated', async () => {
    const res = await request(app).get(url(a.companyId));
    expect(res.status).toBe(401);
  });

  it('POST returns 401 when unauthenticated', async () => {
    const res = await request(app).post(url(a.companyId)).send({});
    expect(res.status).toBe(401);
  });

  it('GET returns 403 for cross-company caller', async () => {
    const res = await request(app).get(url(a.companyId)).set(auth(b.adminSid));
    expect(res.status).toBe(403);
  });

  it('GET returns 403 for field_rep in own company', async () => {
    const res = await request(app).get(url(a.companyId)).set(auth(a.repSid));
    expect(res.status).toBe(403);
  });

  it('GET returns 403 for manager in own company', async () => {
    const res = await request(app).get(url(a.companyId)).set(auth(a.managerSid));
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST validation
// ---------------------------------------------------------------------------
describe('POST /companies/:companyId/templates — validation', () => {
  const base = {
    name: 'My Template',
    objectPath: '',         // overridden per test
    mimeType: 'application/pdf',
    useCase: 'forensic_report',
    originalFilename: 'report.pdf',
  };

  it('rejects an invalid useCase', async () => {
    const res = await request(app)
      .post(url(a.companyId))
      .set(auth(a.adminSid))
      .send({ ...base, objectPath: ownedPathA, useCase: 'bad_value' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/useCase/i);
  });

  it('rejects an objectPath with no ownership record', async () => {
    const res = await request(app)
      .post(url(a.companyId))
      .set(auth(a.adminSid))
      .send({ ...base, objectPath: '/objects/uploads/nonexistent' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/objectPath/i);
  });

  it("rejects another company's objectPath", async () => {
    const res = await request(app)
      .post(url(a.companyId))
      .set(auth(a.adminSid))
      .send({ ...base, objectPath: ownedPathB });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/objectPath/i);
  });

  it('rejects missing required fields', async () => {
    const res = await request(app)
      .post(url(a.companyId))
      .set(auth(a.adminSid))
      .send({ name: 'x' });
    expect(res.status).toBe(400);
  });

  it('rejects a disallowed mimeType', async () => {
    const res = await request(app)
      .post(url(a.companyId))
      .set(auth(a.adminSid))
      .send({ ...base, objectPath: ownedPathA, mimeType: 'application/x-executable' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mimeType/i);
  });
});

// ---------------------------------------------------------------------------
// Fix 1 — Server-side content-sniff rejection
// ---------------------------------------------------------------------------
describe('Fix 1 — content sniff', () => {
  it('rejects an .exe renamed as .pdf (magic bytes mismatch)', async () => {
    spyHead.mockResolvedValue({ firstBytes: EXE_MAGIC, sizeBytes: 2048 });

    const res = await request(app)
      .post(url(a.companyId))
      .set(auth(a.adminSid))
      .send({
        name: 'Evil PDF',
        objectPath: ownedPathExePdf,
        mimeType: 'application/pdf',
        useCase: 'other',
        originalFilename: 'totally-a-pdf.pdf',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/content sniff/i);
  });

  it('rejects a PDF disguised as HTML', async () => {
    spyHead.mockResolvedValue({ firstBytes: PDF_MAGIC, sizeBytes: 2048 });

    const res = await request(app)
      .post(url(a.companyId))
      .set(auth(a.adminSid))
      .send({
        name: 'Sneaky HTML',
        objectPath: ownedPathHtml,
        mimeType: 'text/html',
        useCase: 'other',
        originalFilename: 'not-really.html',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/content sniff/i);
  });
});

// ---------------------------------------------------------------------------
// Fix 1 — 20 MB size cap
// ---------------------------------------------------------------------------
describe('Fix 1 — 20 MB size cap', () => {
  it('rejects an oversize object (> 20 MB)', async () => {
    const OVER_20MB = 21 * 1024 * 1024;
    spyHead.mockResolvedValue({ firstBytes: PDF_MAGIC, sizeBytes: OVER_20MB });

    const res = await request(app)
      .post(url(a.companyId))
      .set(auth(a.adminSid))
      .send({
        name: 'Big Template',
        objectPath: ownedPathOversize,
        mimeType: 'application/pdf',
        useCase: 'other',
        originalFilename: 'big.pdf',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/20 MB/i);
  });
});

// ---------------------------------------------------------------------------
// Fix 2 — HTML sanitization
// ---------------------------------------------------------------------------
describe('Fix 2 — HTML sanitization', () => {
  it('sanitizes <script> tags before storing and inserts the template', async () => {
    // HTML magic: not PDF or DOCX magic
    spyHead.mockResolvedValue({
      firstBytes: Buffer.from('<html>'.slice(0, 8)),
      sizeBytes: HTML_WITH_SCRIPT.length,
    });
    spyBytes.mockResolvedValue(HTML_WITH_SCRIPT);

    const res = await request(app)
      .post(url(a.companyId))
      .set(auth(a.adminSid))
      .send({
        name: 'HTML Template',
        objectPath: ownedPathHtml,
        mimeType: 'text/html',
        useCase: 'other',
        originalFilename: 'template.html',
      });

    expect(res.status).toBe(201);

    // Storage should have been read and overwritten.
    expect(spyBytes).toHaveBeenCalledWith(ownedPathHtml);
    expect(spyOverwrite).toHaveBeenCalledOnce();

    const [, sanitizedBuf] = spyOverwrite.mock.calls[0] as [string, Buffer, string];
    const sanitized = sanitizedBuf.toString('utf-8');

    // Before: contained <script>
    expect(HTML_WITH_SCRIPT.toString()).toContain('<script>');
    // After: <script> must be stripped
    expect(sanitized).not.toContain('<script>');
    // Safe content should survive
    expect(sanitized).toContain('<p>Hello world</p>');

    // Cleanup — delete the template we just created
    const tplId = res.body.template.id as string;
    await db
      .delete(companyTemplatesTable)
      .where(eq(companyTemplatesTable.id, tplId));
  });
});

// ---------------------------------------------------------------------------
// Fix 6 — use_case uniqueness (409 conflict)
// ---------------------------------------------------------------------------
describe('Fix 6 — use_case uniqueness', () => {
  let firstTemplateId: string;

  beforeAll(async () => {
    // Seed a template that occupies use_case=proof_package for company A.
    const [t] = await db
      .insert(companyTemplatesTable)
      .values({
        companyId: a.companyId,
        name: 'Existing Proof Package',
        objectPath: ownedPathConflict1,
        mimeType: 'application/pdf',
        useCase: 'proof_package',
        originalFilename: 'proof.pdf',
        uploadedByUserId: a.adminId,
      })
      .returning();
    firstTemplateId = t.id;
  });

  afterAll(async () => {
    await db
      .delete(companyTemplatesTable)
      .where(eq(companyTemplatesTable.id, firstTemplateId));
  });

  it('POST returns 409 with holder info when use_case is already taken', async () => {
    const res = await request(app)
      .post(url(a.companyId))
      .set(auth(a.adminSid))
      .send({
        name: 'New Proof Package',
        objectPath: ownedPathConflict2,
        mimeType: 'application/pdf',
        useCase: 'proof_package',
        originalFilename: 'proof2.pdf',
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('use_case_conflict');
    expect(res.body.holder).toMatchObject({
      id: firstTemplateId,
      name: 'Existing Proof Package',
    });
  });

  it("POST allows multiple 'other' templates — no 409", async () => {
    const res1 = await request(app)
      .post(url(a.companyId))
      .set(auth(a.adminSid))
      .send({
        name: 'Other 1',
        objectPath: ownedPathConflict2,
        mimeType: 'application/pdf',
        useCase: 'other',
        originalFilename: 'other1.pdf',
      });
    expect(res1.status).toBe(201);
    const id1 = res1.body.template.id as string;

    // Temporarily create a second ownership row so we have a fresh path.
    const tempPath = `/objects/uploads/${RUN_ID}-other2`;
    await db.insert(objectOwnershipTable).values({
      objectPath: tempPath,
      userId: a.adminId,
      companyId: a.companyId,
    });

    const res2 = await request(app)
      .post(url(a.companyId))
      .set(auth(a.adminSid))
      .send({
        name: 'Other 2',
        objectPath: tempPath,
        mimeType: 'application/pdf',
        useCase: 'other',
        originalFilename: 'other2.pdf',
      });
    expect(res2.status).toBe(201);
    const id2 = res2.body.template.id as string;

    // Cleanup
    await db.delete(companyTemplatesTable).where(inArray(companyTemplatesTable.id, [id1, id2]));
    await db.delete(objectOwnershipTable).where(eq(objectOwnershipTable.objectPath, tempPath));
  });

  it('PATCH returns 409 with holder info when changing to an occupied use_case', async () => {
    // Create a separate template to PATCH
    const [patchTarget] = await db
      .insert(companyTemplatesTable)
      .values({
        companyId: a.companyId,
        name: 'Patch Target',
        objectPath: ownedPathConflict2,
        mimeType: 'application/pdf',
        useCase: 'other',
        originalFilename: 'patch.pdf',
        uploadedByUserId: a.adminId,
      })
      .returning();

    const res = await request(app)
      .patch(url(a.companyId, `/${patchTarget.id}`))
      .set(auth(a.adminSid))
      .send({ useCase: 'proof_package' }); // already held by firstTemplateId

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('use_case_conflict');
    expect(res.body.holder).toMatchObject({ id: firstTemplateId });

    // Cleanup
    await db.delete(companyTemplatesTable).where(eq(companyTemplatesTable.id, patchTarget.id));
  });
});

// ---------------------------------------------------------------------------
// Fix 4 — Object lifecycle
// ---------------------------------------------------------------------------
describe('Fix 4 — object lifecycle', () => {
  it('PATCH replacing objectPath deletes the old storage object after update', async () => {
    const [tpl] = await db
      .insert(companyTemplatesTable)
      .values({
        companyId: a.companyId,
        name: 'Lifecycle Patch',
        objectPath: ownedPathLifecycle1,
        mimeType: 'application/pdf',
        useCase: 'other',
        originalFilename: 'lc.pdf',
        uploadedByUserId: a.adminId,
      })
      .returning();

    const res = await request(app)
      .patch(url(a.companyId, `/${tpl.id}`))
      .set(auth(a.adminSid))
      .send({ objectPath: ownedPathLifecycle2 });

    expect(res.status).toBe(200);
    expect(res.body.template.objectPath).toBe(ownedPathLifecycle2);

    // deleteObjectEntity must have been called with the OLD path.
    // Allow up to one tick for the void async call.
    await new Promise((r) => setTimeout(r, 50));
    expect(spyDelete).toHaveBeenCalledWith(ownedPathLifecycle1);

    // Cleanup
    await db.delete(companyTemplatesTable).where(eq(companyTemplatesTable.id, tpl.id));
  });

  it('DELETE removes the storage object and its ownership row', async () => {
    // Re-insert the ownership row (may have been cleaned up already)
    await db
      .insert(objectOwnershipTable)
      .values({
        objectPath: ownedPathLifecycle1,
        userId: a.adminId,
        companyId: a.companyId,
      })
      .onConflictDoNothing();

    const [tpl] = await db
      .insert(companyTemplatesTable)
      .values({
        companyId: a.companyId,
        name: 'Lifecycle Delete',
        objectPath: ownedPathLifecycle1,
        mimeType: 'application/pdf',
        useCase: 'other',
        originalFilename: 'lc-del.pdf',
        uploadedByUserId: a.adminId,
      })
      .returning();

    const res = await request(app)
      .delete(url(a.companyId, `/${tpl.id}`))
      .set(auth(a.adminSid));

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 50));
    // Storage object deleted.
    expect(spyDelete).toHaveBeenCalledWith(ownedPathLifecycle1);
    // Ownership row deleted.
    const ownership = await db
      .select()
      .from(objectOwnershipTable)
      .where(eq(objectOwnershipTable.objectPath, ownedPathLifecycle1));
    expect(ownership).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Full CRUD happy-path
// ---------------------------------------------------------------------------
describe('CRUD happy-path', () => {
  let templateId: string;

  it('POST creates a template and returns 201', async () => {
    const res = await request(app)
      .post(url(a.companyId))
      .set(auth(a.adminSid))
      .send({
        name: 'Forensic Template',
        objectPath: ownedPathA,
        mimeType: 'application/pdf',
        useCase: 'forensic_report',
        originalFilename: 'forensic.pdf',
      });
    expect(res.status).toBe(201);
    expect(res.body.template.name).toBe('Forensic Template');
    expect(res.body.template.companyId).toBe(a.companyId);
    expect(res.body.template.useCase).toBe('forensic_report');
    templateId = res.body.template.id as string;
  });

  it('GET lists the template (admin, own company)', async () => {
    const res = await request(app).get(url(a.companyId)).set(auth(a.adminSid));
    expect(res.status).toBe(200);
    const templates = res.body.templates as Array<{ id: string; companyId: string }>;
    expect(templates.some((t) => t.id === templateId)).toBe(true);
    expect(templates.every((t) => t.companyId === a.companyId)).toBe(true);
  });

  it('GET does NOT return company A templates to company B admin', async () => {
    const res = await request(app).get(url(b.companyId)).set(auth(b.adminSid));
    expect(res.status).toBe(200);
    const ids = (res.body.templates as Array<{ id: string }>).map((t) => t.id);
    expect(ids).not.toContain(templateId);
  });

  it('PATCH updates name and useCase', async () => {
    const res = await request(app)
      .patch(url(a.companyId, `/${templateId}`))
      .set(auth(a.adminSid))
      .send({ name: 'Renamed', useCase: 'proof_package' });
    expect(res.status).toBe(200);
    expect(res.body.template.name).toBe('Renamed');
    expect(res.body.template.useCase).toBe('proof_package');
  });

  it('PATCH replaces objectPath after ownership check passes', async () => {
    const res = await request(app)
      .patch(url(a.companyId, `/${templateId}`))
      .set(auth(a.adminSid))
      .send({ objectPath: ownedPathA2 });
    expect(res.status).toBe(200);
    expect(res.body.template.objectPath).toBe(ownedPathA2);
  });

  it("PATCH rejects replacement with another company's objectPath", async () => {
    const res = await request(app)
      .patch(url(a.companyId, `/${templateId}`))
      .set(auth(a.adminSid))
      .send({ objectPath: ownedPathB });
    expect(res.status).toBe(400);
  });

  it('PATCH rejects invalid useCase', async () => {
    const res = await request(app)
      .patch(url(a.companyId, `/${templateId}`))
      .set(auth(a.adminSid))
      .send({ useCase: 'not_a_valid_use_case' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/useCase/i);
  });

  it('PATCH returns 404 for a template from the wrong company', async () => {
    const res = await request(app)
      .patch(url(b.companyId, `/${templateId}`))
      .set(auth(b.adminSid))
      .send({ name: 'Stolen' });
    expect(res.status).toBe(404);
  });

  it('DELETE returns 404 for a template from the wrong company', async () => {
    const res = await request(app)
      .delete(url(b.companyId, `/${templateId}`))
      .set(auth(b.adminSid));
    expect(res.status).toBe(404);
  });

  it('DELETE removes the record', async () => {
    const res = await request(app)
      .delete(url(a.companyId, `/${templateId}`))
      .set(auth(a.adminSid));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('DELETE returns 404 for a non-existent template', async () => {
    const res = await request(app)
      .delete(url(a.companyId, '/00000000-0000-0000-0000-000000000000'))
      .set(auth(a.adminSid));
    expect(res.status).toBe(404);
  });
});
