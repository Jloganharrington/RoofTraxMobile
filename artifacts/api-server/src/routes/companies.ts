import { CreateCompanyBody, CreateCompanyResponse, GetCompanyResponse } from '@workspace/api-zod';
import { companiesTable, db, userProfilesTable, usersTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

const router: IRouter = Router();

// Uppercase alphanumeric, excluding visually ambiguous characters
// (0/O, 1/I/L) so a human can read a code aloud or type it correctly.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

async function generateUniqueCompanyId(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generateCode();
    const [existing] = await db
      .select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.id, candidate));
    if (!existing) return candidate;
  }
  throw new Error('Failed to generate a unique company ID');
}

router.post('/companies', async (req: Request, res: Response) => {
  const parsed = CreateCompanyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  const id = await generateUniqueCompanyId();
  const [company] = await db
    .insert(companiesTable)
    .values({ id, name: parsed.data.name })
    .returning();

  res.status(201).json(
    CreateCompanyResponse.parse({ company: { id: company.id, name: company.name } }),
  );
});

router.get('/companies/:companyId', async (req: Request, res: Response) => {
  const companyId = (req.params.companyId as string).toUpperCase();
  const [company] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId));

  if (!company) {
    res.status(404).json({ error: 'No company with that ID' });
    return;
  }

  res.json(GetCompanyResponse.parse({ company: { id: company.id, name: company.name } }));
});

// PATCH /companies/:companyId/logo — store a company logo URL.
// Restricted to managers and admins of the target company so field reps cannot
// swap their own company's branding.
router.patch('/companies/:companyId/logo', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const companyId = (req.params.companyId as string).toUpperCase();

  // Actors may only manage their own company.
  if (req.user.companyId !== companyId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  // Look up the actor's role — only manager / admin / super_admin may set logos.
  const [actorProfile] = await db
    .select({ role: userProfilesTable.role })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, req.user.id));

  const role = actorProfile?.role ?? 'field_rep';
  if (role !== 'manager' && role !== 'admin' && role !== 'super_admin') {
    res.status(403).json({ error: 'Only managers and admins can update the company logo' });
    return;
  }

  const { logoUrl } = req.body as { logoUrl?: unknown };
  if (typeof logoUrl !== 'string' || !logoUrl.trim()) {
    res.status(400).json({ error: 'logoUrl is required' });
    return;
  }

  await db
    .update(companiesTable)
    .set({ logoUrl: logoUrl.trim() })
    .where(eq(companiesTable.id, companyId));

  res.json({ ok: true });
});

export default router;
