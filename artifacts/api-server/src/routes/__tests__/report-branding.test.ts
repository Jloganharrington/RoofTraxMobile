import { companiesTable, db, inspectionsTable, userProfilesTable, usersTable } from '@workspace/db';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';
import { ObjectStorageService } from '../../lib/objectStorage';
import {
  DEFAULT_REPORT_THEME,
  buildReportHtml,
  isHexColor,
  resolveReportTheme,
} from '../../lib/reportTemplate';

// Report branding — super_admin-only palette CRUD, strict hex validation,
// company scoping, and render-time theming (defaults + injection safety).

const RUN_ID = `rb-${Date.now().toString(36)}`;

interface Seeded {
  companyId: string;
  superSid: string;
  adminSid: string;
  repSid: string;
  superId: string;
  adminId: string;
  repId: string;
}

async function seedCompany(label: string): Promise<Seeded> {
  const companyId = `TEST-${RUN_ID}-${label}`.toUpperCase();
  await db.insert(companiesTable).values({ id: companyId, name: `BrandCo ${label}` });

  const mkUser = async (tag: string, role: string) => {
    const [u] = await db
      .insert(usersTable)
      .values({ companyId, email: `rb-${tag}-${label}-${RUN_ID}@example.test` })
      .returning();
    await db.insert(userProfilesTable).values({ userId: u.id, role: role as never });
    const sid = await createSession({
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
    return { id: u.id, sid };
  };

  const sup = await mkUser('super', 'super_admin');
  const adm = await mkUser('admin', 'admin');
  const rep = await mkUser('rep', 'field_rep');
  return {
    companyId,
    superId: sup.id, superSid: sup.sid,
    adminId: adm.id, adminSid: adm.sid,
    repId: rep.id, repSid: rep.sid,
  };
}

const auth = (sid: string) => ({ Authorization: `Bearer ${sid}` });

let a: Seeded;
let b: Seeded;

beforeAll(async () => {
  a = await seedCompany('a');
  b = await seedCompany('b');
});

afterAll(async () => {
  for (const s of [a, b]) {
    const ids = [s.superId, s.adminId, s.repId];
    await db.delete(userProfilesTable).where(inArray(userProfilesTable.userId, ids));
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
    await db.delete(companiesTable).where(eq(companiesTable.id, s.companyId));
  }
});

const VALID = { headerColor: '#14532d', headerTextColor: '#ffffff', accentColor: '#22c55e' };

describe('report-branding routes', () => {
  it('requires auth', async () => {
    const res = await request(app).get(`/api/companies/${a.companyId}/report-branding`);
    expect(res.status).toBe(401);
  });

  it('rejects readers and writers below admin rank', async () => {
    // field_rep must be rejected
    const repGet = await request(app).get(`/api/companies/${a.companyId}/report-branding`).set(auth(a.repSid));
    expect(repGet.status).toBe(403);
    const repPatch = await request(app)
      .patch(`/api/companies/${a.companyId}/report-branding`)
      .set(auth(a.repSid))
      .send({ branding: VALID });
    expect(repPatch.status).toBe(403);
  });

  it('allows admin-rank users to read and write report branding', async () => {
    const get = await request(app).get(`/api/companies/${a.companyId}/report-branding`).set(auth(a.adminSid));
    expect(get.status).toBe(200);
    const patch = await request(app)
      .patch(`/api/companies/${a.companyId}/report-branding`)
      .set(auth(a.adminSid))
      .send({ branding: VALID });
    expect(patch.status).toBe(200);
    // Reset so later "returns null" assertion starts from a clean state
    await request(app)
      .patch(`/api/companies/${a.companyId}/report-branding`)
      .set(auth(a.adminSid))
      .send({ branding: null });
  });

  it('rejects cross-company access even for super_admin', async () => {
    const res = await request(app)
      .patch(`/api/companies/${a.companyId}/report-branding`)
      .set(auth(b.superSid))
      .send({ branding: VALID });
    expect(res.status).toBe(403);
  });

  it('returns null branding before anything is set', async () => {
    const res = await request(app).get(`/api/companies/${a.companyId}/report-branding`).set(auth(a.superSid));
    expect(res.status).toBe(200);
    expect(res.body.branding).toBeNull();
  });

  it('rejects invalid color values', async () => {
    for (const bad of [
      { ...VALID, headerColor: 'red' },
      { ...VALID, accentColor: '#fff' },
      { ...VALID, headerTextColor: '#12345g' },
      { ...VALID, headerColor: '#123456; } body { display:none' },
    ]) {
      const res = await request(app)
        .patch(`/api/companies/${a.companyId}/report-branding`)
        .set(auth(a.superSid))
        .send({ branding: bad });
      expect(res.status).toBe(400);
    }
    const notObj = await request(app)
      .patch(`/api/companies/${a.companyId}/report-branding`)
      .set(auth(a.superSid))
      .send({ branding: 'nope' });
    expect(notObj.status).toBe(400);
  });

  it('stores a valid palette and reads it back (lowercased)', async () => {
    const res = await request(app)
      .patch(`/api/companies/${a.companyId}/report-branding`)
      .set(auth(a.superSid))
      .send({ branding: { ...VALID, headerColor: '#14532D' } });
    expect(res.status).toBe(200);
    expect(res.body.branding.headerColor).toBe('#14532d');

    const get = await request(app).get(`/api/companies/${a.companyId}/report-branding`).set(auth(a.superSid));
    expect(get.body.branding).toEqual({ ...VALID });
  });

  it('does not leak into another company', async () => {
    const get = await request(app).get(`/api/companies/${b.companyId}/report-branding`).set(auth(b.superSid));
    expect(get.status).toBe(200);
    expect(get.body.branding).toBeNull();
  });

  it('null branding resets to default', async () => {
    const res = await request(app)
      .patch(`/api/companies/${a.companyId}/report-branding`)
      .set(auth(a.superSid))
      .send({ branding: null });
    expect(res.status).toBe(200);
    expect(res.body.branding).toBeNull();
    const get = await request(app).get(`/api/companies/${a.companyId}/report-branding`).set(auth(a.superSid));
    expect(get.body.branding).toBeNull();
  });
});

describe('branding sample preview route', () => {
  const previewPath = (companyId: string) => `/api/companies/${companyId}/report-branding/preview`;

  it('requires auth and admin+ role', async () => {
    const anon = await request(app).get(previewPath(a.companyId));
    expect(anon.status).toBe(401);
    // field_rep rejected
    const rep = await request(app).get(previewPath(a.companyId)).set(auth(a.repSid));
    expect(rep.status).toBe(403);
    // cross-company super_admin rejected
    const cross = await request(app).get(previewPath(a.companyId)).set(auth(b.superSid));
    expect(cross.status).toBe(403);
    // same-company admin allowed
    const adm = await request(app).get(previewPath(a.companyId)).set(auth(a.adminSid));
    expect(adm.status).toBe(200);
  });

  it('renders a sample report with the stored palette and freshly-signed logo', async () => {
    await db
      .update(companiesTable)
      .set({ reportBranding: VALID, logoUrl: '/objects/test/logo.png' })
      .where(eq(companiesTable.id, a.companyId));
    const signSpy = vi
      .spyOn(ObjectStorageService.prototype, 'getSignedDownloadUrl')
      .mockResolvedValue('https://signed.example.test/logo.png?sig=fresh');
    try {
      const res = await request(app).get(previewPath(a.companyId)).set(auth(a.superSid));
      expect(res.status).toBe(200);
      const html = res.body.html as string;
      expect(html).toContain(`--navy:${VALID.headerColor}`);
      expect(html).toContain(`--accent:${VALID.accentColor}`);
      expect(html).toContain('https://signed.example.test/logo.png?sig=fresh');
      expect(html).toContain('Forensic Inspection Report &amp; Proof Package');
      // Sample content, not real inspection data.
      expect(html).toContain('SAMPLE01');
    } finally {
      signSpy.mockRestore();
      await db
        .update(companiesTable)
        .set({ reportBranding: null, logoUrl: null })
        .where(eq(companiesTable.id, a.companyId));
    }
  });

  it('applies valid query-param color overrides and rejects invalid ones', async () => {
    const ok = await request(app)
      .get(`${previewPath(a.companyId)}?headerColor=%23111111&accentColor=%23FF00AA`)
      .set(auth(a.superSid));
    expect(ok.status).toBe(200);
    expect(ok.body.html).toContain('--navy:#111111');
    expect(ok.body.html).toContain('--accent:#ff00aa');
    // Non-overridden field falls back to default.
    expect(ok.body.html).toContain('--cover-text:#ffffff');

    for (const bad of ['red', '%23fff', '%23123456%3B%7D']) {
      const res = await request(app)
        .get(`${previewPath(a.companyId)}?headerColor=${bad}`)
        .set(auth(a.superSid));
      expect(res.status).toBe(400);
    }
  });

  it('renders without a logo when none is stored', async () => {
    const res = await request(app).get(previewPath(a.companyId)).set(auth(a.superSid));
    expect(res.status).toBe(200);
    expect(res.body.html).not.toContain('<img class="cover-logo"');
  });
});

describe('report template theming', () => {
  const baseParams = {
    inspection: {
      id: 'insp-1', address: '1 Test Ln', claimNumber: null, policyNumber: null,
      insuredName: null, carrierName: null, dateOfLoss: null,
    } as never,
    inspector: { name: 'Ins Pector', email: null },
    aiSummary: { forensicSummary: 'Summary text', repairabilityText: '' },
    propertyDetailsHtml: '<table class="detail-table"></table>',
    photoSectionsHtml: '<p>none</p>',
    attestationHtml: '<p>attested</p>',
    generatedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
  };

  it('renders the default palette when no theme is passed', () => {
    const html = buildReportHtml(baseParams);
    expect(html).toContain('--report-header-bg: #1a2744');
    expect(html).toContain('--report-accent: #3b82f6');
    expect(html).toContain('--report-header-text: #ffffff');
  });

  it('renders a custom palette when a theme is passed', () => {
    const html = buildReportHtml({ ...baseParams, theme: { ...VALID } });
    expect(html).toContain('--report-header-bg: #14532d');
    expect(html).toContain('--report-accent: #22c55e');
  });

  it('renders the company logo in the cover when a logoUrl is passed', () => {
    const html = buildReportHtml({ ...baseParams, logoUrl: 'https://signed.example/logo.png?sig=abc' });
    expect(html).toContain('class="cover-logo"');
    expect(html).toContain('src="https://signed.example/logo.png?sig=abc"');
    expect(html).toContain('alt="Company logo"');
  });

  it('renders the cover without a logo element when logoUrl is absent', () => {
    expect(buildReportHtml(baseParams)).not.toContain('<img class="cover-logo"');
    expect(buildReportHtml({ ...baseParams, logoUrl: null })).not.toContain('<img class="cover-logo"');
  });

  it('escapes a hostile logo URL', () => {
    const html = buildReportHtml({ ...baseParams, logoUrl: '"><script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('resolveReportTheme falls back per-field on invalid/legacy data', () => {
    expect(resolveReportTheme(null)).toEqual(DEFAULT_REPORT_THEME);
    expect(resolveReportTheme({ headerColor: 'javascript:alert(1)' })).toEqual(DEFAULT_REPORT_THEME);
    expect(resolveReportTheme({ headerColor: '#000000' }).headerColor).toBe('#000000');
    expect(resolveReportTheme({ headerColor: '#000000' }).accentColor).toBe(DEFAULT_REPORT_THEME.accentColor);
  });

  it('preview route applies company branding end-to-end (compile snapshot → themed HTML)', async () => {
    // Seed an inspection whose compiled report blob we serve from a mocked
    // object storage — this exercises the real preview route: blob load,
    // fresh photo signing, branding lookup, and template render.
    const [insp] = await db
      .insert(inspectionsTable)
      .values({
        companyId: a.companyId,
        inspectorUserId: a.superId,
        address: '42 Parity Way',
        compiledReportPath: `/objects/test/${RUN_ID}-report.json`,
      })
      .returning();

    const compiledBlob = {
      schemaVersion: 1,
      generatedAt: new Date('2026-01-02T00:00:00Z').toISOString(),
      inspector: { name: 'Ins Pector', email: 'ins@example.test' },
      inspectionSnapshot: {
        id: insp.id, address: '42 Parity Way', claimNumber: 'CLM-1', policyNumber: null,
        insuredName: 'Home Owner', carrierName: 'AcmeIns', dateOfLoss: '2025-12-01',
        roofDamageFound: true, sidingDamageFound: false, collateralDamageFound: false,
        interiorDamageFound: false, lockedAt: null,
      },
      aiSummary: { forensicSummary: 'Storm damage <observed> & documented.', repairabilityText: 'Repairable.' },
      propertyDetailsHtml: '<table class="detail-table"><tr><th>Type</th><td>Single family</td></tr></table>',
      photoGroupings: [{ title: 'Roof — Front Slope', photoIds: ['ph1'], narrative: 'Front slope hits.' }],
      attestationHtml: '<p>Attested by Ins Pector.</p>',
      photoIndex: { ph1: { objectPath: '/objects/test/ph1.jpg', stage: null, triadRole: null, zone: 'front', subjectType: 'roof' } },
    };

    const getFileSpy = vi
      .spyOn(ObjectStorageService.prototype, 'getObjectEntityFile')
      .mockResolvedValue({
        download: async () => [Buffer.from(JSON.stringify(compiledBlob), 'utf-8')],
      } as never);
    const signSpy = vi
      .spyOn(ObjectStorageService.prototype, 'getSignedDownloadUrl')
      .mockResolvedValue('https://signed.example.test/ph1.jpg?sig=fresh');

    try {
      // 1. Default palette (no branding stored for company b — use b's inspection? a's branding was reset to null above).
      const before = await request(app)
        .get(`/api/inspections/${insp.id}/report/preview-url`)
        .set(auth(a.superSid));
      expect(before.status).toBe(200);
      const html1 = before.body.html as string;
      // Default theme vars present; parity smoke: legacy sections intact.
      expect(html1).toContain('--report-header-bg: #1a2744');
      expect(html1).toContain('--report-accent: #3b82f6');
      expect(html1).toContain('1 — Forensic Inspection Summary');
      expect(html1).toContain('2 — Property Construction Details');
      expect(html1).toContain('3 — Photo Evidence');
      expect(html1).toContain('4 — Repairability Summary');
      expect(html1).toContain('5 — Inspector Attestation');
      expect(html1).toContain('42 Parity Way');
      expect(html1).toContain('CLM-1');
      // Narrative escaping preserved (< and & escaped).
      expect(html1).toContain('Storm damage &lt;observed&gt; &amp; documented.');
      // Fresh signed photo URL embedded.
      expect(html1).toContain('https://signed.example.test/ph1.jpg?sig=fresh');
      expect(html1).toContain('Roof — Front Slope');

      // 2. Set branding → same report immediately re-themed.
      const patch = await request(app)
        .patch(`/api/companies/${a.companyId}/report-branding`)
        .set(auth(a.superSid))
        .send({ branding: VALID });
      expect(patch.status).toBe(200);

      const after = await request(app)
        .get(`/api/inspections/${insp.id}/report/preview-url`)
        .set(auth(a.superSid));
      expect(after.status).toBe(200);
      const html2 = after.body.html as string;
      expect(html2).toContain(`--report-header-bg: ${VALID.headerColor}`);
      expect(html2).toContain(`--report-accent: ${VALID.accentColor}`);
      expect(html2).not.toContain('--report-header-bg: #1a2744');
      // Content unchanged apart from the palette.
      expect(html2).toContain('42 Parity Way');
      expect(html2).toContain('5 — Inspector Attestation');
    } finally {
      getFileSpy.mockRestore();
      signSpy.mockRestore();
      await db.delete(inspectionsTable).where(eq(inspectionsTable.id, insp.id));
      await db
        .update(companiesTable)
        .set({ reportBranding: null })
        .where(eq(companiesTable.id, a.companyId));
    }
  });

  it('isHexColor is strict', () => {
    expect(isHexColor('#abcdef')).toBe(true);
    expect(isHexColor('#ABCDEF')).toBe(true);
    expect(isHexColor('#abc')).toBe(false);
    expect(isHexColor('abcdef')).toBe(false);
    expect(isHexColor('#abcdef;')).toBe(false);
    expect(isHexColor(null)).toBe(false);
  });
});
