import { roleRank, type Role } from '@workspace/authz';
import { db, discontinuedProductsTable, userProfilesTable } from '@workspace/db';
import { and, asc, eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';
import { z } from 'zod';

// Known Product Catalog: discontinued roofing products a company maintains
// in settings. Reps read it during repairability assessments (RR-010A);
// writes are admin-gated like the price book.

const router: IRouter = Router();

function requireAuthenticated(req: Request, res: Response) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return { companyId: req.user.companyId };
}

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
  if (roleRank(role as Role) < roleRank('admin')) {
    res.status(403).json({ error: 'Admin role required' });
    return null;
  }
  return { companyId: req.user.companyId };
}

const productBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  // Servable object path returned by the upload helper (/objects/...).
  photoPath: z.string().trim().startsWith('/objects/').max(500).nullable().optional(),
  widthInches: z.number().positive().max(1000).nullable().optional(),
  exposureInches: z.number().positive().max(1000).nullable().optional(),
});

router.get('/discontinued-products', async (req, res) => {
  const auth = requireAuthenticated(req, res);
  if (!auth) return;
  const products = await db
    .select()
    .from(discontinuedProductsTable)
    .where(eq(discontinuedProductsTable.companyId, auth.companyId))
    .orderBy(asc(discontinuedProductsTable.name));
  res.json({ products });
});

router.post('/discontinued-products', async (req, res) => {
  const auth = await requireAdminOrAbove(req, res);
  if (!auth) return;
  const parsed = productBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid product', details: parsed.error.flatten() });
    return;
  }
  const [product] = await db
    .insert(discontinuedProductsTable)
    .values({
      companyId: auth.companyId,
      name: parsed.data.name,
      photoPath: parsed.data.photoPath ?? null,
      widthInches: parsed.data.widthInches ?? null,
      exposureInches: parsed.data.exposureInches ?? null,
    })
    .returning();
  res.status(201).json({ product });
});

router.patch('/discontinued-products/:id', async (req, res) => {
  const auth = await requireAdminOrAbove(req, res);
  if (!auth) return;
  const parsed = productBodySchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid product', details: parsed.error.flatten() });
    return;
  }
  const [product] = await db
    .update(discontinuedProductsTable)
    .set(parsed.data)
    .where(
      and(
        eq(discontinuedProductsTable.id, req.params.id),
        eq(discontinuedProductsTable.companyId, auth.companyId),
      ),
    )
    .returning();
  if (!product) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  res.json({ product });
});

router.delete('/discontinued-products/:id', async (req, res) => {
  const auth = await requireAdminOrAbove(req, res);
  if (!auth) return;
  const deleted = await db
    .delete(discontinuedProductsTable)
    .where(
      and(
        eq(discontinuedProductsTable.id, req.params.id),
        eq(discontinuedProductsTable.companyId, auth.companyId),
      ),
    )
    .returning({ id: discontinuedProductsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  res.status(204).end();
});

export default router;
