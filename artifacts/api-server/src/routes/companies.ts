import {
  CreateCompanyBody,
  CreateCompanyResponse,
  GetCompanyResponse,
  GetCompanyFipsaSettingsResponse,
  UpdateCompanyFipsaSettingsBody,
  UpdateCompanyFipsaSettingsResponse,
  GetCompanyReportSettingsResponse,
  UpdateCompanyReportSettingsBody,
  UpdateCompanyReportSettingsResponse,
  ListCompanyJurisdictionPacksResponse,
  UpsertCompanyJurisdictionPackBody,
  UpsertCompanyJurisdictionPackResponse,
  ResearchJurisdictionCodesBody,
  ResearchJurisdictionCodesResponse,
} from '@workspace/api-zod';
import { companiesTable, companyJurisdictionPacksTable, db, userProfilesTable } from '@workspace/db';
import { ai as geminiAi } from '@workspace/integrations-gemini-ai';
import { and, eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

import { ObjectStorageService } from '../lib/objectStorage';
import { buildSampleProofPackageHtml } from '../lib/proofPackageTemplate';
import { isHexColor, resolveReportTheme } from '../lib/reportTemplate';

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

// ── Proof Package settings (licenses, qualifications, pricing basis) ───────

// GET /companies/:companyId/report-settings — super admin only.
router.get('/companies/:companyId/report-settings', async (req: Request, res: Response) => {
  const companyId = await requireSameCompanySuperAdmin(req, res);
  if (!companyId) return;

  const [company] = await db
    .select({
      contractorLicenses: companiesTable.contractorLicenses,
      qualificationsText: companiesTable.qualificationsText,
      pricingBasisStatement: companiesTable.pricingBasisStatement,
    })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId));
  if (!company) {
    res.status(404).json({ error: 'Company not found' });
    return;
  }

  res.json(
    GetCompanyReportSettingsResponse.parse({
      settings: {
        licenses: company.contractorLicenses ?? [],
        qualificationsText: company.qualificationsText ?? null,
        pricingBasisStatement: company.pricingBasisStatement ?? null,
      },
    }),
  );
});

// PATCH /companies/:companyId/report-settings — super admin only. These
// values are embedded into the Proof Package, so they are validated + trimmed.
router.patch('/companies/:companyId/report-settings', async (req: Request, res: Response) => {
  const companyId = await requireSameCompanySuperAdmin(req, res);
  if (!companyId) return;

  const parsed = UpdateCompanyReportSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid report settings payload' });
    return;
  }
  const s = parsed.data.settings;

  const licenses = s.licenses.map((l) => ({
    state: l.state.trim().toUpperCase(),
    number: l.number.trim(),
    classification: l.classification.trim(),
  }));
  if (licenses.some((l) => !/^[A-Z]{2}$/.test(l.state) || !l.number || !l.classification)) {
    res.status(400).json({ error: 'Each license needs a 2-letter state, number, and classification' });
    return;
  }

  const [updated] = await db
    .update(companiesTable)
    .set({
      contractorLicenses: licenses,
      qualificationsText: s.qualificationsText?.trim() || null,
      pricingBasisStatement: s.pricingBasisStatement?.trim() || null,
    })
    .where(eq(companiesTable.id, companyId))
    .returning({
      contractorLicenses: companiesTable.contractorLicenses,
      qualificationsText: companiesTable.qualificationsText,
      pricingBasisStatement: companiesTable.pricingBasisStatement,
    });
  if (!updated) {
    res.status(404).json({ error: 'Company not found' });
    return;
  }

  res.json(
    UpdateCompanyReportSettingsResponse.parse({
      settings: {
        licenses: updated.contractorLicenses ?? [],
        qualificationsText: updated.qualificationsText ?? null,
        pricingBasisStatement: updated.pricingBasisStatement ?? null,
      },
    }),
  );
});

// ── Building Regulation Jurisdiction Packs (opening statements / UPPA /
// general+roofing+siding code citations) ────────────────────────────────────

function jurisdictionPackToWire(pack: {
  id: string;
  jurisdiction: string;
  state: string;
  openingStatements: unknown;
  uppaLaw: string | null;
  uppaStatement: string | null;
  generalCodeCitations: unknown;
  roofingCodeCitations: unknown;
  sidingCodeCitations: unknown;
}) {
  return {
    id: pack.id,
    jurisdiction: pack.jurisdiction,
    state: pack.state,
    openingStatements: pack.openingStatements ?? [],
    uppaLaw: pack.uppaLaw ?? null,
    uppaStatement: pack.uppaStatement ?? null,
    generalCodeCitations: pack.generalCodeCitations ?? [],
    roofingCodeCitations: pack.roofingCodeCitations ?? [],
    sidingCodeCitations: pack.sidingCodeCitations ?? [],
  };
}

// GET /companies/:companyId/jurisdiction-packs — super admin only.
router.get('/companies/:companyId/jurisdiction-packs', async (req: Request, res: Response) => {
  const companyId = await requireSameCompanySuperAdmin(req, res);
  if (!companyId) return;

  const packs = await db
    .select()
    .from(companyJurisdictionPacksTable)
    .where(eq(companyJurisdictionPacksTable.companyId, companyId));

  res.json(
    ListCompanyJurisdictionPacksResponse.parse({
      packs: packs
        .sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction))
        .map(jurisdictionPackToWire),
    }),
  );
});

// PUT /companies/:companyId/jurisdiction-packs/upsert — super admin.
// pack.id present = update that pack; absent = create a new pack.
router.put(
  '/companies/:companyId/jurisdiction-packs/upsert',
  async (req: Request, res: Response) => {
    const companyId = await requireSameCompanySuperAdmin(req, res);
    if (!companyId) return;

    const parsed = UpsertCompanyJurisdictionPackBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid jurisdiction pack payload' });
      return;
    }
    const p = parsed.data.pack;

    const jurisdiction = p.jurisdiction.trim();
    if (!jurisdiction) {
      res.status(400).json({ error: 'Jurisdiction name is required' });
      return;
    }
    const state = p.state.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) {
      res.status(400).json({ error: 'State must be a 2-letter code' });
      return;
    }

    // Citation keys are the selection identity at compile time — duplicates
    // ACROSS all three sections would make per-compile selection ambiguous.
    const keys = [...p.generalCodeCitations, ...p.roofingCodeCitations, ...p.sidingCodeCitations]
      .map((c) => c.key.trim().toLowerCase());
    if (new Set(keys).size !== keys.length) {
      res.status(400).json({ error: 'Code citation keys must be unique within the pack' });
      return;
    }

    const values = {
      companyId,
      jurisdiction,
      state,
      openingStatements: p.openingStatements,
      uppaLaw: p.uppaLaw?.trim() || null,
      uppaStatement: p.uppaStatement?.trim() || null,
      generalCodeCitations: p.generalCodeCitations,
      roofingCodeCitations: p.roofingCodeCitations,
      sidingCodeCitations: p.sidingCodeCitations,
    };

    let saved: typeof companyJurisdictionPacksTable.$inferSelect | undefined;
    try {
      if (p.id) {
        [saved] = await db
          .update(companyJurisdictionPacksTable)
          .set(values)
          .where(
            and(
              eq(companyJurisdictionPacksTable.id, p.id),
              eq(companyJurisdictionPacksTable.companyId, companyId),
            ),
          )
          .returning();
        if (!saved) {
          res.status(404).json({ error: 'Jurisdiction pack not found' });
          return;
        }
      } else {
        [saved] = await db.insert(companyJurisdictionPacksTable).values(values).returning();
      }
    } catch (err) {
      // Unique (companyId, jurisdiction) violation → duplicate name.
      if ((err as { code?: string }).code === '23505') {
        res.status(400).json({ error: `A pack named "${jurisdiction}" already exists` });
        return;
      }
      throw err;
    }

    res.json(
      UpsertCompanyJurisdictionPackResponse.parse({ pack: jurisdictionPackToWire(saved!) }),
    );
  },
);

// DELETE /companies/:companyId/jurisdiction-packs/:packId — super admin.
router.delete(
  '/companies/:companyId/jurisdiction-packs/:packId',
  async (req: Request, res: Response) => {
    const companyId = await requireSameCompanySuperAdmin(req, res);
    if (!companyId) return;

    const [deleted] = await db
      .delete(companyJurisdictionPacksTable)
      .where(
        and(
          eq(companyJurisdictionPacksTable.id, String(req.params.packId)),
          eq(companyJurisdictionPacksTable.companyId, companyId),
        ),
      )
      .returning({ id: companyJurisdictionPacksTable.id });

    if (!deleted) {
      res.status(404).json({ error: 'Jurisdiction pack not found' });
      return;
    }
    res.json({ deleted: true });
  },
);

// POST /companies/:companyId/jurisdiction-packs/:state/code-research — AI wizard.
// Researches building codes applicable to storm-damage roof/siding work in
// the given state (or looks up a specific code the admin typed) and returns
// SUGGESTED citations. Nothing is persisted here — the client adds confirmed
// suggestions to the pack via the upsert endpoint. Super admin only.
router.post(
  '/companies/:companyId/jurisdiction-packs/:state/code-research',
  async (req: Request, res: Response) => {
    const companyId = await requireSameCompanySuperAdmin(req, res);
    if (!companyId) return;

    const state = String(req.params.state ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) {
      res.status(400).json({ error: 'State must be a 2-letter code' });
      return;
    }

    const parsed = ResearchJurisdictionCodesBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload' });
      return;
    }
    const query = parsed.data.query?.trim() || null;
    const editionYear = parsed.data.editionYear ?? null;
    const existingKeys = (parsed.data.existingKeys ?? []).slice(0, 100);
    const category = parsed.data.category ?? null;

    const editionInstruction = editionYear
      ? `Research the ${editionYear} code edition specifically (e.g. the ${editionYear} IRC/IBC or the state code based on it). All citations and quoted language must come from that edition; if a requirement does not exist in that edition, omit it.`
      : `Use the code edition currently adopted by the state where you know it; otherwise use the latest model code edition you are confident about.`;

    const categoryInstruction =
      category === 'roofing'
        ? 'Focus on ROOFING code requirements (roof coverings, underlayment, drip edge, ice barrier, flashing, decking, ventilation, roof repair/replacement triggers).'
        : category === 'siding'
          ? 'Focus on SIDING / exterior wall covering code requirements (siding attachment, weather-resistive barriers, flashing at openings, matching/repair limitations for wall coverings).'
          : category === 'general'
            ? 'Focus on GENERAL building code requirements that frame the work (permits, adopted code editions, existing-building/alteration provisions, workmanship and material standards).'
            : '';

    const prompt = `You are a building-code research assistant for a licensed storm-restoration roofing contractor operating in the U.S. state with postal code "${state}".

${
  query
    ? `The contractor asked you to look up this specific code or topic: "${query}". Return only citations directly responsive to that request (usually 1-3).`
    : `Survey the building codes that most commonly apply to storm-damage roof and siding replacement in that state (typically the state-adopted edition of the IRC/IBC plus any state amendments). Return the 5-8 most load-bearing citations a carrier would scrutinize (e.g. drip edge, ice barrier, underlayment, flashing, matching/repair limitations, permit triggers).`
}
${categoryInstruction}

Rules:
- Only include codes you are confident actually exist. ${editionInstruction} Include the edition year in "cite" (e.g. "2021 IRC R905.2.8.5").
- "body" must start with the exact language of the code section, quoted verbatim and wrapped in double quotes, followed by 1-2 plain-text sentences explaining why it matters on a storm claim. If you are not confident of the exact wording, paraphrase closely and do NOT wrap it in quotes.
- Plain text only. No HTML, no markdown.
- Do not duplicate these existing citation keys: ${JSON.stringify(existingKeys)}.

Respond with JSON only, in exactly this shape:
{"suggestions":[{"key":"snake_case_id","element":"Component name e.g. Drip edge","title":"Short requirement title","cite":"Code section reference","body":"\\"Exact code language...\\" Why it matters on a storm claim."}]}`;

    try {
      const response = await geminiAi.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseMimeType: 'application/json', maxOutputTokens: 8192 },
      });
      const raw = (response.text ?? '').replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
      const parsedOut = JSON.parse(raw) as { suggestions?: unknown };
      const candidates = Array.isArray(parsedOut.suggestions) ? parsedOut.suggestions : [];
      const seen = new Set(existingKeys);
      const suggestions: Array<{ key: string; element: string; title: string; cite: string; body: string }> = [];
      for (const c of candidates) {
        if (typeof c !== 'object' || c === null) continue;
        const s = c as Record<string, unknown>;
        const key = String(s.key ?? '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
        const element = String(s.element ?? '').trim().slice(0, 60);
        const title = String(s.title ?? '').trim().slice(0, 200);
        const cite = String(s.cite ?? '').trim().slice(0, 200);
        const body = String(s.body ?? '').trim().slice(0, 2000);
        if (!key || !element || !title || !cite || !body || seen.has(key)) continue;
        seen.add(key);
        suggestions.push({ key, element, title, cite, body });
      }
      res.json(ResearchJurisdictionCodesResponse.parse({ suggestions }));
    } catch (err) {
      req.log.error({ err }, 'State code research failed');
      res.status(502).json({ error: 'Code research failed — please try again' });
      return;
    }
  },
);

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

    const html = buildSampleProofPackageHtml({
      theme: { ...stored, ...overrides },
      logoUrl: logoSignedUrl,
      companyName: company.name,
    });

    res.json({ html });
  },
);

export default router;
