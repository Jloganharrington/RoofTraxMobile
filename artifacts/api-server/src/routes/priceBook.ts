import {
  db,
  priceBookItemsTable,
  priceBookPackageItemsTable,
  priceBookPackagesTable,
  userProfilesTable,
} from '@workspace/db';
import { and, eq, inArray } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';
import { z } from 'zod';

const router: IRouter = Router();

async function requireAdminOrAbove(req: Request, res: Response) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, req.user.id));
  const role = profile?.role ?? 'field_rep';
  if (role !== 'admin' && role !== 'super_admin') {
    res.status(403).json({ error: 'Admin role required' });
    return null;
  }
  return { role, companyId: req.user.companyId };
}

// ---------------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------------

const CreateItemBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  unitPrice: z.number().int().min(0), // cents
});

const UpdateItemBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  unitPrice: z.number().int().min(0).optional(),
});

router.get('/price-book/items', async (req: Request, res: Response) => {
  const actor = await requireAdminOrAbove(req, res);
  if (!actor) return;

  const items = await db
    .select()
    .from(priceBookItemsTable)
    .where(eq(priceBookItemsTable.companyId, actor.companyId))
    .orderBy(priceBookItemsTable.createdAt);

  res.json({ items });
});

router.post('/price-book/items', async (req: Request, res: Response) => {
  const actor = await requireAdminOrAbove(req, res);
  if (!actor) return;

  const parsed = CreateItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }

  const [item] = await db
    .insert(priceBookItemsTable)
    .values({
      companyId: actor.companyId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      unitPrice: parsed.data.unitPrice,
    })
    .returning();

  res.status(201).json({ item });
});

router.patch('/price-book/items/:itemId', async (req: Request, res: Response) => {
  const actor = await requireAdminOrAbove(req, res);
  if (!actor) return;

  const parsed = UpdateItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }

  const [existing] = await db
    .select({ id: priceBookItemsTable.id })
    .from(priceBookItemsTable)
    .where(
      and(
        eq(priceBookItemsTable.id, req.params.itemId),
        eq(priceBookItemsTable.companyId, actor.companyId),
      ),
    );

  if (!existing) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }

  const [updated] = await db
    .update(priceBookItemsTable)
    .set({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.unitPrice !== undefined ? { unitPrice: parsed.data.unitPrice } : {}),
      updatedAt: new Date(),
    })
    .where(eq(priceBookItemsTable.id, req.params.itemId))
    .returning();

  res.json({ item: updated });
});

router.delete('/price-book/items/:itemId', async (req: Request, res: Response) => {
  const actor = await requireAdminOrAbove(req, res);
  if (!actor) return;

  const [existing] = await db
    .select({ id: priceBookItemsTable.id })
    .from(priceBookItemsTable)
    .where(
      and(
        eq(priceBookItemsTable.id, req.params.itemId),
        eq(priceBookItemsTable.companyId, actor.companyId),
      ),
    );

  if (!existing) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }

  await db
    .delete(priceBookItemsTable)
    .where(eq(priceBookItemsTable.id, req.params.itemId));

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

const ItemAssignment = z.object({
  itemId: z.string().uuid(),
  quantity: z.number().int().min(1).default(1),
});

const INSPECTION_CONDITIONS = [
  'roof_damage',
  'siding_damage',
  'roof_and_siding_damage',
] as const;

const CreatePackageBody = z.object({
  name: z.string().min(1).max(200),
  inspectionCondition: z.enum(INSPECTION_CONDITIONS).nullable().optional(),
  itemAssignments: z.array(ItemAssignment).optional(),
});

const UpdatePackageBody = z.object({
  name: z.string().min(1).max(200).optional(),
  inspectionCondition: z.enum(INSPECTION_CONDITIONS).nullable().optional(),
  itemAssignments: z.array(ItemAssignment).optional(),
});

router.get('/price-book/packages', async (req: Request, res: Response) => {
  const actor = await requireAdminOrAbove(req, res);
  if (!actor) return;

  const packages = await db
    .select()
    .from(priceBookPackagesTable)
    .where(eq(priceBookPackagesTable.companyId, actor.companyId))
    .orderBy(priceBookPackagesTable.createdAt);

  if (packages.length === 0) {
    res.json({ packages: [] });
    return;
  }

  const packageIds = packages.map((p) => p.id);
  const assignments = await db
    .select()
    .from(priceBookPackageItemsTable)
    .where(inArray(priceBookPackageItemsTable.packageId, packageIds));

  const assignmentsByPackage = new Map<string, { itemId: string; quantity: number }[]>();
  for (const a of assignments) {
    if (!assignmentsByPackage.has(a.packageId)) assignmentsByPackage.set(a.packageId, []);
    assignmentsByPackage.get(a.packageId)!.push({ itemId: a.itemId, quantity: a.quantity });
  }

  res.json({
    packages: packages.map((p) => ({
      ...p,
      items: assignmentsByPackage.get(p.id) ?? [],
    })),
  });
});

router.post('/price-book/packages', async (req: Request, res: Response) => {
  const actor = await requireAdminOrAbove(req, res);
  if (!actor) return;

  const parsed = CreatePackageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }

  const [pkg] = await db
    .insert(priceBookPackagesTable)
    .values({
      companyId: actor.companyId,
      name: parsed.data.name,
      inspectionCondition: parsed.data.inspectionCondition ?? null,
    })
    .returning();

  if (parsed.data.itemAssignments?.length) {
    await db.insert(priceBookPackageItemsTable).values(
      parsed.data.itemAssignments.map((a) => ({
        packageId: pkg.id,
        itemId: a.itemId,
        quantity: a.quantity,
      })),
    );
  }

  res.status(201).json({
    package: { ...pkg, items: parsed.data.itemAssignments ?? [] },
  });
});

router.patch('/price-book/packages/:packageId', async (req: Request, res: Response) => {
  const actor = await requireAdminOrAbove(req, res);
  if (!actor) return;

  const parsed = UpdatePackageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }

  const [existing] = await db
    .select({ id: priceBookPackagesTable.id })
    .from(priceBookPackagesTable)
    .where(
      and(
        eq(priceBookPackagesTable.id, req.params.packageId),
        eq(priceBookPackagesTable.companyId, actor.companyId),
      ),
    );

  if (!existing) {
    res.status(404).json({ error: 'Package not found' });
    return;
  }

  const [updated] = await db
    .update(priceBookPackagesTable)
    .set({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.inspectionCondition !== undefined
        ? { inspectionCondition: parsed.data.inspectionCondition }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(priceBookPackagesTable.id, req.params.packageId))
    .returning();

  // Replace item assignments when provided
  if (parsed.data.itemAssignments !== undefined) {
    await db
      .delete(priceBookPackageItemsTable)
      .where(eq(priceBookPackageItemsTable.packageId, req.params.packageId));

    if (parsed.data.itemAssignments.length > 0) {
      await db.insert(priceBookPackageItemsTable).values(
        parsed.data.itemAssignments.map((a) => ({
          packageId: req.params.packageId,
          itemId: a.itemId,
          quantity: a.quantity,
        })),
      );
    }
  }

  const finalAssignments = await db
    .select()
    .from(priceBookPackageItemsTable)
    .where(eq(priceBookPackageItemsTable.packageId, req.params.packageId));

  res.json({
    package: {
      ...updated,
      items: finalAssignments.map((a) => ({ itemId: a.itemId, quantity: a.quantity })),
    },
  });
});

router.delete('/price-book/packages/:packageId', async (req: Request, res: Response) => {
  const actor = await requireAdminOrAbove(req, res);
  if (!actor) return;

  const [existing] = await db
    .select({ id: priceBookPackagesTable.id })
    .from(priceBookPackagesTable)
    .where(
      and(
        eq(priceBookPackagesTable.id, req.params.packageId),
        eq(priceBookPackagesTable.companyId, actor.companyId),
      ),
    );

  if (!existing) {
    res.status(404).json({ error: 'Package not found' });
    return;
  }

  await db
    .delete(priceBookPackagesTable)
    .where(eq(priceBookPackagesTable.id, req.params.packageId));

  res.json({ ok: true });
});

export default router;
