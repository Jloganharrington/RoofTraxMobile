/**
 * PP Admin — super-admin view of all PP subscriber tenants.
 *
 *   GET  /admin/pp-tenants                       — list all pp_only companies with readiness
 *   GET  /admin/pp-tenants/:companyId            — detail: settings, packs, founder, recent inspections
 *   POST /admin/pp-tenants/:companyId/re-adopt   — force fresh master pack adoption for the company
 *
 * All routes require team.view_stats (admin+).
 */

import { and, count, desc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import {
  ahjMasterAdoptionsTable,
  ahjMasterPacksTable,
  ahjPacksTable,
  companiesTable,
  companyJurisdictionPacksTable,
  db,
  inspectionsTable,
  usersTable,
} from '@workspace/db';
import { Router, type IRouter, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middlewares/requirePermission';

const router: IRouter = Router();
const requireAdmin = requirePermission('team.view_stats');

// ---------------------------------------------------------------------------
// GET /admin/pp-tenants
// Returns every pp_only company with aggregated readiness and count data.
// ---------------------------------------------------------------------------

router.get('/admin/pp-tenants', requireAdmin, async (req: Request, res: Response) => {
  // All PP-only companies, newest first.
  const tenants = await db
    .select({
      id: companiesTable.id,
      name: companiesTable.name,
      createdAt: companiesTable.createdAt,
      contractorLicenses: companiesTable.contractorLicenses,
      qualificationsText: companiesTable.qualificationsText,
      workType: companiesTable.workType,
      tradeTypes: companiesTable.tradeTypes,
      founderUserId: companiesTable.founderUserId,
    })
    .from(companiesTable)
    .where(eq(companiesTable.ppTier, 'pp_only'))
    .orderBy(desc(companiesTable.createdAt));

  // Aggregate counts with individual sub-queries (tenant count is small, N+1 is fine).
  const results = await Promise.all(
    tenants.map(async (company) => {
      const [[ahjRow], [jpRow], [inspRow], [compiledRow]] = await Promise.all([
        db
          .select({ n: count() })
          .from(ahjPacksTable)
          .where(eq(ahjPacksTable.companyId, company.id)),
        db
          .select({ n: count() })
          .from(companyJurisdictionPacksTable)
          .where(eq(companyJurisdictionPacksTable.companyId, company.id)),
        db
          .select({ n: count() })
          .from(inspectionsTable)
          .where(eq(inspectionsTable.companyId, company.id)),
        db
          .select({ n: count() })
          .from(inspectionsTable)
          .where(
            and(
              eq(inspectionsTable.companyId, company.id),
              sql`jsonb_array_length(${inspectionsTable.compiledReportVersions}) > 0`,
            ),
          ),
      ]);

      const ahjPackCount = Number(ahjRow.n);
      const jurisdictionPackCount = Number(jpRow.n);

      return {
        id: company.id,
        name: company.name,
        createdAt: company.createdAt,
        workType: company.workType,
        tradeTypes: company.tradeTypes,
        founderUserId: company.founderUserId,
        ahjPackCount,
        jurisdictionPackCount,
        inspectionCount: Number(inspRow.n),
        compiledPackageCount: Number(compiledRow.n),
        readiness: {
          hasLicenses:
            Array.isArray(company.contractorLicenses) && company.contractorLicenses.length > 0,
          hasQualifications: Boolean(company.qualificationsText),
          hasJurisdictionPack: jurisdictionPackCount > 0,
          hasAhjPack: ahjPackCount > 0,
        },
      };
    }),
  );

  res.json({ tenants: results });
});

// ---------------------------------------------------------------------------
// GET /admin/pp-tenants/:companyId
// Returns full settings, adopted packs (with staleness), founder, recent inspections.
// ---------------------------------------------------------------------------

router.get(
  '/admin/pp-tenants/:companyId',
  requireAdmin,
  async (req: Request, res: Response) => {
    const companyId = req.params.companyId as string;

    // Load company (pp_only guard).
    const [company] = await db
      .select()
      .from(companiesTable)
      .where(and(eq(companiesTable.id, companyId), eq(companiesTable.ppTier, 'pp_only')))
      .limit(1);

    if (!company) {
      res.status(404).json({ error: 'PP tenant not found' });
      return;
    }

    // Founder user.
    const founder = company.founderUserId
      ? await db
          .select({
            id: usersTable.id,
            email: usersTable.email,
            firstName: usersTable.firstName,
            lastName: usersTable.lastName,
            emailVerifiedAt: usersTable.emailVerifiedAt,
            createdAt: usersTable.createdAt,
          })
          .from(usersTable)
          .where(eq(usersTable.id, company.founderUserId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null;

    // Jurisdiction packs.
    const jurisdictionPacks = await db
      .select()
      .from(companyJurisdictionPacksTable)
      .where(eq(companyJurisdictionPacksTable.companyId, companyId));

    // Adopted master packs + staleness.
    // A pack is stale when the master pack it came from has been superseded
    // (i.e. ahj_master_packs.superseded_by_id is non-null).
    const adoptions = await db
      .select({
        adoption: ahjMasterAdoptionsTable,
        masterPack: {
          id: ahjMasterPacksTable.id,
          state: ahjMasterPacksTable.state,
          county: ahjMasterPacksTable.county,
          packType: ahjMasterPacksTable.packType,
          version: ahjMasterPacksTable.version,
          codeCycle: ahjMasterPacksTable.codeCycle,
          supersededById: ahjMasterPacksTable.supersededById,
        },
        adoptedPack: {
          id: ahjPacksTable.id,
          jurisdiction: ahjPacksTable.jurisdiction,
          packType: ahjPacksTable.packType,
          version: ahjPacksTable.version,
        },
      })
      .from(ahjMasterAdoptionsTable)
      .leftJoin(
        ahjMasterPacksTable,
        eq(ahjMasterAdoptionsTable.masterPackId, ahjMasterPacksTable.id),
      )
      .leftJoin(ahjPacksTable, eq(ahjMasterAdoptionsTable.adoptedPackId, ahjPacksTable.id))
      .where(eq(ahjMasterAdoptionsTable.companyId, companyId));

    // AHJ packs not from master adoption (manually created).
    const allAhjPacks = await db
      .select()
      .from(ahjPacksTable)
      .where(eq(ahjPacksTable.companyId, companyId));

    // Recent inspections (last 10).
    const recentInspections = await db
      .select({
        id: inspectionsTable.id,
        address: inspectionsTable.address,
        insuredName: inspectionsTable.insuredName,
        status: inspectionsTable.status,
        phase: inspectionsTable.phase,
        createdAt: inspectionsTable.createdAt,
        compiledReportVersions: inspectionsTable.compiledReportVersions,
      })
      .from(inspectionsTable)
      .where(eq(inspectionsTable.companyId, companyId))
      .orderBy(desc(inspectionsTable.createdAt))
      .limit(10);

    res.json({
      company: {
        id: company.id,
        name: company.name,
        createdAt: company.createdAt,
        workType: company.workType,
        tradeTypes: company.tradeTypes,
        contractorLicenses: company.contractorLicenses,
        qualificationsText: company.qualificationsText,
        pricingBasisStatement: company.pricingBasisStatement,
        reportBranding: company.reportBranding,
        logoUrl: company.logoUrl,
        ahjCoverageId: company.ahjCoverageId,
      },
      founder,
      jurisdictionPacks,
      adoptions: adoptions.map((row) => ({
        ...row.adoption,
        masterPack: row.masterPack ?? null,
        adoptedPack: row.adoptedPack ?? null,
        isStale: Boolean(row.masterPack?.supersededById),
      })),
      allAhjPacks,
      recentInspections: recentInspections.map((i) => ({
        ...i,
        hasCompiledReport: Array.isArray(i.compiledReportVersions)
          ? i.compiledReportVersions.length > 0
          : false,
      })),
    });
  },
);

// ---------------------------------------------------------------------------
// POST /admin/pp-tenants/:companyId/re-adopt
// Force fresh master-pack adoption for the target company, always upgrading
// to the latest non-superseded version in the same version chain.
// Body: { masterPackId } — the current (possibly stale) master pack ID.
// ---------------------------------------------------------------------------

const ReAdoptBody = z.object({
  masterPackId: z.string().min(1),
});

/**
 * Follow the supersededById chain from a starting master pack until we reach
 * the version that has not yet been superseded (supersededById IS NULL).
 * That is the current authoritative version.
 *
 * Returns the latest pack, or null if the chain is broken or cyclic.
 */
async function resolveLatestMasterPack(startPackId: string) {
  let currentId = startPackId;
  const seen = new Set<string>();

  for (let hop = 0; hop < 50; hop++) {
    if (seen.has(currentId)) return null; // cycle guard
    seen.add(currentId);

    const [pack] = await db
      .select()
      .from(ahjMasterPacksTable)
      .where(eq(ahjMasterPacksTable.id, currentId))
      .limit(1);

    if (!pack) return null; // broken chain
    if (!pack.supersededById) return pack; // this is the latest
    currentId = pack.supersededById;
  }

  return null; // chain too long
}

router.post(
  '/admin/pp-tenants/:companyId/re-adopt',
  requireAdmin,
  async (req: Request, res: Response) => {
    const companyId = req.params.companyId as string;
    const body = ReAdoptBody.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: body.error.message });

    const { masterPackId } = body.data;

    // Guard: company must be a pp_only tenant.
    const [company] = await db
      .select({ id: companiesTable.id })
      .from(companiesTable)
      .where(and(eq(companiesTable.id, companyId), eq(companiesTable.ppTier, 'pp_only')))
      .limit(1);

    if (!company) {
      return void res.status(404).json({ error: 'PP tenant not found' });
    }

    // Verify the submitted master pack exists.
    const [startPack] = await db
      .select({ id: ahjMasterPacksTable.id, supersededById: ahjMasterPacksTable.supersededById })
      .from(ahjMasterPacksTable)
      .where(eq(ahjMasterPacksTable.id, masterPackId))
      .limit(1);

    if (!startPack) {
      return void res.status(404).json({ error: 'Master pack not found' });
    }

    // Follow supersededById → supersededById until we reach the current head
    // (the pack that has never been superseded). This ensures re-adoption always
    // materialises the latest content, even when the caller passes an old pack ID.
    const latestPack = await resolveLatestMasterPack(masterPackId);
    if (!latestPack) {
      return void res.status(422).json({
        error: 'Could not resolve the latest master pack version. The version chain may be broken.',
      });
    }

    const latestPackId = latestPack.id;
    const wasStale = latestPackId !== masterPackId;

    const result = await db.transaction(async (tx) => {
      // Remove the existing adoption for the submitted (possibly stale) pack.
      await tx
        .delete(ahjMasterAdoptionsTable)
        .where(
          and(
            eq(ahjMasterAdoptionsTable.companyId, companyId),
            eq(ahjMasterAdoptionsTable.masterPackId, masterPackId),
          ),
        );

      // If the latest pack ID differs (chain was advanced), also clear any
      // prior adoption for the latest pack so the UNIQUE constraint won't
      // conflict when we insert.
      if (wasStale) {
        await tx
          .delete(ahjMasterAdoptionsTable)
          .where(
            and(
              eq(ahjMasterAdoptionsTable.companyId, companyId),
              eq(ahjMasterAdoptionsTable.masterPackId, latestPackId),
            ),
          );
      }

      // Create a fresh company-scoped pack copy from the latest master content.
      const jurisdiction = latestPack.county
        ? `${latestPack.county}, ${latestPack.state}`
        : latestPack.state;

      const [adoptedPack] = await tx
        .insert(ahjPacksTable)
        .values({
          companyId,
          packType: latestPack.packType as 'ahj_roof' | 'ahj_siding',
          jurisdiction,
          state: latestPack.state,
          county: latestPack.county,
          items: latestPack.items as object[],
          version: 1,
          createdBy: req.actorCtx!.actorId,
        })
        .returning();

      const [adoption] = await tx
        .insert(ahjMasterAdoptionsTable)
        .values({
          companyId,
          masterPackId: latestPackId,
          adoptedPackId: adoptedPack.id,
        })
        .returning();

      return { adoption, adoptedPack, latestMasterPack: latestPack };
    });

    res.status(201).json({ ...result, reAdopted: true, wasStale });
  },
);

export default router;
