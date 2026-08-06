import { GetDashboardManifestResponse, GetDashboardLayoutResponse, PatchDashboardLayoutBody } from '@workspace/api-zod';
import { db, userProfilesTable, pinsTable, inspectionsTable, usersTable } from '@workspace/db';
import type { Department, Role, WorkflowAssignment } from '@workspace/authz';
import { selectWidgetsFor, WIDGET_CATALOG } from '@workspace/authz';
import { and, eq, gte, inArray, isNotNull, lt, notInArray, sql } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';
import { requireWidgetCapability } from '../lib/dashboardGuard';
import { SERVER_STAGES_ARRAY } from '../lib/pipelineStages';

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
    // Three sub-cases:
    //   1. Capturing + stalled: field work hasn't progressed in 7+ days.
    //   2. Validating: claim review is open (human action required).
    //   3. FIPSA unsigned: preliminary phase, past scheduled, no signed agreement.
    // Raw SQL needed for the NOT EXISTS correlated sub-select on signed_agreements.
    {
      const blockedResult = await db.execute(sql`
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

      for (const row of blockedResult.rows as Array<Record<string, unknown>>) {
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

export default router;
