import { GetDashboardManifestResponse, GetDashboardLayoutResponse, PatchDashboardLayoutBody } from '@workspace/api-zod';
import { db, userProfilesTable, pinsTable, inspectionsTable, usersTable, stageTransitionsTable, claimEventsTable } from '@workspace/db';
import type { Department, Role, WorkflowAssignment } from '@workspace/authz';
import { selectWidgetsFor, WIDGET_CATALOG, type Capability } from '@workspace/authz';
import { and, eq, gte, inArray, isNotNull, lt, notInArray, sql } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';
import { requireWidgetCapability } from '../lib/dashboardGuard';
import { SERVER_STAGES_ARRAY, findServerStageByKey, type PipelineId } from '../lib/pipelineStages';

const router: IRouter = Router();

// ── Shared helper ────────────────────────────────────────────────────────────

interface ProfileAndLayout {
  role: Role;
  department: Department;
  workflow: WorkflowAssignment;
  layout: { hidden: string[]; order: string[] } | null;
}

async function loadProfileAndLayout(userId: string): Promise<ProfileAndLayout> {
  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));

  return {
    role: (profile?.role ?? 'field_rep') as Role,
    department: (profile?.department ?? 'canvasser') as Department,
    workflow: (profile?.workflowAssignment ?? 'retail') as WorkflowAssignment,
    layout: profile?.dashboardLayout ?? null,
  };
}

// ── GET /dashboard/manifest ──────────────────────────────────────────────────
// Role/department/workflow are always loaded from the authenticated user's
// profile row — never from the request body, query string, or any other
// client-supplied field. Client values cannot escalate privilege.
router.get('/dashboard/manifest', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { role, department, workflow, layout } = await loadProfileAndLayout(req.user.id);

  // Resolve the full capability set — this is the security boundary.
  // The layout can only hide or reorder; it can never GRANT an uncapable widget.
  const resolved = selectWidgetsFor({ role, department, workflow });
  const resolvedKeys = new Set(resolved.map((w) => w.key));
  const resolvedMap = new Map(resolved.map((w) => [w.key, w]));

  let widgets: typeof resolved;

  if (!layout) {
    widgets = resolved;
  } else {
    const { hidden = [], order = [] } = layout;
    const hiddenSet = new Set(hidden);

    // Ordered widgets: keys that are granted + not hidden + in the stored order
    const orderedWidgets = order
      .filter((key) => resolvedKeys.has(key) && !hiddenSet.has(key))
      .map((key) => resolvedMap.get(key)!)
      .filter(Boolean);

    const orderedKeySet = new Set(order);

    // Append resolved widgets not mentioned in order[], excluding hidden ones
    const unorderedWidgets = WIDGET_CATALOG
      .filter((w) => resolvedKeys.has(w.key) && !orderedKeySet.has(w.key) && !hiddenSet.has(w.key))
      .map((w) => resolvedMap.get(w.key)!)
      .filter(Boolean);

    widgets = [...orderedWidgets, ...unorderedWidgets];
  }

  const body = GetDashboardManifestResponse.parse({
    widgets: widgets.map((w) => ({ key: w.key, title: w.title, size: w.size })),
  });
  res.json(body);
});

// ── GET /dashboard/layout ────────────────────────────────────────────────────
// Returns ALL capability-resolved widgets with their current hidden state,
// so settings UIs can toggle individual widgets back on without a full reset.
// Unlike /manifest, hidden widgets ARE included (with hidden: true).
router.get('/dashboard/layout', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { role, department, workflow, layout } = await loadProfileAndLayout(req.user.id);

  const resolved = selectWidgetsFor({ role, department, workflow });
  const resolvedKeys = new Set(resolved.map((w) => w.key));
  const resolvedMap = new Map(resolved.map((w) => [w.key, w]));

  const hiddenSet = new Set(layout?.hidden ?? []);
  const order = layout?.order ?? [];

  // Build display order: ordered visible first, then unordered (catalog order),
  // then hidden (catalog order). All are security-filtered to granted widgets.
  const orderedKeySet = new Set(order);

  const orderedVisible = order
    .filter((key) => resolvedKeys.has(key) && !hiddenSet.has(key))
    .map((key) => ({ ...resolvedMap.get(key)!, hidden: false }))
    .filter((w) => w.key !== undefined);

  const unorderedVisible = WIDGET_CATALOG
    .filter((w) => resolvedKeys.has(w.key) && !orderedKeySet.has(w.key) && !hiddenSet.has(w.key))
    .map((w) => ({ ...w, hidden: false as const }));

  const hiddenWidgets = WIDGET_CATALOG
    .filter((w) => resolvedKeys.has(w.key) && hiddenSet.has(w.key))
    .map((w) => ({ ...w, hidden: true as const }));

  const allWidgets = [...orderedVisible, ...unorderedVisible, ...hiddenWidgets];

  const body = GetDashboardLayoutResponse.parse({
    widgets: allWidgets.map((w) => ({
      key: w.key,
      title: w.title,
      size: w.size,
      hidden: w.hidden,
    })),
  });
  res.json(body);
});

// ── PATCH /dashboard/layout ──────────────────────────────────────────────────
// Persist the user's widget visibility and order preferences. Self-only.
// Security enforcement happens at manifest resolution time, not here.
router.patch('/dashboard/layout', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Strict parse: rejects extra fields beyond hidden + order.
  const parsed = PatchDashboardLayoutBody.strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
    return;
  }

  const { hidden, order } = parsed.data;

  await db
    .insert(userProfilesTable)
    .values({
      userId: req.user.id,
      dashboardLayout: { hidden, order },
    })
    .onConflictDoUpdate({
      target: userProfilesTable.userId,
      set: { dashboardLayout: { hidden, order } },
    });

  res.status(204).end();
});

// ── DELETE /dashboard/layout ─────────────────────────────────────────────────
// Restore defaults by nulling the layout column.
router.delete('/dashboard/layout', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  await db
    .update(userProfilesTable)
    .set({ dashboardLayout: null })
    .where(eq(userProfilesTable.userId, req.user.id));

  res.status(204).end();
});

// ── Widget data endpoints ────────────────────────────────────────────────────
// Every widget data route MUST use requireWidgetCapability(key) as its first
// middleware. Omission from the manifest is NOT access control — an attacker
// can call this URL directly. The guard re-checks the capability server-side
// on every request, independent of the manifest.

// ── Shared blocked-claims query ──────────────────────────────────────────────
// Used by BOTH the action_required widget (manager+, company-wide) and the
// claim_blockers widget (workflow-gated, optionally field-rep-scoped).
// Extracting into a single function prevents the two implementations from
// silently drifting apart (mirror problem).
//
// Three sub-cases:
//   1. Capturing + stalled: field work hasn't progressed in 7+ days.
//   2. Validating: claim review is open (human action required).
//   3. FIPSA unsigned: preliminary phase, past scheduled, no signed agreement.
// Raw SQL is required for the NOT EXISTS sub-select on signed_agreements.
//
// ⚠ stage_transitions has no companyId — this query scopes through pins.
//   claim_blockers' optional scopeToUserId adds a p.user_id filter for
//   field-rep views so a rep cannot see another rep's blocked inspections.
async function fetchBlockedClaims(
  companyId: string,
  options: { scopeToUserId?: string } = {},
): Promise<Array<Record<string, unknown>>> {
  const userScope = options.scopeToUserId
    ? sql`AND p.user_id = ${options.scopeToUserId}`
    : sql``;

  const result = await db.execute(sql`
    SELECT
      i.id              AS inspection_id,
      i.status          AS inspection_status,
      i.phase           AS inspection_phase,
      p.id              AS pin_id,
      p.user_id,
      p.pipeline_stage,
      p.stage_entered_at,
      p.customer_name,
      p.address,
      u.first_name,
      u.last_name
    FROM inspections i
    JOIN pins p ON i.pin_id = p.id
    LEFT JOIN users u ON p.user_id = u.id
    WHERE i.company_id = ${companyId}
      AND p.status = 'active'
      ${userScope}
      AND (
        (i.status = 'capturing' AND p.stage_entered_at < NOW() - INTERVAL '7 days')
        OR (i.status = 'validating')
        OR (
          i.phase = 'preliminary'
          AND i.status NOT IN ('scheduled')
          AND NOT EXISTS (
            SELECT 1 FROM signed_agreements sa
            WHERE sa.inspection_id = i.id AND sa.voided_at IS NULL
          )
        )
      )
  `);
  return result.rows as Array<Record<string, unknown>>;
}

// GET /dashboard/widgets/action_required
// Real ranked query across four data sources: overdue loop stages, stalled
// non-loop stages, blocked claims, and pins needing stage review.
// Company-scoped, capped at 25 items, sorted by rank descending.
router.get(
  '/dashboard/widgets/action_required',
  requireWidgetCapability('action_required'),
  async (req: Request, res: Response) => {
    // requireWidgetCapability already verified authentication; user is present.
    const companyId = req.user!.companyId;
    const now = Date.now();

    // Derive loop and terminal stage key sets from the server-side pipeline
    // vocabulary. Using a Set deduplicates keys shared across pipelines
    // (e.g. contract_pending appears in both retail and insurance).
    const loopStageKeys = [
      ...new Set(SERVER_STAGES_ARRAY.filter((s) => s.isLoopStage).map((s) => s.key)),
    ];
    const terminalStageKeys = [
      ...new Set(SERVER_STAGES_ARRAY.filter((s) => s.isTerminal).map((s) => s.key)),
    ];

    // Per-stage base weights for the ranking formula.
    // Higher weight = more urgency; log scale prevents age from drowning out priority.
    const highRevLoopStages = new Set(['contract_pending', 'supplement_dispute']);
    const insLoopStages = new Set([
      'adjuster_meeting',
      'adjuster_review',
      'appraisal',
      'public_adjuster',
      'contract_sent_ins',
    ]);

    function loopBaseWeight(stage: string): number {
      if (highRevLoopStages.has(stage)) return 12;
      if (insLoopStages.has(stage)) return 9;
      return 7; // follow_up, phase1_scheduled, phase2_scheduled, appt_scheduled, final_invoiced, etc.
    }

    function computeRank(baseWeight: number, ageMs: number): number {
      const ageInDays = ageMs / (1000 * 60 * 60 * 24);
      return baseWeight * Math.log2(1 + ageInDays);
    }

    function makeStuckForLabel(ageMs: number): string {
      const days = ageMs / (1000 * 60 * 60 * 24);
      if (days >= 2) return `${Math.floor(days)} days`;
      if (days >= 1) return '1 day';
      return '< 1 day';
    }

    function ownerDisplayName(firstName: string | null, lastName: string | null): string {
      const parts = [firstName, lastName].filter(Boolean);
      return parts.length > 0 ? parts.join(' ') : 'Unknown';
    }

    type ActionItem = {
      id: string;
      category: 'overdue_loop' | 'stalled_stage' | 'blocked_claim' | 'needs_review';
      label: string;
      ownerName: string;
      ownerId: string;
      stuckForLabel: string;
      rank: number;
      pinId: string;
      inspectionId: string | null;
      detail: string | null;
      pipelineStage: string | null;
    };

    const items: ActionItem[] = [];

    // ── a. Overdue loop stages ──────────────────────────────────────────────
    // Pins currently in a loop stage whose next-action date has passed.
    if (loopStageKeys.length > 0) {
      const overdueRows = await db
        .select({
          id: pinsTable.id,
          userId: pinsTable.userId,
          pipelineStage: pinsTable.pipelineStage,
          loopNextActionAt: pinsTable.loopNextActionAt,
          customerName: pinsTable.customerName,
          address: pinsTable.address,
          firstName: usersTable.firstName,
          lastName: usersTable.lastName,
        })
        .from(pinsTable)
        .leftJoin(usersTable, eq(pinsTable.userId, usersTable.id))
        .where(
          and(
            eq(pinsTable.companyId, companyId),
            eq(pinsTable.status, 'active'),
            inArray(pinsTable.pipelineStage, loopStageKeys),
            isNotNull(pinsTable.loopNextActionAt),
            lt(pinsTable.loopNextActionAt, sql`NOW()`),
          ),
        );

      for (const row of overdueRows) {
        const ageMs = row.loopNextActionAt ? now - row.loopNextActionAt.getTime() : 0;
        const stage = row.pipelineStage ?? '';
        const weight = loopBaseWeight(stage);
        const pinLabel = row.customerName ?? row.address ?? row.id;
        items.push({
          id: `overdue_loop:${row.id}`,
          category: 'overdue_loop',
          label: `${pinLabel} — loop overdue`,
          ownerName: ownerDisplayName(row.firstName, row.lastName),
          ownerId: row.userId,
          stuckForLabel: makeStuckForLabel(ageMs),
          rank: computeRank(weight, ageMs),
          pinId: row.id,
          inspectionId: null,
          detail: stage,
          pipelineStage: stage,
        });
      }
    }

    // ── b. Stalled non-loop stages ──────────────────────────────────────────
    // Pins in a non-loop, non-terminal stage that haven't moved in 14+ days.
    // 14-day threshold: one week is normal stage dwell; two weeks signals a
    // genuine block worth surfacing.
    {
      const allExcluded = [
        ...new Set([...loopStageKeys, ...terminalStageKeys]),
      ];
      const stalledRows = await db
        .select({
          id: pinsTable.id,
          userId: pinsTable.userId,
          pipelineStage: pinsTable.pipelineStage,
          stageEnteredAt: pinsTable.stageEnteredAt,
          customerName: pinsTable.customerName,
          address: pinsTable.address,
          firstName: usersTable.firstName,
          lastName: usersTable.lastName,
        })
        .from(pinsTable)
        .leftJoin(usersTable, eq(pinsTable.userId, usersTable.id))
        .where(
          and(
            eq(pinsTable.companyId, companyId),
            eq(pinsTable.status, 'active'),
            isNotNull(pinsTable.pipelineStage),
            isNotNull(pinsTable.stageEnteredAt),
            allExcluded.length > 0
              ? notInArray(pinsTable.pipelineStage, allExcluded)
              : undefined,
            lt(pinsTable.stageEnteredAt, sql`NOW() - INTERVAL '14 days'`),
          ),
        );

      for (const row of stalledRows) {
        const ageMs = row.stageEnteredAt ? now - row.stageEnteredAt.getTime() : 0;
        const pinLabel = row.customerName ?? row.address ?? row.id;
        items.push({
          id: `stalled_stage:${row.id}`,
          category: 'stalled_stage',
          label: `${pinLabel} — stage stalled`,
          ownerName: ownerDisplayName(row.firstName, row.lastName),
          ownerId: row.userId,
          stuckForLabel: makeStuckForLabel(ageMs),
          rank: computeRank(4, ageMs),
          pinId: row.id,
          inspectionId: null,
          detail: row.pipelineStage ?? null,
          pipelineStage: row.pipelineStage ?? null,
        });
      }
    }

    // ── c. Blocked claims ───────────────────────────────────────────────────
    // Delegated to fetchBlockedClaims() — see shared helper defined above this
    // route. action_required is manager+ so no user-scope filter is applied.
    {
      const blockedRows = await fetchBlockedClaims(companyId);
      for (const row of blockedRows) {
        const stageEnteredAt = row.stage_entered_at
          ? new Date(row.stage_entered_at as string)
          : null;
        const ageMs = stageEnteredAt ? now - stageEnteredAt.getTime() : 0;
        const pinLabel =
          (row.customer_name as string | null) ??
          (row.address as string | null) ??
          (row.pin_id as string);
        const status = row.inspection_status as string;
        const phase = row.inspection_phase as string;

        let baseWeight: number;
        let label: string;

        if (phase === 'preliminary' && status !== 'scheduled') {
          // Sunk forensic prep at risk — FIPSA unsigned is the hardest blocker.
          baseWeight = 18;
          label = `${pinLabel} — FIPSA unsigned`;
        } else if (status === 'validating') {
          // Work done; awaiting human resolution.
          baseWeight = 15;
          label = `${pinLabel} — claim validating`;
        } else {
          // Capturing stalled: field work hasn't moved.
          baseWeight = 8;
          label = `${pinLabel} — field work stalled`;
        }

        items.push({
          id: `blocked_claim:${row.inspection_id as string}`,
          category: 'blocked_claim',
          label,
          ownerName: ownerDisplayName(
            row.first_name as string | null,
            row.last_name as string | null,
          ),
          ownerId: row.user_id as string,
          stuckForLabel: makeStuckForLabel(ageMs),
          rank: computeRank(baseWeight, ageMs),
          pinId: row.pin_id as string,
          inspectionId: row.inspection_id as string,
          detail: status,
          pipelineStage: (row.pipeline_stage as string | null) ?? null,
        });
      }
    }

    // ── d. Needs stage review ───────────────────────────────────────────────
    // Pins where a null pipeline stage was auto-mapped during migration and
    // a manager needs to confirm the correct placement.
    {
      const reviewRows = await db
        .select({
          id: pinsTable.id,
          userId: pinsTable.userId,
          pipelineStage: pinsTable.pipelineStage,
          stageEnteredAt: pinsTable.stageEnteredAt,
          customerName: pinsTable.customerName,
          address: pinsTable.address,
          firstName: usersTable.firstName,
          lastName: usersTable.lastName,
        })
        .from(pinsTable)
        .leftJoin(usersTable, eq(pinsTable.userId, usersTable.id))
        .where(
          and(
            eq(pinsTable.companyId, companyId),
            eq(pinsTable.status, 'active'),
            eq(pinsTable.needsStageReview, true),
          ),
        );

      for (const row of reviewRows) {
        const ageMs = row.stageEnteredAt ? now - row.stageEnteredAt.getTime() : 0;
        const pinLabel = row.customerName ?? row.address ?? row.id;
        items.push({
          id: `needs_review:${row.id}`,
          category: 'needs_review',
          label: `${pinLabel} — stage needs review`,
          ownerName: ownerDisplayName(row.firstName, row.lastName),
          ownerId: row.userId,
          stuckForLabel: makeStuckForLabel(ageMs),
          rank: computeRank(2, ageMs),
          pinId: row.id,
          inspectionId: null,
          detail: row.pipelineStage ?? null,
          pipelineStage: row.pipelineStage ?? null,
        });
      }
    }

    // ── Sort, cap at 25, respond ────────────────────────────────────────────
    items.sort((a, b) => b.rank - a.rank);
    const total = items.length;
    const capped = total > 25;

    res.json({ items: items.slice(0, 25), total, capped });
  },
);

// ── GET /dashboard/widgets/knock_to_lead ─────────────────────────────────────
// Knock-to-lead conversion efficiency for the company, rolling 30-day window.
//
// Definition (stated explicitly per spec):
//   Knock = any pin where doorKnockResult IS NOT NULL.
//           This includes no_soliciting — the rep physically knocked and got
//           that outcome. It counts in the denominator.
//   Lead  = pin where doorKnockResult = 'appointment'.
//
// Stage list sourced from DOOR_KNOCK_RESULTS enum in the DB schema (not
// hardcoded) — if the enum changes the filter stays correct automatically.
router.get(
  '/dashboard/widgets/knock_to_lead',
  requireWidgetCapability('knock_to_lead'),
  async (req: Request, res: Response) => {
    const companyId = req.user!.companyId;
    const WINDOW_DAYS = 30;
    const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        userId: pinsTable.userId,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        knocks: sql<number>`cast(count(*) as int)`,
        leads: sql<number>`cast(count(*) filter (where ${pinsTable.doorKnockResult} = 'appointment') as int)`,
      })
      .from(pinsTable)
      .innerJoin(usersTable, eq(pinsTable.userId, usersTable.id))
      .where(
        and(
          eq(pinsTable.companyId, companyId),
          isNotNull(pinsTable.doorKnockResult),
          gte(pinsTable.createdAt, windowStart),
        )
      )
      .groupBy(pinsTable.userId, usersTable.firstName, usersTable.lastName)
      .orderBy(sql`count(*) desc`);

    const totalKnocks = rows.reduce((s, r) => s + Number(r.knocks), 0);
    const totalLeads  = rows.reduce((s, r) => s + Number(r.leads), 0);

    res.json({
      totalKnocks,
      totalLeads,
      conversionRate: totalKnocks > 0 ? totalLeads / totalKnocks : 0,
      windowDays: WINDOW_DAYS,
      repBreakdown: rows.map(r => {
        const knocks = Number(r.knocks);
        const leads  = Number(r.leads);
        return {
          userId: r.userId,
          name: [r.firstName, r.lastName].filter(Boolean).join(' '),
          knocks,
          leads,
          conversionRate: knocks > 0 ? leads / knocks : 0,
        };
      }),
    });
  },
);

// ── GET /dashboard/widgets/canvassing_heatmap ─────────────────────────────────
// PII-free coordinates + outcomes for the company, last 90 days, capped at
// 2 000 points (most-recent first). No names, addresses, or phone numbers.
// Window choice: 90 days is broad enough for geographic pattern recognition
// while staying recent enough for operational decisions.
router.get(
  '/dashboard/widgets/canvassing_heatmap',
  requireWidgetCapability('canvassing_heatmap'),
  async (req: Request, res: Response) => {
    const companyId = req.user!.companyId;
    const WINDOW_DAYS = 90;
    const CAP = 2_000;
    const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const all = await db
      .select({
        lat:             pinsTable.latitude,
        lng:             pinsTable.longitude,
        doorKnockResult: pinsTable.doorKnockResult,
        contactOutcome:  pinsTable.contactOutcome,
        createdAt:       pinsTable.createdAt,
      })
      .from(pinsTable)
      .where(
        and(
          eq(pinsTable.companyId, companyId),
          gte(pinsTable.createdAt, windowStart),
        )
      )
      .orderBy(sql`${pinsTable.createdAt} desc`);

    const total  = all.length;
    const capped = total > CAP;

    res.json({
      points: all.slice(0, CAP).map(p => ({
        lat:             p.lat,
        lng:             p.lng,
        doorKnockResult: p.doorKnockResult ?? null,
        contactOutcome:  p.contactOutcome  ?? null,
        createdAt:       p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
      })),
      total,
      capped,
      windowDays: WINDOW_DAYS,
    });
  },
);

// ── B1: Pipeline funnel ───────────────────────────────────────────────────────
// Single parameterised endpoint for sales_funnel (retail), insurance_claims
// (insurance), and production_pipeline (project). One DB query shape shared
// across all three; labels and ordering always read from SERVER_STAGES_ARRAY.
//
// PIPELINE_CAPABILITY_MAP maps the pipeline query param to the widget capability
// that gates it. requireWidgetCapability runs as the second middleware after the
// param validation guard, preserving "first middleware" enforcement intent.
const PIPELINE_CAPABILITY_MAP: Record<string, Capability> = {
  retail:    'sales_funnel',
  insurance: 'insurance_claims',
  project:   'production_pipeline',
};

router.get(
  '/dashboard/widgets/pipeline_funnel',
  // Step 1: validate pipeline param before invoking capability check
  (req: Request, res: Response, next) => {
    const { pipeline } = req.query;
    if (!pipeline || !PIPELINE_CAPABILITY_MAP[pipeline as string]) {
      res.status(400).json({ error: 'pipeline must be one of: retail, insurance, project' });
      return;
    }
    next();
  },
  // Step 2: capability check — maps pipeline → widget key
  (req: Request, res: Response, next) => {
    const key = PIPELINE_CAPABILITY_MAP[req.query.pipeline as string];
    return requireWidgetCapability(key)(req, res, next);
  },
  async (req: Request, res: Response) => {
    const pipeline   = req.query.pipeline as PipelineId;
    const companyId  = req.user!.companyId;

    // Stage definitions for this pipeline, sorted by `order`.
    // Labels come from SERVER_STAGES_ARRAY — never hardcoded.
    const pipelineStages = SERVER_STAGES_ARRAY
      .filter((s) => s.pipeline === pipeline)
      .sort((a, b) => a.order - b.order);

    // Count active pins per pipelineStage for this pipeline.
    const countRows = await db
      .select({
        stage: pinsTable.pipelineStage,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(pinsTable)
      .where(
        and(
          eq(pinsTable.companyId, companyId),
          eq(pinsTable.sourcePipeline, pipeline),
          eq(pinsTable.status, 'active'),
        )
      )
      .groupBy(pinsTable.pipelineStage);

    const countMap = new Map(countRows.map((r) => [r.stage ?? '__null__', Number(r.count)]));

    const stages = pipelineStages.map((s) => ({
      key:        s.key,
      label:      s.label,
      order:      s.order,
      count:      countMap.get(s.key) ?? 0,
      isTerminal: s.isTerminal,
    }));

    const activeTotal   = stages.filter((s) => !s.isTerminal).reduce((sum, s) => sum + s.count, 0);
    const terminalTotal = stages.filter((s) =>  s.isTerminal).reduce((sum, s) => sum + s.count, 0);

    res.json({ pipeline, stages, activeTotal, terminalTotal });
  },
);

// ── B2a: Pending inspections ──────────────────────────────────────────────────
// Inspections that need field action: status 'scheduled' (work hasn't started)
// or 'capturing' (work in progress but not submitted).
// 'validating' is excluded — the rep has submitted; awaiting office review is
// the claim_blockers widget's responsibility.
//
// SCOPE RULE (mirrors /activity-stats):
//   field_rep → own inspections only (inspectorUserId = actorId)
//   manager+  → company-wide
// Role is loaded from the DB profile row — never from the session token.
router.get(
  '/dashboard/widgets/pending_inspections',
  requireWidgetCapability('pending_inspections'),
  async (req: Request, res: Response) => {
    const companyId = req.user!.companyId;
    const actorId   = req.user!.id;
    const CAP = 25;

    const [profile] = await db
      .select({ role: userProfilesTable.role })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, actorId));

    const scopeToSelf = (profile?.role ?? 'field_rep') === 'field_rep';

    const rows = await db
      .select({
        inspectionId: inspectionsTable.id,
        pinId:        inspectionsTable.pinId,
        phase:        inspectionsTable.phase,
        status:       inspectionsTable.status,
        createdAt:    inspectionsTable.createdAt,
        customerName: pinsTable.customerName,
        address:      pinsTable.address,
        ownerFirst:   usersTable.firstName,
        ownerLast:    usersTable.lastName,
      })
      .from(inspectionsTable)
      .leftJoin(pinsTable, eq(inspectionsTable.pinId, pinsTable.id))
      .leftJoin(usersTable, eq(inspectionsTable.inspectorUserId, usersTable.id))
      .where(
        and(
          eq(inspectionsTable.companyId, companyId),
          inArray(inspectionsTable.status, ['scheduled', 'capturing']),
          scopeToSelf ? eq(inspectionsTable.inspectorUserId, actorId) : undefined,
        )
      )
      .orderBy(sql`${inspectionsTable.createdAt} asc`); // oldest first = most urgent

    const total  = rows.length;
    const capped = total > CAP;
    const now    = Date.now();

    res.json({
      items: rows.slice(0, CAP).map((r) => ({
        inspectionId:  r.inspectionId,
        pinId:         r.pinId ?? null,
        phase:         r.phase,
        status:        r.status,
        label:         r.customerName ?? r.address ?? r.inspectionId,
        ownerName:     r.ownerFirst || r.ownerLast
          ? [r.ownerFirst, r.ownerLast].filter(Boolean).join(' ')
          : null,
        outstandingMs: r.createdAt instanceof Date ? now - r.createdAt.getTime() : 0,
        createdAt:     r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
      })),
      total,
      capped,
      scopedToSelf: scopeToSelf,
    });
  },
);

// ── B2b: Claim blockers ───────────────────────────────────────────────────────
// Reuses fetchBlockedClaims() — no separate SQL copy. See shared helper above.
// Workflow-gated (insurance_retail) and field-rep-scoped when applicable.
router.get(
  '/dashboard/widgets/claim_blockers',
  requireWidgetCapability('claim_blockers'),
  async (req: Request, res: Response) => {
    const companyId = req.user!.companyId;
    const actorId   = req.user!.id;
    const CAP = 25;

    const [profile] = await db
      .select({ role: userProfilesTable.role })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, actorId));

    const scopeToSelf = (profile?.role ?? 'field_rep') === 'field_rep';

    const blockedRows = await fetchBlockedClaims(companyId, {
      scopeToUserId: scopeToSelf ? actorId : undefined,
    });

    const total  = blockedRows.length;
    const capped = total > CAP;

    res.json({
      items: blockedRows.slice(0, CAP).map((row) => {
        const status   = row.inspection_status as string;
        const phase    = row.inspection_phase  as string;
        const pinLabel =
          (row.customer_name as string | null) ??
          (row.address        as string | null) ??
          (row.pin_id         as string);
        const stageEnteredAt = row.stage_entered_at
          ? new Date(row.stage_entered_at as string)
          : null;
        const ageMs = stageEnteredAt ? Date.now() - stageEnteredAt.getTime() : 0;
        const days  = ageMs / (1000 * 60 * 60 * 24);
        const stuckForLabel =
          days >= 2 ? `${Math.floor(days)} days` : days >= 1 ? '1 day' : '< 1 day';

        let blockerKind: string;
        let label: string;
        if (phase === 'preliminary' && status !== 'scheduled') {
          blockerKind = 'fipsa_unsigned';
          label = `${pinLabel} — FIPSA unsigned`;
        } else if (status === 'validating') {
          blockerKind = 'validating';
          label = `${pinLabel} — claim validating`;
        } else {
          blockerKind = 'capturing_stalled';
          label = `${pinLabel} — field work stalled`;
        }

        return {
          inspectionId: row.inspection_id as string,
          pinId:        row.pin_id as string,
          blockerKind,
          label,
          ownerName: (row.first_name as string | null) || (row.last_name as string | null)
            ? [row.first_name, row.last_name].filter(Boolean).join(' ')
            : null,
          stuckForLabel,
        };
      }),
      total,
      capped,
      scopedToSelf: scopeToSelf,
    });
  },
);

// ── B3: Recent activity feed ──────────────────────────────────────────────────
// Merges claim_events + stage_transitions into one reverse-chronological feed.
//
// ⚠ TENANCY LANDMINE: stage_transitions has NO companyId column.
//   The query MUST join through pins and filter on pins.companyId.
//   claim_events has companyId and is scoped directly.
//
// NULL userId on stage_transitions indicates an auto_event trigger;
// such items are rendered as "System" — not "Unknown user".
// Payload contents are NEVER surfaced — only the event type label is shown.

const CLAIM_EVENT_LABELS: Readonly<Record<string, string>> = {
  inspection_synced:          'Inspection synced',
  attested:                   'Inspection attested',
  generation_started:         'AI generation started',
  section_generated:          'Section generated',
  section_approved:           'Section approved',
  section_locked:             'Section locked',
  compiled:                   'Report compiled',
  report_attested:            'Report attested',
  delivered:                  'Report delivered',
  supplemented:               'Supplement added',
  exhibit_selected:           'Exhibit selected',
  exhibit_deselected:         'Exhibit deselected',
  exhibit_class_set:          'Exhibit class updated',
  comparison_pair_confirmed:  'Comparison pair confirmed',
  comparison_pair_removed:    'Comparison pair removed',
  exhibit_badges_finalized:   'Exhibit badges finalized',
  captions_generated:         'Captions generated',
  field_record_reviewed:      'Field record reviewed',
  package_delivered:          'Package delivered',
  slot_confirmed:             'Photo slot confirmed',
  slot_swapped:               'Photo slot swapped',
  slot_skipped:               'Photo slot skipped',
  supplement_created:         'Supplement created',
  supplement_attested:        'Supplement attested',
  supplement_delivered:       'Supplement delivered',
};

// usersTable alias for stage transitions actor join (avoids Drizzle alias conflict)
const stActorUsers = usersTable;

router.get(
  '/dashboard/widgets/recent_activity',
  requireWidgetCapability('recent_activity'),
  async (req: Request, res: Response) => {
    const companyId   = req.user!.companyId;
    const CAP         = 30;
    const FETCH_LIMIT = 50; // over-fetch to have headroom after merge + sort

    // a. Claim events — scoped by companyId column directly.
    const claimEvents = await db
      .select({
        id:        claimEventsTable.id,
        eventType: claimEventsTable.eventType,
        actorId:   claimEventsTable.actorId,
        createdAt: claimEventsTable.createdAt,
        firstName: usersTable.firstName,
        lastName:  usersTable.lastName,
      })
      .from(claimEventsTable)
      .leftJoin(usersTable, eq(claimEventsTable.actorId, usersTable.id))
      .where(eq(claimEventsTable.companyId, companyId))
      .orderBy(sql`${claimEventsTable.createdAt} desc`)
      .limit(FETCH_LIMIT);

    // b. Stage transitions — scoped through pins.companyId (NO direct companyId).
    //    INNER JOIN pins ensures only transitions for real pins are returned.
    const stageTransitions = await db
      .select({
        id:        stageTransitionsTable.id,
        fromStage: stageTransitionsTable.fromStage,
        toStage:   stageTransitionsTable.toStage,
        userId:    stageTransitionsTable.userId,
        createdAt: stageTransitionsTable.createdAt,
        firstName: stActorUsers.firstName,
        lastName:  stActorUsers.lastName,
      })
      .from(stageTransitionsTable)
      .innerJoin(pinsTable, eq(stageTransitionsTable.leadId, pinsTable.id))
      .leftJoin(stActorUsers, eq(stageTransitionsTable.userId, stActorUsers.id))
      .where(eq(pinsTable.companyId, companyId))
      .orderBy(sql`${stageTransitionsTable.createdAt} desc`)
      .limit(FETCH_LIMIT);

    type FeedItem = {
      id: string;
      kind: 'claim_event' | 'stage_transition';
      text: string;
      actorName: string;
      createdAt: Date | null;
    };

    const claimItems: FeedItem[] = claimEvents.map((e) => ({
      id:        `ce:${e.id}`,
      kind:      'claim_event',
      text:      CLAIM_EVENT_LABELS[e.eventType] ?? e.eventType,
      actorName: e.firstName || e.lastName
        ? [e.firstName, e.lastName].filter(Boolean).join(' ')
        : 'Unknown',
      createdAt: e.createdAt,
    }));

    const transitionItems: FeedItem[] = stageTransitions.map((t) => {
      const toLabel   = findServerStageByKey(t.toStage)?.label   ?? t.toStage;
      const fromLabel = t.fromStage ? findServerStageByKey(t.fromStage)?.label ?? t.fromStage : null;
      const text = fromLabel
        ? `Stage: ${fromLabel} → ${toLabel}`
        : `Stage set: ${toLabel}`;
      return {
        id:        `st:${t.id}`,
        kind:      'stage_transition',
        text,
        // NULL userId = auto_event (system-triggered) — not "Unknown user"
        actorName: t.userId === null
          ? 'System'
          : t.firstName || t.lastName
            ? [t.firstName, t.lastName].filter(Boolean).join(' ')
            : 'Unknown',
        createdAt: t.createdAt,
      };
    });

    const all = [...claimItems, ...transitionItems].sort((a, b) => {
      if (!a.createdAt && !b.createdAt) return 0;
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    const total  = all.length;
    const capped = total > CAP;

    res.json({
      items: all.slice(0, CAP).map((item) => ({
        ...item,
        createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
      })),
      total,
      capped,
    });
  },
);

export default router;
