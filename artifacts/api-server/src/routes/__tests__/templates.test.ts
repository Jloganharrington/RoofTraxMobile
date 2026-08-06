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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

// Company templates CRUD — verifies:
// - 401 for unauthenticated callers
// - 403 for cross-company and below-admin roles
// - 400 for invalid useCase or unowned objectPath
// - Full CRUD happy-path for an admin within their own company

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
const ownedPathA = `/objects/uploads/${RUN_ID}-a`;
const ownedPathA2 = `/objects/uploads/${RUN_ID}-a2`;
const ownedPathB = `/objects/uploads/${RUN_ID}-b`;

beforeAll(async () => {
  a = await seedCompany('a');
  b = await seedCompany('b');

  // Register owned object paths so POST/PATCH ownership checks pass.
  await db.insert(objectOwnershipTable).values([
    { objectPath: ownedPathA, userId: a.adminId, companyId: a.companyId },
    { objectPath: ownedPathA2, userId: a.adminId, companyId: a.companyId },
    { objectPath: ownedPathB, userId: b.adminId, companyId: b.companyId },
  ]);
});

afterAll(async () => {
  // Clean up templates first (FK → companies).
  await db
    .delete(companyTemplatesTable)
    .where(inArray(companyTemplatesTable.companyId, [a.companyId, b.companyId]));
  await db
    .delete(objectOwnershipTable)
    .where(inArray(objectOwnershipTable.objectPath, [ownedPathA, ownedPathA2, ownedPathB]));
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
