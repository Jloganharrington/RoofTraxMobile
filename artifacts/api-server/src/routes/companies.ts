import {
  CreateCompanyBody,
  CreateCompanyResponse,
  GetCompanyResponse,
  GetCompanyFipsaSettingsResponse,
  UpdateCompanyFipsaSettingsBody,
  UpdateCompanyFipsaSettingsResponse,
} from '@workspace/api-zod';
import { companiesTable, db, userProfilesTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

import { ObjectStorageService } from '../lib/objectStorage';
import { buildSampleReportHtml, isHexColor, resolveReportTheme } from '../lib/reportTemplate';

const objectStorageService = new ObjectStorageService();

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

// GET /companies/:companyId/ai-settings — returns the stored AI settings.
// Accessible to any authenticated member of that company.
router.get('/companies/:companyId/ai-settings', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const companyId = (req.params.companyId as string).toUpperCase();
  if (req.user.companyId !== companyId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const [company] = await db
    .select({ aiSettings: companiesTable.aiSettings })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId));

  if (!company) {
    res.status(404).json({ error: 'Company not found' });
    return;
  }

  const settings = company.aiSettings as { systemPrompt?: string | null } | null | undefined;
  res.json({ settings: { systemPrompt: settings?.systemPrompt ?? null } });
});

// PATCH /companies/:companyId/ai-settings — update the custom system prompt.
// Restricted to managers and admins.
router.patch('/companies/:companyId/ai-settings', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const companyId = (req.params.companyId as string).toUpperCase();
  if (req.user.companyId !== companyId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const [actorProfile] = await db
    .select({ role: userProfilesTable.role })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, req.user.id));

  const role = actorProfile?.role ?? 'field_rep';
  if (role !== 'manager' && role !== 'admin' && role !== 'super_admin') {
    res.status(403).json({ error: 'Only managers and admins can update AI settings' });
    return;
  }

  const { systemPrompt } = req.body as { systemPrompt?: unknown };
  if (systemPrompt !== null && systemPrompt !== undefined && typeof systemPrompt !== 'string') {
    res.status(400).json({ error: 'systemPrompt must be a string or null' });
    return;
  }

  const newSettings = { systemPrompt: typeof systemPrompt === 'string' ? systemPrompt.trim() || null : null };

  await db
    .update(companiesTable)
    .set({ aiSettings: newSettings })
    .where(eq(companiesTable.id, companyId));

  res.json({ ok: true, settings: newSettings });
});

// ── Report branding (forensic report color palette) ────────────────────────

// Shared authz for FIPSA-settings routes: authenticated super admin of the
// same company. Returns the actor's companyId, or null after responding.
async function requireSameCompanySuperAdmin(
  req: Request,
  res: Response,
): Promise<string | null> {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const companyId = (req.params.companyId as string).toUpperCase();
  if (req.user.companyId !== companyId) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  const [actorProfile] = await db
    .select({ role: userProfilesTable.role })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, req.user.id));
  if ((actorProfile?.role ?? 'field_rep') !== 'super_admin') {
    res.status(403).json({ error: 'Super admin role required' });
    return null;
  }
  return companyId;
}

// GET /companies/:companyId/fipsa-settings — contractor legal name, address,
// and Documentation Fee printed on generated FIPSA agreements. Super admin
// only (field reps receive these via their profile fetch instead).
router.get('/companies/:companyId/fipsa-settings', async (req: Request, res: Response) => {
  const companyId = await requireSameCompanySuperAdmin(req, res);
  if (!companyId) return;

  const [company] = await db
    .select({
      contractorLegalName: companiesTable.contractorLegalName,
      contractorAddress: companiesTable.contractorAddress,
      fipsaFeeCents: companiesTable.fipsaFeeCents,
    })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId));

  if (!company) {
    res.status(404).json({ error: 'Company not found' });
    return;
  }

  res.json(
    GetCompanyFipsaSettingsResponse.parse({
      settings: {
        contractorLegalName: company.contractorLegalName ?? null,
        contractorAddress: company.contractorAddress ?? null,
        fipsaFeeCents: company.fipsaFeeCents ?? null,
      },
    }),
  );
});

// PATCH /companies/:companyId/fipsa-settings — super admin only. These values
// are embedded into a legal document, so they are validated and trimmed here.
router.patch('/companies/:companyId/fipsa-settings', async (req: Request, res: Response) => {
  const companyId = await requireSameCompanySuperAdmin(req, res);
  if (!companyId) return;

  const parsed = UpdateCompanyFipsaSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid FIPSA settings payload' });
    return;
  }
  const s = parsed.data.settings;

  const legalName = s.contractorLegalName?.trim() || null;
  const address = s.contractorAddress?.trim() || null;
  const feeCents = s.fipsaFeeCents ?? null;
  if (legalName !== null && legalName.length > 200) {
    res.status(400).json({ error: 'Contractor legal name is too long (max 200 characters)' });
    return;
  }
  if (address !== null && address.length > 300) {
    res.status(400).json({ error: 'Contractor address is too long (max 300 characters)' });
    return;
  }
  if (feeCents !== null && (!Number.isInteger(feeCents) || feeCents < 0 || feeCents > 100_000_00)) {
    res.status(400).json({ error: 'FIPSA fee must be a whole number of cents between 0 and $100,000' });
    return;
  }

  const [updated] = await db
    .update(companiesTable)
    .set({
      contractorLegalName: legalName,
      contractorAddress: address,
      fipsaFeeCents: feeCents,
    })
    .where(eq(companiesTable.id, companyId))
    .returning({
      contractorLegalName: companiesTable.contractorLegalName,
      contractorAddress: companiesTable.contractorAddress,
      fipsaFeeCents: companiesTable.fipsaFeeCents,
    });

  if (!updated) {
    res.status(404).json({ error: 'Company not found' });
    return;
  }

  res.json(
    UpdateCompanyFipsaSettingsResponse.parse({
      settings: {
        contractorLegalName: updated.contractorLegalName ?? null,
        contractorAddress: updated.contractorAddress ?? null,
        fipsaFeeCents: updated.fipsaFeeCents ?? null,
      },
    }),
  );
});

// GET /companies/:companyId/report-branding — returns the stored palette
// (or null when the default palette is in use). Super admin only — this
// setting is only surfaced in the super-admin settings UI.
router.get('/companies/:companyId/report-branding', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const companyId = (req.params.companyId as string).toUpperCase();
  if (req.user.companyId !== companyId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const [actorProfile] = await db
    .select({ role: userProfilesTable.role })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, req.user.id));
  if ((actorProfile?.role ?? 'field_rep') !== 'super_admin') {
    res.status(403).json({ error: 'Super admin role required' });
    return;
  }

  const [company] = await db
    .select({ reportBranding: companiesTable.reportBranding })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId));

  if (!company) {
    res.status(404).json({ error: 'Company not found' });
    return;
  }

  res.json({ branding: company.reportBranding ?? null });
});

// PATCH /companies/:companyId/report-branding — set or clear the palette.
// Super admin only. Colors are embedded into rendered report HTML, so only
// strict #RRGGBB hex values are accepted; anything else is rejected.
router.patch('/companies/:companyId/report-branding', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const companyId = (req.params.companyId as string).toUpperCase();
  if (req.user.companyId !== companyId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const [actorProfile] = await db
    .select({ role: userProfilesTable.role })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, req.user.id));
  if ((actorProfile?.role ?? 'field_rep') !== 'super_admin') {
    res.status(403).json({ error: 'Super admin role required' });
    return;
  }

  const { branding } = req.body as { branding?: unknown };

  // null clears the palette (reset to default).
  let newBranding: { headerColor: string; headerTextColor: string; accentColor: string } | null;
  if (branding === null || branding === undefined) {
    newBranding = null;
  } else if (typeof branding === 'object') {
    const b = branding as Record<string, unknown>;
    if (!isHexColor(b.headerColor) || !isHexColor(b.headerTextColor) || !isHexColor(b.accentColor)) {
      res.status(400).json({
        error: 'headerColor, headerTextColor, and accentColor must all be #RRGGBB hex colors',
      });
      return;
    }
    newBranding = {
      headerColor: (b.headerColor as string).toLowerCase(),
      headerTextColor: (b.headerTextColor as string).toLowerCase(),
      accentColor: (b.accentColor as string).toLowerCase(),
    };
  } else {
    res.status(400).json({ error: 'branding must be an object or null' });
    return;
  }

  await db
    .update(companiesTable)
    .set({ reportBranding: newBranding })
    .where(eq(companiesTable.id, companyId));

  res.json({ ok: true, branding: newBranding });
});

// GET /companies/:companyId/report-branding/preview — render a sample report
// styled with the company's CURRENT branding (palette + freshly-signed logo).
// Optional headerColor/headerTextColor/accentColor query params override the
// stored palette so admins can preview unsaved color tweaks. Super admin only,
// matching the other report-branding routes.
router.get(
  '/companies/:companyId/report-branding/preview',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const companyId = (req.params.companyId as string).toUpperCase();
    if (req.user.companyId !== companyId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const [actorProfile] = await db
      .select({ role: userProfilesTable.role })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, req.user.id));
    if ((actorProfile?.role ?? 'field_rep') !== 'super_admin') {
      res.status(403).json({ error: 'Super admin role required' });
      return;
    }

    const [company] = await db
      .select({
        name: companiesTable.name,
        reportBranding: companiesTable.reportBranding,
        logoUrl: companiesTable.logoUrl,
      })
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId));

    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    // Start from the stored palette, then apply any query-param overrides so
    // unsaved color edits can be previewed. Each override must be a strict
    // #RRGGBB hex value — anything else is rejected (these values are
    // embedded into rendered HTML).
    const stored = resolveReportTheme(company.reportBranding);
    const overrides: Partial<Record<'headerColor' | 'headerTextColor' | 'accentColor', string>> = {};
    for (const key of ['headerColor', 'headerTextColor', 'accentColor'] as const) {
      const raw = req.query[key];
      if (raw === undefined) continue;
      if (!isHexColor(raw)) {
        res.status(400).json({ error: `${key} must be a #RRGGBB hex color` });
        return;
      }
      overrides[key] = raw.toLowerCase();
    }

    // Sign the logo fresh for this render — never a stored expiring URL.
    // Best-effort: an unusable logo path just renders the cover without one.
    const logoSignedUrl = company.logoUrl
      ? await objectStorageService.tryGetSignedObjectUrl(company.logoUrl, 900)
      : null;

    const html = buildSampleReportHtml({
      theme: { ...stored, ...overrides },
      logoUrl: logoSignedUrl,
      companyName: company.name,
    });

    res.json({ html });
  },
);

export default router;
