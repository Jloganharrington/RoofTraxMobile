/**
 * 1-R.2 Seeding Script — Reference data for ZZTEST_ALPHA
 *
 * Seeds the minimum reference data needed for Phase 2 lifecycle runs:
 *   - 2 selection categories (Roofing, Gutters)
 *   - 2 brands per category (4 total)
 *   - 3 products per brand (12 total), 1 is_base per category
 *   - 6 price-book items
 *   - 1 company_template (useCase: 'contract') via direct DB insert
 *
 * All entities are scoped to ZZTEST_ALPHA and covered by zztest-teardown.sql.
 *
 * Creation method:
 *   Selection categories/brands/products: real API (endpoints exist, requireAdminOrAbove)
 *   Price-book items: real API (POST /price-book/items, requireAdminOrAbove)
 *   company_templates: direct DB insert — POST /companies/:id/templates requires
 *     an objectPath from a prior object-storage upload; for test setup a
 *     placeholder path is used.
 */

import request from 'supertest';
import app from '../app';
import {
  db,
  usersTable,
  companyTemplatesTable,
} from '@workspace/db';
import { createSession } from '../lib/auth';
import { eq } from 'drizzle-orm';

const COMPANY_ID = 'ZZTEST_ALPHA';
const ADMIN_EMAIL = 'a-admin@zztest.local';

// ── helpers ──────────────────────────────────────────────────────────────

let stepIdx = 0;
async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  stepIdx++;
  try {
    const result = await fn();
    console.log(`  ✓ [${stepIdx}] ${label}`);
    return result;
  } catch (e: any) {
    console.error(`  ✗ [${stepIdx}] ${label}: ${e.message}`);
    throw e;
  }
}

async function getSid(): Promise<string> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, ADMIN_EMAIL));
  if (!user) throw new Error(`Admin user not found: ${ADMIN_EMAIL}`);
  return createSession({
    user: { id: user.id, email: ADMIN_EMAIL, firstName: 'Alpha', lastName: 'Admin', profileImageUrl: null, companyId: COMPANY_ID },
    access_token: 'zztest-seed-token',
  });
}

async function main() {
  console.log('\n══════════════════════════════════════');
  console.log('  1-R.2 REFERENCE DATA SEEDING');
  console.log('══════════════════════════════════════\n');

  const sid = await getSid();
  const auth = { Authorization: `Bearer ${sid}` };

  // ── SELECTION CATEGORIES ────────────────────────────────────────────────
  const catIds: Record<string, string> = {};

  for (const catName of ['Roofing', 'Gutters']) {
    const r = await step(`Create category: ${catName}`, async () => {
      const res = await request(app).post('/api/selections/categories').set(auth).send({
        name: catName,
        slug: catName.toLowerCase(),
        sortOrder: catName === 'Roofing' ? 0 : 1,
      });
      if (res.status !== 201 && res.status !== 200) throw new Error(`${res.status}: ${JSON.stringify(res.body)}`);
      return res.body;
    });
    catIds[catName] = r.category?.id ?? r.id;
  }

  // ── SELECTION BRANDS ─────────────────────────────────────────────────────
  type BrandDef = { catName: string; brandName: string };
  const brandDefs: BrandDef[] = [
    { catName: 'Roofing', brandName: 'CertainTeed' },
    { catName: 'Roofing', brandName: 'Owens Corning' },
    { catName: 'Gutters', brandName: 'LeafGuard' },
    { catName: 'Gutters', brandName: 'Alcoa' },
  ];

  const brandIds: Record<string, string> = {};

  for (const { catName, brandName } of brandDefs) {
    const r = await step(`Create brand: ${brandName} (${catName})`, async () => {
      const res = await request(app).post('/api/selections/brands').set(auth).send({
        categoryId: catIds[catName],
        name: brandName,
        sortOrder: 0,
      });
      if (res.status !== 201 && res.status !== 200) throw new Error(`${res.status}: ${JSON.stringify(res.body)}`);
      return res.body;
    });
    brandIds[`${catName}::${brandName}`] = r.brand?.id ?? r.id;
  }

  // ── SELECTION PRODUCTS ───────────────────────────────────────────────────
  type ProductDef = { catName: string; brandName: string; name: string; unit: string; isBase: boolean };
  const productDefs: ProductDef[] = [
    // Roofing × CertainTeed (is_base = Landmark TL)
    { catName: 'Roofing', brandName: 'CertainTeed', name: 'Landmark TL',         unit: 'SQ', isBase: true },
    { catName: 'Roofing', brandName: 'CertainTeed', name: 'Landmark Pro',         unit: 'SQ', isBase: false },
    { catName: 'Roofing', brandName: 'CertainTeed', name: 'Presidential Shake',   unit: 'SQ', isBase: false },
    // Roofing × Owens Corning (no is_base per category — only one per cat)
    { catName: 'Roofing', brandName: 'Owens Corning', name: 'Duration Premium',   unit: 'SQ', isBase: false },
    { catName: 'Roofing', brandName: 'Owens Corning', name: 'Timberline HDZ',     unit: 'SQ', isBase: false },
    { catName: 'Roofing', brandName: 'Owens Corning', name: 'Duration Storm',     unit: 'SQ', isBase: false },
    // Gutters × LeafGuard (is_base = 5-inch K-Style)
    { catName: 'Gutters', brandName: 'LeafGuard',   name: '5-Inch K-Style',       unit: 'LF', isBase: true },
    { catName: 'Gutters', brandName: 'LeafGuard',   name: '6-Inch K-Style',       unit: 'LF', isBase: false },
    { catName: 'Gutters', brandName: 'LeafGuard',   name: 'Half-Round 6-Inch',    unit: 'LF', isBase: false },
    // Gutters × Alcoa (no is_base)
    { catName: 'Gutters', brandName: 'Alcoa',       name: 'Aluminum 5-Inch',      unit: 'LF', isBase: false },
    { catName: 'Gutters', brandName: 'Alcoa',       name: 'Aluminum 6-Inch',      unit: 'LF', isBase: false },
    { catName: 'Gutters', brandName: 'Alcoa',       name: 'Seamless 6-Inch',      unit: 'LF', isBase: false },
  ];

  const productIds: Record<string, string> = {};

  for (const p of productDefs) {
    const key = `${p.catName}::${p.brandName}::${p.name}`;
    const r = await step(`Create product: ${p.name} (${p.brandName})`, async () => {
      const res = await request(app).post('/api/selections/products').set(auth).send({
        categoryId: catIds[p.catName],
        brandId: brandIds[`${p.catName}::${p.brandName}`],
        name: p.name,
        unit: p.unit,
        isBase: p.isBase,
        priceDeltaCents: 0,
        sortOrder: 0,
      });
      if (res.status !== 201 && res.status !== 200) throw new Error(`${res.status}: ${JSON.stringify(res.body)}`);
      return res.body;
    });
    productIds[key] = r.product?.id ?? r.id;
  }

  // ── PRICE-BOOK ITEMS ─────────────────────────────────────────────────────
  type PBItem = { name: string; unitPrice: number; unit: string; description: string };
  const pbItems: PBItem[] = [
    { name: 'Architectural Shingle Install',    unitPrice: 35000,  unit: 'SQ',  description: 'Install architectural shingles per square (100 sqft), includes underlayment.' },
    { name: 'Deck Repair — OSB Replacement',    unitPrice: 8500,   unit: 'SHT', description: 'Remove and replace damaged OSB sheathing, per 4×8 sheet.' },
    { name: 'Ice & Water Shield',               unitPrice: 4200,   unit: 'LF',  description: 'Ice & water shield membrane, per linear foot at eave.' },
    { name: 'Ridge Cap Shingles',               unitPrice: 9000,   unit: 'LF',  description: 'Ridge cap shingles, per linear foot of ridge.' },
    { name: 'Drip Edge — Aluminum',             unitPrice: 1200,   unit: 'LF',  description: 'Aluminum drip edge, per linear foot.' },
    { name: 'Roof Tear-Off',                    unitPrice: 12000,  unit: 'SQ',  description: 'Remove existing roofing material per square, includes disposal.' },
  ];

  const pbItemIds: string[] = [];
  for (const item of pbItems) {
    const r = await step(`Create price-book item: ${item.name}`, async () => {
      const res = await request(app).post('/api/price-book/items').set(auth).send({
        name: item.name,
        description: item.description,
        unitPrice: item.unitPrice,
        unit: item.unit,
      });
      if (res.status !== 201 && res.status !== 200) throw new Error(`${res.status}: ${JSON.stringify(res.body)}`);
      return res.body;
    });
    pbItemIds.push(r.item?.id ?? r.id);
  }

  // ── COMPANY TEMPLATE (direct DB insert) ──────────────────────────────────
  // POST /companies/:id/templates requires an objectPath from a prior storage
  // upload. For test setup, we insert directly with a placeholder path.
  // The template is referenced by contracts but not fetched at create-time.
  const [tmpl] = await step('Create company_template (contract, direct DB insert)', async () => {
    const [admin] = await db.select().from(usersTable).where(eq(usersTable.email, ADMIN_EMAIL));
    return db.insert(companyTemplatesTable).values({
      companyId: COMPANY_ID,
      name: 'ZZTEST Standard Contract',
      objectPath: 'zztest/templates/contract-placeholder.html',
      mimeType: 'text/html',
      useCase: 'contract',
      originalFilename: 'contract-placeholder.html',
      uploadedByUserId: admin!.id,
    }).returning();
  });

  // ── SUMMARY ─────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  SEEDING COMPLETE');
  console.log('══════════════════════════════════════');
  console.log(`\n  Categories:  ${Object.entries(catIds).map(([n, id]) => `${n}=${id.slice(-8)}`).join(', ')}`);
  console.log(`  Brands:      ${Object.keys(brandIds).length} total`);
  console.log(`  Products:    ${Object.keys(productIds).length} total`);
  console.log(`  PB Items:    ${pbItemIds.length} total`);
  console.log(`  Template:    ${tmpl.id} (useCase=contract)`);

  console.log('\n  Seeded IDs for Phase 2:');
  console.log(`    roofingCatId:   ${catIds['Roofing']}`);
  console.log(`    guttersCatId:   ${catIds['Gutters']}`);
  console.log(`    certainteedBrandId:   ${brandIds['Roofing::CertainTeed']}`);
  console.log(`    landmarkTlProductId:  ${productIds['Roofing::CertainTeed::Landmark TL']}`);
  console.log(`    shingleInstallItemId: ${pbItemIds[0]}`);
  console.log(`    templateId:           ${tmpl.id}`);

  process.exit(0);
}

main().catch(e => { console.error('\nFATAL:', e.message); process.exit(1); });
