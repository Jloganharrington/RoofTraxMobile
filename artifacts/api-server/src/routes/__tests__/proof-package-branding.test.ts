// Proof Package branding: Brain payload carries the company's saved report
// palette (hex-validated, omitted when unset) + a durable objstore:// logo
// ref, the machine-token proxy serves the logo bytes company-scoped, and the
// repo's Phase-2 template keeps its branding hook + logo slots.
import { readFileSync } from 'fs';
import path from 'path';

import { companiesTable, db, inspectionsTable, usersTable } from '@workspace/db';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import app from '../../app';
import {
  brandingForPayload,
  buildSubmittedInspection,
  companyLogoObjstoreRef,
} from '../../lib/brainCourier';
import { ObjectStorageService } from '../../lib/objectStorage';

const RUN_ID = `ppb-${Date.now().toString(36)}`;
const TOKEN = `machine-token-${RUN_ID}`;

process.env['BRAIN_BASE_URL'] = 'https://brain.test';
process.env['BRAIN_MACHINE_TOKEN'] = TOKEN;

const companyId = `TEST-${RUN_ID}-A`.toUpperCase();
const otherCompanyId = `TEST-${RUN_ID}-B`.toUpperCase();

const BRANDING = {
  headerColor: '#123456',
  headerTextColor: '#fafafa',
  accentColor: '#ab12cd',
};

let repId: string;

async function seed() {
  if (repId) return;
  await db.insert(companiesTable).values([
    {
      id: companyId,
      name: `ProofCo A ${RUN_ID}`,
      reportBranding: BRANDING,
      logoUrl: '/api/storage/objects/uploads/logo-a.png',
    },
    { id: otherCompanyId, name: `ProofCo B ${RUN_ID}` },
  ]);
  const [rep] = await db
    .insert(usersTable)
    .values({ companyId, email: `ppb-rep-${RUN_ID}@example.test` })
    .returning();
  repId = rep!.id;
}

async function seedInspection(overrides: Partial<typeof inspectionsTable.$inferInsert> = {}) {
  await seed();
  const [row] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      inspectorUserId: repId,
      status: 'submitted',
      address: '123 Test Ln',
      lockedAt: new Date(),
      ...overrides,
    })
    .returning();
  return row!;
}

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await db.delete(inspectionsTable).where(inArray(inspectionsTable.companyId, [companyId, otherCompanyId]));
  await db.delete(usersTable).where(eq(usersTable.id, repId));
  await db.delete(companiesTable).where(inArray(companiesTable.id, [companyId, otherCompanyId]));
});

describe('brandingForPayload', () => {
  it('passes through a fully valid palette', () => {
    expect(brandingForPayload(BRANDING)).toEqual(BRANDING);
  });

  it('drops invalid fields individually and returns null when nothing valid', () => {
    expect(
      brandingForPayload({ headerColor: '#123456', headerTextColor: 'red', accentColor: '#12345' }),
    ).toEqual({ headerColor: '#123456' });
    expect(brandingForPayload({ headerColor: 'javascript:alert(1)' })).toBeNull();
    expect(brandingForPayload(null)).toBeNull();
    expect(brandingForPayload('nope')).toBeNull();
  });
});

describe('buildSubmittedInspection company block', () => {
  it('includes validated branding and a durable objstore logo ref', async () => {
    const inspection = await seedInspection();
    const payload = await buildSubmittedInspection(inspection);
    expect(payload.company).toEqual({
      name: `ProofCo A ${RUN_ID}`,
      branding: BRANDING,
      logo: companyLogoObjstoreRef(companyId),
    });
    expect(payload.company.logo).toBe(`objstore://company-logo/${companyId}`);
    // never an expiring signed URL
    expect(payload.company.logo).not.toMatch(/^https?:/);
  });

  it('sends null branding and logo for an unbranded company', async () => {
    await seed();
    const [rep] = await db
      .insert(usersTable)
      .values({ companyId: otherCompanyId, email: `ppb-rep2-${RUN_ID}@example.test` })
      .returning();
    const [inspection] = await db
      .insert(inspectionsTable)
      .values({
        companyId: otherCompanyId,
        inspectorUserId: rep!.id,
        status: 'submitted',
        address: '9 Bare Rd',
        lockedAt: new Date(),
      })
      .returning();
    const payload = await buildSubmittedInspection(inspection!);
    expect(payload.company).toEqual({
      name: `ProofCo B ${RUN_ID}`,
      branding: null,
      logo: null,
    });
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, inspection!.id));
    await db.delete(usersTable).where(eq(usersTable.id, rep!.id));
  });
});

describe('GET /api/internal/company-logo/:companyId', () => {
  const mockLogoBytes = () => {
    vi.spyOn(ObjectStorageService.prototype, 'getObjectEntityFile').mockResolvedValue(
      {} as never,
    );
    vi.spyOn(ObjectStorageService.prototype, 'downloadObject').mockResolvedValue(
      new Response(Buffer.from('png-bytes'), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }) as never,
    );
  };

  it('rejects missing/invalid machine token', async () => {
    await seed();
    const bare = await request(app).get(`/api/internal/company-logo/${companyId}`);
    expect(bare.status).toBe(401);
    const bad = await request(app)
      .get(`/api/internal/company-logo/${companyId}`)
      .set('Authorization', 'Bearer wrong-token');
    expect(bad.status).toBe(401);
  });

  it('serves the logo bytes with a valid token', async () => {
    await seed();
    mockLogoBytes();
    const res = await request(app)
      .get(`/api/internal/company-logo/${companyId}`)
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body.toString()).toBe('png-bytes');
    expect(ObjectStorageService.prototype.getObjectEntityFile).toHaveBeenCalledWith(
      '/objects/uploads/logo-a.png',
    );
  });

  it('normalizes full authenticated URLs and strips query strings', async () => {
    await seed();
    mockLogoBytes();
    await db
      .update(companiesTable)
      .set({ logoUrl: 'https://app.example.com/api/storage/objects/uploads/logo-full.png?sig=abc#x' })
      .where(eq(companiesTable.id, companyId));
    try {
      const res = await request(app)
        .get(`/api/internal/company-logo/${companyId}`)
        .set('Authorization', `Bearer ${TOKEN}`);
      expect(res.status).toBe(200);
      expect(ObjectStorageService.prototype.getObjectEntityFile).toHaveBeenCalledWith(
        '/objects/uploads/logo-full.png',
      );
    } finally {
      await db
        .update(companiesTable)
        .set({ logoUrl: '/api/storage/objects/uploads/logo-a.png' })
        .where(eq(companiesTable.id, companyId));
    }
  });

  it('404s for a company with no logo and for out-of-scope tokens', async () => {
    await seed();
    const noLogo = await request(app)
      .get(`/api/internal/company-logo/${otherCompanyId}`)
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(noLogo.status).toBe(404);

    // company-scoped token cannot fetch another company's logo
    const prev = process.env['BRAIN_MACHINE_TOKEN'];
    process.env['BRAIN_MACHINE_TOKEN'] = `${otherCompanyId}:${TOKEN}`;
    try {
      const scoped = await request(app)
        .get(`/api/internal/company-logo/${companyId}`)
        .set('Authorization', `Bearer ${TOKEN}`);
      expect(scoped.status).toBe(404);
    } finally {
      process.env['BRAIN_MACHINE_TOKEN'] = prev;
    }
  });
});

describe('proof-package-phase2 template branding hook', () => {
  const html = readFileSync(
    path.join(__dirname, '../../../templates/proof-package-phase2.html'),
    'utf8',
  );

  it('keeps the logo slots and REPORT_DATA.logoUrl wiring', () => {
    expect(html).toContain('id="logo-slot-cover"');
    expect(html).toContain('class="logo-slot"');
    expect(html).toContain('REPORT_DATA.logoUrl');
    expect(html).toContain('function renderLogo()');
  });

  it('applies branding onto :root tokens with strict hex validation and defaults', () => {
    expect(html).toContain('--cover-text: #FFFFFF');
    expect(html).toContain('function applyBranding()');
    expect(html).toContain('REPORT_DATA.branding');
    expect(html).toMatch(/\^#\[0-9a-fA-F\]\{6\}\$/); // strict hex gate
    expect(html).toContain('setProperty("--navy", b.headerColor)');
    expect(html).toContain('setProperty("--cover-text", b.headerTextColor)');
    expect(html).toContain('setProperty("--accent", b.accentColor)');
    expect(html).toContain('applyBranding();');
    // cover text now flows through the themeable token
    expect(html).toContain('color:var(--cover-text)');
  });
});
