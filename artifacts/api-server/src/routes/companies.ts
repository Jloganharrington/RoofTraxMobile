import { CreateCompanyBody, CreateCompanyResponse, GetCompanyResponse } from '@workspace/api-zod';
import { companiesTable, db } from '@workspace/db';
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

export default router;
