/**
 * AHJ Master Library — promote, list, adopt, and staleness routes.
 *
 * Contribution flow:  company ahj_packs  →  POST /ahj-master/packs  →  ahj_master_packs
 * Distribution flow:  ahj_master_packs   →  POST /ahj-master/adopt  →  company ahj_packs
 *
 * Permission model:
 *   - Promote (write to master library): catalog.ahj_wizard  (super_admin+)
 *   - List master packs:                 catalog.ahj_wizard  (super_admin+)
 *   - Adopt a master pack:               report.settings_edit (super_admin of any tenant)
 *   - List adoptions (with staleness):   report.settings_view
 */

import { requirePermission } from '../middlewares/requirePermission';
import { Router, type Request, type Response } from 'express';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  db,
  ahjPacksTable,
  ahjMasterPacksTable,
  ahjMasterAdoptionsTable,
  ahjCoverage,
} from '@workspace/db';

const router = Router();

// ---------------------------------------------------------------------------
// Step 3 — Promote endpoint
// POST /ahj-master/packs
// ---------------------------------------------------------------------------
//
// Accepts an existing ahj_packs row (from the caller's company), copies its
// items into ahj_master_packs, and manages the superseded_by_id version chain.
// After promoting, the matching ahj_coverage row's master_pack_id is updated.

const PromoteBody = z.object({
  /** ID of the source ahj_packs row to promote. Must belong to the caller's company. */
  sourcePackId: z.string().min(1),
  /** Two-letter uppercase state code, e.g. "VA". Required for master packs. */
  state: z.string().length(2),
  /** County name, e.g. "Fairfax County". Empty string for state-wide packs. */
  county: z.string().max(255),
  /** Optional IEBC / IRC code cycle label, e.g. "IRC 2021". */
  codeCycle: z.string().max(100).optional(),
});

router.post(
  '/ahj-master/packs',
  requirePermission('catalog.ahj_wizard'),
  async (req: Request, res: Response) => {
    const body = PromoteBody.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: body.error.message });

    const { sourcePackId, state, county, codeCycle } = body.data;
    const stateUpper = state.toUpperCase();

    // 1. Load the source pack — must belong to the actor's company.
    const [sourcePack] = await db
      .select()
      .from(ahjPacksTable)
      .where(
        and(
          eq(ahjPacksTable.id, sourcePackId),
          eq(ahjPacksTable.companyId, req.actorCtx!.companyId),
        ),
      )
      .limit(1);

    if (!sourcePack) {
      return void res.status(404).json({ error: 'Source pack not found' });
    }

    // 2. Find the current head of the master version chain for this jurisdiction.
    //    "Head" = the version that hasn't been superseded yet.
    const [priorHead] = await db
      .select()
      .from(ahjMasterPacksTable)
      .where(
        and(
          eq(ahjMasterPacksTable.state, stateUpper),
          sql`lower(${ahjMasterPacksTable.county}) = ${county.toLowerCase().trim()}`,
          eq(ahjMasterPacksTable.packType, sourcePack.packType),
          isNull(ahjMasterPacksTable.supersededById),
        ),
      )
      .orderBy(desc(ahjMasterPacksTable.version))
      .limit(1);

    const nextVersion = priorHead ? priorHead.version + 1 : 1;

    // 3. Insert the new master pack, then update the prior head to point to it.
    //    Done in a transaction so the version chain is never broken.
    const result = await db.transaction(async (tx) => {
      const [newMasterPack] = await tx
        .insert(ahjMasterPacksTable)
        .values({
          state: stateUpper,
          county: county.trim(),
          packType: sourcePack.packType,
          version: nextVersion,
          items: sourcePack.items,
          codeCycle: codeCycle ?? sourcePack.packType,
          createdBy: req.actorCtx!.actorId,
        })
        .returning();

      if (priorHead) {
        await tx
          .update(ahjMasterPacksTable)
          .set({ supersededById: newMasterPack.id })
          .where(eq(ahjMasterPacksTable.id, priorHead.id));
      }

      // 4. Upsert the ahj_coverage row to link master_pack_id.
      //    If a coverage row already exists for (state, county), update it.
      //    If not, create one with status 'covered'.
      const [existingCoverage] = await tx
        .select({ id: ahjCoverage.id })
        .from(ahjCoverage)
        .where(
          and(
            eq(ahjCoverage.state, stateUpper),
            sql`lower(${ahjCoverage.county}) = ${county.toLowerCase().trim()}`,
          ),
        )
        .limit(1);

      if (existingCoverage) {
        await tx
          .update(ahjCoverage)
          .set({
            masterPackId: newMasterPack.id,
            status: 'covered',
            ...(codeCycle ? { codeCycle } : {}),
            updatedAt: new Date(),
          })
          .where(eq(ahjCoverage.id, existingCoverage.id));
      } else {
        await tx.insert(ahjCoverage).values({
          state: stateUpper,
          county: county.trim(),
          status: 'covered',
          codeCycle: codeCycle ?? null,
          masterPackId: newMasterPack.id,
        });
      }

      return newMasterPack;
    });

    res.status(201).json({ masterPack: result, supersededId: priorHead?.id ?? null });
  },
);

// ---------------------------------------------------------------------------
// Step 7 — Admin verification: list master packs
// GET /ahj-master/packs
// ---------------------------------------------------------------------------
//
// Returns all master packs ordered by (state, county, pack_type, version desc).
// The superseded_by_id chain lets the caller identify which are the current head.

router.get(
  '/ahj-master/packs',
  requirePermission('catalog.ahj_wizard'),
  async (_req: Request, res: Response) => {
    const packs = await db
      .select()
      .from(ahjMasterPacksTable)
      .orderBy(
        ahjMasterPacksTable.state,
        ahjMasterPacksTable.county,
        ahjMasterPacksTable.packType,
        desc(ahjMasterPacksTable.version),
      );

    // Annotate each pack with whether it is the current head (not superseded).
    const annotated = packs.map((p) => ({
      ...p,
      isCurrent: p.supersededById === null,
    }));

    res.json({ masterPacks: annotated });
  },
);

// ---------------------------------------------------------------------------
// Step 5 — Adoption endpoint
// POST /ahj-master/adopt
// ---------------------------------------------------------------------------
//
// Creates a company-scoped ahj_packs row that is a copy of the master pack's
// items, then records the event in ahj_master_adoptions.
// Idempotent: re-adopting the same master pack returns the existing record.

const AdoptBody = z.object({
  /** ID of the ahj_master_packs row to adopt. */
  masterPackId: z.string().min(1),
});

router.post(
  '/ahj-master/adopt',
  requirePermission('report.settings_edit'),
  async (req: Request, res: Response) => {
    const body = AdoptBody.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: body.error.message });

    const { masterPackId } = body.data;
    const companyId = req.actorCtx!.companyId;

    // 1. Load the master pack.
    const [masterPack] = await db
      .select()
      .from(ahjMasterPacksTable)
      .where(eq(ahjMasterPacksTable.id, masterPackId))
      .limit(1);

    if (!masterPack) {
      return void res.status(404).json({ error: 'Master pack not found' });
    }

    // 2. Idempotency check — return the existing adoption if already adopted.
    const [existingAdoption] = await db
      .select()
      .from(ahjMasterAdoptionsTable)
      .where(
        and(
          eq(ahjMasterAdoptionsTable.companyId, companyId),
          eq(ahjMasterAdoptionsTable.masterPackId, masterPackId),
        ),
      )
      .limit(1);

    if (existingAdoption) {
      const [adoptedPack] = await db
        .select()
        .from(ahjPacksTable)
        .where(eq(ahjPacksTable.id, existingAdoption.adoptedPackId))
        .limit(1);

      return void res.json({
        adoption: existingAdoption,
        adoptedPack: adoptedPack ?? null,
        alreadyAdopted: true,
      });
    }

    // 3. Create the company-scoped pack copy and the adoption ledger row in a transaction.
    const result = await db.transaction(async (tx) => {
      // Build a jurisdiction string from state + county for the pack record.
      const jurisdiction = masterPack.county
        ? `${masterPack.county}, ${masterPack.state}`
        : masterPack.state;

      const [adoptedPack] = await tx
        .insert(ahjPacksTable)
        .values({
          companyId,
          packType: masterPack.packType as 'ahj_roof' | 'ahj_siding',
          jurisdiction,
          state: masterPack.state,
          county: masterPack.county,
          items: masterPack.items as object[],
          version: 1,
          createdBy: req.actorCtx!.actorId,
        })
        .returning();

      const [adoption] = await tx
        .insert(ahjMasterAdoptionsTable)
        .values({
          companyId,
          masterPackId,
          adoptedPackId: adoptedPack.id,
        })
        .returning();

      return { adoption, adoptedPack };
    });

    res.status(201).json({ ...result, alreadyAdopted: false });
  },
);

// ---------------------------------------------------------------------------
// Step 6 — Staleness flag: list adoptions with stale indicator
// GET /ahj-master/adoptions
// ---------------------------------------------------------------------------
//
// Returns all adoptions for the caller's company, each annotated with
// `isStale: true` when the adopted master pack has since been superseded
// (i.e. superseded_by_id IS NOT NULL on the master pack row).

router.get(
  '/ahj-master/adoptions',
  requirePermission('report.settings_view'),
  async (req: Request, res: Response) => {
    const companyId = req.actorCtx!.companyId;

    const rows = await db
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
      })
      .from(ahjMasterAdoptionsTable)
      .innerJoin(
        ahjMasterPacksTable,
        eq(ahjMasterAdoptionsTable.masterPackId, ahjMasterPacksTable.id),
      )
      .where(eq(ahjMasterAdoptionsTable.companyId, companyId))
      .orderBy(desc(ahjMasterAdoptionsTable.adoptedAt));

    const annotated = rows.map(({ adoption, masterPack }) => ({
      ...adoption,
      masterPack,
      /** true when the master pack version they adopted has been superseded by a newer one */
      isStale: masterPack.supersededById !== null,
    }));

    res.json({ adoptions: annotated });
  },
);

export default router;
