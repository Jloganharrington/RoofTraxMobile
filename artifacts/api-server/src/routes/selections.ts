import {
  db,
  selectionCategoriesTable,
  selectionBrandsTable,
  selectionProductsTable,
  selectionOptionsTable,
  selectionProductOptionsTable,
} from '@workspace/db';
// catalog.price_book_view (GETs) / catalog.selections_manage (writes) via requirePermission.
import { requirePermission } from '../middlewares/requirePermission';
import { and, eq, asc } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';
import { z } from 'zod';

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// CATEGORIES
// ---------------------------------------------------------------------------

const CreateCategoryBody = z.object({
  name:      z.string().trim().min(1).max(120),
  slug:      z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  sortOrder: z.number().int().default(0),
});

const UpdateCategoryBody = z.object({
  name:      z.string().trim().min(1).max(120).optional(),
  slug:      z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/).optional(),
  sortOrder: z.number().int().optional(),
  isActive:  z.boolean().optional(),
});

// GET /selections/categories
router.get('/selections/categories', requirePermission('catalog.price_book_view'), async (req: Request, res: Response) => {

  const rows = await db
    .select()
    .from(selectionCategoriesTable)
    .where(eq(selectionCategoriesTable.companyId, req.actorCtx!.companyId))
    .orderBy(asc(selectionCategoriesTable.sortOrder), asc(selectionCategoriesTable.name));

  res.json({ categories: rows });
});

// POST /selections/categories
router.post('/selections/categories', requirePermission('catalog.selections_manage'), async (req: Request, res: Response) => {

  const parsed = CreateCategoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }
  const { name, slug, sortOrder } = parsed.data;

  const [row] = await db
    .insert(selectionCategoriesTable)
    .values({ companyId: req.actorCtx!.companyId, name, slug, sortOrder })
    .returning();

  res.status(201).json({ category: row });
});

// PATCH /selections/categories/:categoryId
router.patch('/selections/categories/:categoryId', requirePermission('catalog.selections_manage'), async (req: Request, res: Response) => {

  const parsed = UpdateCategoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }

  const categoryId = req.params.categoryId as string;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name      !== undefined) updates.name      = parsed.data.name;
  if (parsed.data.slug      !== undefined) updates.slug      = parsed.data.slug;
  if (parsed.data.sortOrder !== undefined) updates.sortOrder = parsed.data.sortOrder;
  if (parsed.data.isActive  !== undefined) updates.isActive  = parsed.data.isActive;

  const [row] = await db
    .update(selectionCategoriesTable)
    .set(updates)
    .where(and(
      eq(selectionCategoriesTable.id, categoryId),
      eq(selectionCategoriesTable.companyId, req.actorCtx!.companyId),
    ))
    .returning();

  if (!row) { res.status(404).json({ error: 'Category not found' }); return; }
  res.json({ category: row });
});

// DELETE /selections/categories/:categoryId
router.delete('/selections/categories/:categoryId', requirePermission('catalog.selections_manage'), async (req: Request, res: Response) => {

  const categoryId = req.params.categoryId as string;

  const refs = await db
    .select({ id: selectionBrandsTable.id })
    .from(selectionBrandsTable)
    .where(and(
      eq(selectionBrandsTable.categoryId, categoryId),
      eq(selectionBrandsTable.companyId, req.actorCtx!.companyId),
    ))
    .limit(1);

  if (refs.length > 0) {
    const [row] = await db
      .update(selectionCategoriesTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(
        eq(selectionCategoriesTable.id, categoryId),
        eq(selectionCategoriesTable.companyId, req.actorCtx!.companyId),
      ))
      .returning();
    if (!row) { res.status(404).json({ error: 'Category not found' }); return; }
    res.json({ ok: true, softDeleted: true });
  } else {
    const [row] = await db
      .delete(selectionCategoriesTable)
      .where(and(
        eq(selectionCategoriesTable.id, categoryId),
        eq(selectionCategoriesTable.companyId, req.actorCtx!.companyId),
      ))
      .returning();
    if (!row) { res.status(404).json({ error: 'Category not found' }); return; }
    res.json({ ok: true, softDeleted: false });
  }
});

// ---------------------------------------------------------------------------
// BRANDS
// ---------------------------------------------------------------------------

const CreateBrandBody = z.object({
  categoryId: z.string().min(1),
  name:       z.string().trim().min(1).max(120),
  logoPath:   z.string().nullable().optional(),
  sortOrder:  z.number().int().default(0),
});

const UpdateBrandBody = z.object({
  name:      z.string().trim().min(1).max(120).optional(),
  logoPath:  z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive:  z.boolean().optional(),
});

// GET /selections/brands?categoryId=
router.get('/selections/brands', requirePermission('catalog.price_book_view'), async (req: Request, res: Response) => {

  const categoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined;
  const companyId = req.actorCtx!.companyId;

  const rows = await db
    .select()
    .from(selectionBrandsTable)
    .where(
      categoryId
        ? and(eq(selectionBrandsTable.companyId, companyId), eq(selectionBrandsTable.categoryId, categoryId))
        : eq(selectionBrandsTable.companyId, companyId),
    )
    .orderBy(asc(selectionBrandsTable.sortOrder), asc(selectionBrandsTable.name));

  res.json({ brands: rows });
});

// POST /selections/brands
router.post('/selections/brands', requirePermission('catalog.selections_manage'), async (req: Request, res: Response) => {

  const parsed = CreateBrandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }
  const { categoryId, name, logoPath, sortOrder } = parsed.data;

  const [cat] = await db
    .select({ id: selectionCategoriesTable.id })
    .from(selectionCategoriesTable)
    .where(and(
      eq(selectionCategoriesTable.id, categoryId),
      eq(selectionCategoriesTable.companyId, req.actorCtx!.companyId),
    ));
  if (!cat) { res.status(400).json({ error: 'Category not found' }); return; }

  const [row] = await db
    .insert(selectionBrandsTable)
    .values({ companyId: req.actorCtx!.companyId, categoryId, name, logoPath: logoPath ?? null, sortOrder })
    .returning();

  res.status(201).json({ brand: row });
});

// PATCH /selections/brands/:brandId
router.patch('/selections/brands/:brandId', requirePermission('catalog.selections_manage'), async (req: Request, res: Response) => {

  const parsed = UpdateBrandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }

  const brandId = req.params.brandId as string;
  const companyId = req.actorCtx!.companyId;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name      !== undefined) updates.name      = parsed.data.name;
  if (parsed.data.logoPath  !== undefined) updates.logoPath  = parsed.data.logoPath;
  if (parsed.data.sortOrder !== undefined) updates.sortOrder = parsed.data.sortOrder;
  if (parsed.data.isActive  !== undefined) {
    updates.isActive = parsed.data.isActive;
    if (!parsed.data.isActive) {
      await db
        .update(selectionProductsTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(selectionProductsTable.brandId, brandId), eq(selectionProductsTable.companyId, companyId)));
      await db
        .update(selectionOptionsTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(selectionOptionsTable.brandId, brandId), eq(selectionOptionsTable.companyId, companyId)));
    }
  }

  const [row] = await db
    .update(selectionBrandsTable)
    .set(updates)
    .where(and(eq(selectionBrandsTable.id, brandId), eq(selectionBrandsTable.companyId, companyId)))
    .returning();

  if (!row) { res.status(404).json({ error: 'Brand not found' }); return; }
  res.json({ brand: row });
});

// DELETE /selections/brands/:brandId
router.delete('/selections/brands/:brandId', requirePermission('catalog.selections_manage'), async (req: Request, res: Response) => {

  const brandId = req.params.brandId as string;
  const companyId = req.actorCtx!.companyId;

  const prodRefs = await db
    .select({ id: selectionProductsTable.id })
    .from(selectionProductsTable)
    .where(and(eq(selectionProductsTable.brandId, brandId), eq(selectionProductsTable.companyId, companyId)))
    .limit(1);

  const optRefs = await db
    .select({ id: selectionOptionsTable.id })
    .from(selectionOptionsTable)
    .where(and(eq(selectionOptionsTable.brandId, brandId), eq(selectionOptionsTable.companyId, companyId)))
    .limit(1);

  if (prodRefs.length > 0 || optRefs.length > 0) {
    await db
      .update(selectionProductsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(selectionProductsTable.brandId, brandId), eq(selectionProductsTable.companyId, companyId)));
    await db
      .update(selectionOptionsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(selectionOptionsTable.brandId, brandId), eq(selectionOptionsTable.companyId, companyId)));
    const [row] = await db
      .update(selectionBrandsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(selectionBrandsTable.id, brandId), eq(selectionBrandsTable.companyId, companyId)))
      .returning();
    if (!row) { res.status(404).json({ error: 'Brand not found' }); return; }
    res.json({ ok: true, softDeleted: true });
  } else {
    const [row] = await db
      .delete(selectionBrandsTable)
      .where(and(eq(selectionBrandsTable.id, brandId), eq(selectionBrandsTable.companyId, companyId)))
      .returning();
    if (!row) { res.status(404).json({ error: 'Brand not found' }); return; }
    res.json({ ok: true, softDeleted: false });
  }
});

// ---------------------------------------------------------------------------
// PRODUCTS (tiers)
// ---------------------------------------------------------------------------

const CreateProductBody = z.object({
  categoryId:       z.string().min(1),
  brandId:          z.string().min(1),
  name:             z.string().trim().min(1).max(200),
  description:      z.string().nullable().optional(),
  specs:            z.record(z.unknown()).nullable().optional(),
  isBase:           z.boolean().default(false),
  priceDeltaCents:  z.number().int().default(0),
  unit:             z.string().trim().min(1).max(60),
  sortOrder:        z.number().int().default(0),
});

const UpdateProductBody = z.object({
  name:             z.string().trim().min(1).max(200).optional(),
  description:      z.string().nullable().optional(),
  specs:            z.record(z.unknown()).nullable().optional(),
  isBase:           z.boolean().optional(),
  priceDeltaCents:  z.number().int().optional(),
  unit:             z.string().trim().min(1).max(60).optional(),
  sortOrder:        z.number().int().optional(),
  isActive:         z.boolean().optional(),
});

// GET /selections/products?categoryId=&brandId=
router.get('/selections/products', requirePermission('catalog.price_book_view'), async (req: Request, res: Response) => {

  const categoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined;
  const brandId    = typeof req.query.brandId    === 'string' ? req.query.brandId    : undefined;
  const companyId = req.actorCtx!.companyId;

  const where =
    categoryId && brandId
      ? and(eq(selectionProductsTable.companyId, companyId), eq(selectionProductsTable.categoryId, categoryId), eq(selectionProductsTable.brandId, brandId))
      : categoryId
        ? and(eq(selectionProductsTable.companyId, companyId), eq(selectionProductsTable.categoryId, categoryId))
        : brandId
          ? and(eq(selectionProductsTable.companyId, companyId), eq(selectionProductsTable.brandId, brandId))
          : eq(selectionProductsTable.companyId, companyId);

  const rows = await db
    .select()
    .from(selectionProductsTable)
    .where(where)
    .orderBy(asc(selectionProductsTable.sortOrder), asc(selectionProductsTable.name));

  res.json({ products: rows });
});

// POST /selections/products
router.post('/selections/products', requirePermission('catalog.selections_manage'), async (req: Request, res: Response) => {

  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const companyId = req.actorCtx!.companyId;

  if (d.isBase && d.priceDeltaCents !== 0) {
    res.status(400).json({ error: 'Base product must have price_delta_cents = 0' });
    return;
  }

  const [brand] = await db
    .select({ categoryId: selectionBrandsTable.categoryId })
    .from(selectionBrandsTable)
    .where(and(eq(selectionBrandsTable.id, d.brandId), eq(selectionBrandsTable.companyId, companyId)));
  if (!brand) { res.status(400).json({ error: 'Brand not found' }); return; }
  if (brand.categoryId !== d.categoryId) {
    res.status(400).json({ error: 'Brand does not belong to the specified category' });
    return;
  }

  const [row] = await db.transaction(async (tx) => {
    if (d.isBase) {
      await tx
        .update(selectionProductsTable)
        .set({ isBase: false, updatedAt: new Date() })
        .where(and(
          eq(selectionProductsTable.companyId, companyId),
          eq(selectionProductsTable.categoryId, d.categoryId),
          eq(selectionProductsTable.isBase, true),
        ));
    }
    return tx
      .insert(selectionProductsTable)
      .values({
        companyId,
        categoryId:      d.categoryId,
        brandId:         d.brandId,
        name:            d.name,
        description:     d.description ?? null,
        specs:           d.specs ?? null,
        isBase:          d.isBase,
        priceDeltaCents: d.priceDeltaCents,
        unit:            d.unit,
        sortOrder:       d.sortOrder,
      })
      .returning();
  });

  res.status(201).json({ product: row });
});

// PATCH /selections/products/:productId
router.patch('/selections/products/:productId', requirePermission('catalog.selections_manage'), async (req: Request, res: Response) => {

  const parsed = UpdateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }

  const productId = req.params.productId as string;
  const companyId = req.actorCtx!.companyId;
  const d = parsed.data;

  const [current] = await db
    .select()
    .from(selectionProductsTable)
    .where(and(eq(selectionProductsTable.id, productId), eq(selectionProductsTable.companyId, companyId)));
  if (!current) { res.status(404).json({ error: 'Product not found' }); return; }

  const effectiveDelta  = d.priceDeltaCents ?? current.priceDeltaCents;
  const effectiveIsBase = d.isBase          ?? current.isBase;
  if (effectiveIsBase && effectiveDelta !== 0) {
    res.status(400).json({ error: 'Base product must have price_delta_cents = 0' });
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (d.name            !== undefined) updates.name            = d.name;
  if (d.description     !== undefined) updates.description     = d.description;
  if (d.specs           !== undefined) updates.specs           = d.specs;
  if (d.priceDeltaCents !== undefined) updates.priceDeltaCents = d.priceDeltaCents;
  if (d.unit            !== undefined) updates.unit            = d.unit;
  if (d.sortOrder       !== undefined) updates.sortOrder       = d.sortOrder;
  if (d.isActive        !== undefined) updates.isActive        = d.isActive;
  if (d.isBase          !== undefined) updates.isBase          = d.isBase;

  const [row] = await db.transaction(async (tx) => {
    if (d.isBase === true && !current.isBase) {
      await tx
        .update(selectionProductsTable)
        .set({ isBase: false, updatedAt: new Date() })
        .where(and(
          eq(selectionProductsTable.companyId, companyId),
          eq(selectionProductsTable.categoryId, current.categoryId),
          eq(selectionProductsTable.isBase, true),
        ));
    }
    return tx
      .update(selectionProductsTable)
      .set(updates)
      .where(and(eq(selectionProductsTable.id, productId), eq(selectionProductsTable.companyId, companyId)))
      .returning();
  });

  if (!row) { res.status(404).json({ error: 'Product not found' }); return; }
  res.json({ product: row });
});

// DELETE /selections/products/:productId
router.delete('/selections/products/:productId', requirePermission('catalog.selections_manage'), async (req: Request, res: Response) => {

  const productId = req.params.productId as string;
  const companyId = req.actorCtx!.companyId;

  const refs = await db
    .select({ id: selectionProductOptionsTable.id })
    .from(selectionProductOptionsTable)
    .where(and(eq(selectionProductOptionsTable.productId, productId), eq(selectionProductOptionsTable.companyId, companyId)))
    .limit(1);

  if (refs.length > 0) {
    const [row] = await db
      .update(selectionProductsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(selectionProductsTable.id, productId), eq(selectionProductsTable.companyId, companyId)))
      .returning();
    if (!row) { res.status(404).json({ error: 'Product not found' }); return; }
    res.json({ ok: true, softDeleted: true });
  } else {
    const [row] = await db
      .delete(selectionProductsTable)
      .where(and(eq(selectionProductsTable.id, productId), eq(selectionProductsTable.companyId, companyId)))
      .returning();
    if (!row) { res.status(404).json({ error: 'Product not found' }); return; }
    res.json({ ok: true, softDeleted: false });
  }
});

// ---------------------------------------------------------------------------
// OPTIONS (colours)
// ---------------------------------------------------------------------------

const CreateOptionBody = z.object({
  brandId:          z.string().min(1),
  name:             z.string().trim().min(1).max(120),
  optionGroup:      z.string().trim().max(80).nullable().optional(),
  swatchHex:        z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  swatchImagePath:  z.string().nullable().optional(),
  hoaCompliant:     z.boolean().nullable().optional(),
  sortOrder:        z.number().int().default(0),
}).refine(
  (d) => d.swatchHex != null || d.swatchImagePath != null,
  { message: 'At least one of swatchHex or swatchImagePath is required' },
);

const UpdateOptionBody = z.object({
  name:             z.string().trim().min(1).max(120).optional(),
  optionGroup:      z.string().trim().max(80).nullable().optional(),
  swatchHex:        z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  swatchImagePath:  z.string().nullable().optional(),
  hoaCompliant:     z.boolean().nullable().optional(),
  sortOrder:        z.number().int().optional(),
  isActive:         z.boolean().optional(),
});

// GET /selections/options?brandId=
router.get('/selections/options', requirePermission('catalog.price_book_view'), async (req: Request, res: Response) => {

  const brandId = typeof req.query.brandId === 'string' ? req.query.brandId : undefined;
  const companyId = req.actorCtx!.companyId;

  const rows = await db
    .select()
    .from(selectionOptionsTable)
    .where(
      brandId
        ? and(eq(selectionOptionsTable.companyId, companyId), eq(selectionOptionsTable.brandId, brandId))
        : eq(selectionOptionsTable.companyId, companyId),
    )
    .orderBy(asc(selectionOptionsTable.optionGroup), asc(selectionOptionsTable.sortOrder), asc(selectionOptionsTable.name));

  res.json({ options: rows });
});

// POST /selections/options
router.post('/selections/options', requirePermission('catalog.selections_manage'), async (req: Request, res: Response) => {

  const parsed = CreateOptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const companyId = req.actorCtx!.companyId;

  const [brand] = await db
    .select({ id: selectionBrandsTable.id })
    .from(selectionBrandsTable)
    .where(and(eq(selectionBrandsTable.id, d.brandId), eq(selectionBrandsTable.companyId, companyId)));
  if (!brand) { res.status(400).json({ error: 'Brand not found' }); return; }

  const [row] = await db
    .insert(selectionOptionsTable)
    .values({
      companyId,
      brandId:          d.brandId,
      name:             d.name,
      optionGroup:      d.optionGroup ?? null,
      swatchHex:        d.swatchHex ?? null,
      swatchImagePath:  d.swatchImagePath ?? null,
      hoaCompliant:     d.hoaCompliant ?? null,
      sortOrder:        d.sortOrder,
    })
    .returning();

  res.status(201).json({ option: row });
});

// PATCH /selections/options/:optionId
router.patch('/selections/options/:optionId', requirePermission('catalog.selections_manage'), async (req: Request, res: Response) => {

  const parsed = UpdateOptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }

  const optionId = req.params.optionId as string;
  const companyId = req.actorCtx!.companyId;
  const d = parsed.data;

  const [current] = await db
    .select()
    .from(selectionOptionsTable)
    .where(and(eq(selectionOptionsTable.id, optionId), eq(selectionOptionsTable.companyId, companyId)));
  if (!current) { res.status(404).json({ error: 'Option not found' }); return; }

  const effectiveHex  = d.swatchHex       !== undefined ? d.swatchHex       : current.swatchHex;
  const effectivePath = d.swatchImagePath  !== undefined ? d.swatchImagePath : current.swatchImagePath;
  if (!effectiveHex && !effectivePath) {
    res.status(400).json({ error: 'At least one of swatchHex or swatchImagePath is required' });
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (d.name            !== undefined) updates.name            = d.name;
  if (d.optionGroup     !== undefined) updates.optionGroup     = d.optionGroup;
  if (d.swatchHex       !== undefined) updates.swatchHex       = d.swatchHex;
  if (d.swatchImagePath !== undefined) updates.swatchImagePath = d.swatchImagePath;
  if (d.hoaCompliant    !== undefined) updates.hoaCompliant    = d.hoaCompliant;
  if (d.sortOrder       !== undefined) updates.sortOrder       = d.sortOrder;
  if (d.isActive        !== undefined) updates.isActive        = d.isActive;

  const [row] = await db
    .update(selectionOptionsTable)
    .set(updates)
    .where(and(eq(selectionOptionsTable.id, optionId), eq(selectionOptionsTable.companyId, companyId)))
    .returning();

  if (!row) { res.status(404).json({ error: 'Option not found' }); return; }
  res.json({ option: row });
});

// DELETE /selections/options/:optionId
router.delete('/selections/options/:optionId', requirePermission('catalog.selections_manage'), async (req: Request, res: Response) => {

  const optionId = req.params.optionId as string;
  const companyId = req.actorCtx!.companyId;

  const refs = await db
    .select({ id: selectionProductOptionsTable.id })
    .from(selectionProductOptionsTable)
    .where(and(eq(selectionProductOptionsTable.optionId, optionId), eq(selectionProductOptionsTable.companyId, companyId)))
    .limit(1);

  if (refs.length > 0) {
    const [row] = await db
      .update(selectionOptionsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(selectionOptionsTable.id, optionId), eq(selectionOptionsTable.companyId, companyId)))
      .returning();
    if (!row) { res.status(404).json({ error: 'Option not found' }); return; }
    res.json({ ok: true, softDeleted: true });
  } else {
    const [row] = await db
      .delete(selectionOptionsTable)
      .where(and(eq(selectionOptionsTable.id, optionId), eq(selectionOptionsTable.companyId, companyId)))
      .returning();
    if (!row) { res.status(404).json({ error: 'Option not found' }); return; }
    res.json({ ok: true, softDeleted: false });
  }
});

// ---------------------------------------------------------------------------
// PRODUCT-OPTIONS (availability mapping)
// ---------------------------------------------------------------------------

const CreateProductOptionBody = z.object({
  productId: z.string().min(1),
  optionId:  z.string().min(1),
});

const BulkApplyBody = z.object({
  brandId:   z.string().min(1),
  optionIds: z.array(z.string().min(1)).min(1),
});

// GET /selections/product-options?productId=
router.get('/selections/product-options', requirePermission('catalog.price_book_view'), async (req: Request, res: Response) => {

  const productId = typeof req.query.productId === 'string' ? req.query.productId : undefined;
  const companyId = req.actorCtx!.companyId;

  const rows = await db
    .select()
    .from(selectionProductOptionsTable)
    .where(
      productId
        ? and(eq(selectionProductOptionsTable.companyId, companyId), eq(selectionProductOptionsTable.productId, productId))
        : eq(selectionProductOptionsTable.companyId, companyId),
    );

  res.json({ productOptions: rows });
});

// POST /selections/product-options/bulk — must be registered BEFORE /:id routes
router.post('/selections/product-options/bulk', requirePermission('catalog.selections_manage'), async (req: Request, res: Response) => {

  const parsed = BulkApplyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }
  const { brandId, optionIds } = parsed.data;
  const companyId = req.actorCtx!.companyId;

  const options = await db
    .select({ id: selectionOptionsTable.id })
    .from(selectionOptionsTable)
    .where(and(eq(selectionOptionsTable.companyId, companyId), eq(selectionOptionsTable.brandId, brandId)));
  const validIds = new Set(options.map(o => o.id));
  const invalid = optionIds.filter(id => !validIds.has(id));
  if (invalid.length > 0) {
    res.status(400).json({ error: 'Some options do not belong to the specified brand', invalid });
    return;
  }

  const products = await db
    .select({ id: selectionProductsTable.id })
    .from(selectionProductsTable)
    .where(and(eq(selectionProductsTable.companyId, companyId), eq(selectionProductsTable.brandId, brandId)));

  if (products.length === 0) {
    res.json({ created: 0 });
    return;
  }

  const rows = products.flatMap(p =>
    optionIds.map(oid => ({ companyId, productId: p.id, optionId: oid })),
  );

  await db.insert(selectionProductOptionsTable).values(rows).onConflictDoNothing();
  res.json({ created: rows.length });
});

// POST /selections/product-options
router.post('/selections/product-options', requirePermission('catalog.selections_manage'), async (req: Request, res: Response) => {

  const parsed = CreateProductOptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }
  const { productId, optionId } = parsed.data;
  const companyId = req.actorCtx!.companyId;

  const [product] = await db
    .select({ brandId: selectionProductsTable.brandId })
    .from(selectionProductsTable)
    .where(and(eq(selectionProductsTable.id, productId), eq(selectionProductsTable.companyId, companyId)));
  if (!product) { res.status(400).json({ error: 'Product not found' }); return; }

  const [option] = await db
    .select({ brandId: selectionOptionsTable.brandId })
    .from(selectionOptionsTable)
    .where(and(eq(selectionOptionsTable.id, optionId), eq(selectionOptionsTable.companyId, companyId)));
  if (!option) { res.status(400).json({ error: 'Option not found' }); return; }

  if (product.brandId !== option.brandId) {
    res.status(400).json({ error: 'Option brand does not match product brand — a CertainTeed colour cannot be mapped onto a Mastic product' });
    return;
  }

  const [row] = await db
    .insert(selectionProductOptionsTable)
    .values({ companyId, productId, optionId })
    .onConflictDoNothing()
    .returning();

  res.status(201).json({ productOption: row ?? null });
});

// DELETE /selections/product-options/:id
router.delete('/selections/product-options/:id', requirePermission('catalog.selections_manage'), async (req: Request, res: Response) => {

  const [row] = await db
    .delete(selectionProductOptionsTable)
    .where(and(
      eq(selectionProductOptionsTable.id, req.params.id as string),
      eq(selectionProductOptionsTable.companyId, req.actorCtx!.companyId),
    ))
    .returning();

  if (!row) { res.status(404).json({ error: 'Mapping not found' }); return; }
  res.json({ ok: true });
});

export default router;
