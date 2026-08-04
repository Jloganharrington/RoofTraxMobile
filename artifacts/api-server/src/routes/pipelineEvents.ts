/**
 * POST /api/events/pipeline
 *
 * Receives a named pipeline event (e.g. 'contract_signed', 'deposit_received')
 * and auto-advances any pins whose current pipelineStage has that event as its
 * autoAdvance trigger and whose outcomeRules match the payload.
 */
import { Router, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, pinsTable, stageTransitionsTable } from '@workspace/db';
import {
  SERVER_STAGES_ARRAY,
  findServerStageByKey,
  STAGES_BY_PIPELINE,
  type PipelineId,
} from '../lib/pipelineStages';
import { isManagerOrAdmin } from '../lib/permissions';
import { getRole } from './pins';

const router = Router();

// ---------------------------------------------------------------------------
// Body schema
// ---------------------------------------------------------------------------

const PipelineEventBody = z.object({
  eventType: z.string().min(1),
  /** Restrict to a single lead — if omitted, advances all matching pins in company */
  leadId: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Shared helper — advance a pin's stage + write audit row
// (also exported for use by the advance-stage endpoint in inspections.ts)
// ---------------------------------------------------------------------------

export async function advancePinStage(opts: {
  pinId: string;
  fromStage: string | null;
  toStage: string;
  trigger: 'task' | 'auto_event' | 'manual_move';
  taskPayload?: Record<string, unknown> | null;
  lossReason?: string | null;
  loopNextActionAt?: Date | null;
  userId: string | null;
}): Promise<void> {
  const {
    pinId, fromStage, toStage, trigger,
    taskPayload, lossReason, loopNextActionAt, userId,
  } = opts;

  const now = new Date();
  const stageDef = findServerStageByKey(toStage);
  const isLoop = stageDef?.isLoopStage ?? false;

  // Compute loopNextActionAt: caller can supply an explicit date, otherwise
  // for loop stages we default to now (overdue immediately — badge shows).
  const nextActionAt = loopNextActionAt !== undefined
    ? loopNextActionAt
    : isLoop ? now : null;

  await db.transaction(async (tx) => {
    await tx.insert(stageTransitionsTable).values({
      leadId: pinId,
      fromStage: fromStage ?? null,
      toStage,
      trigger,
      taskPayload: taskPayload ?? null,
      userId: userId ?? null,
    });

    await tx
      .update(pinsTable)
      .set({
        pipelineStage:    toStage,
        stageEnteredAt:   now,
        loopNextActionAt: nextActionAt,
        ...(lossReason != null ? { lossReason } : {}),
      })
      .where(eq(pinsTable.id, pinId));
  });
}

// ---------------------------------------------------------------------------
// POST /api/events/pipeline
// ---------------------------------------------------------------------------

router.post('/events/pipeline', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: 'Unauthorized' });

  // Bulk auto-advance is restricted to manager/admin — plain reps cannot trigger
  // company-wide stage transitions.
  const callerRole = await getRole(req.user.id);
  if (!isManagerOrAdmin(callerRole)) {
    return void res.status(403).json({ error: 'Only managers and admins may trigger pipeline events' });
  }

  const parsed = PipelineEventBody.safeParse(req.body);
  if (!parsed.success) {
    return void res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
  }

  const { eventType, leadId, payload } = parsed.data;
  const payloadObj = payload ?? {};

  // Collect all stage keys whose autoAdvance eventType + outcomeRules match
  const matchingStageKeys = new Set<string>();
  for (const stageDef of SERVER_STAGES_ARRAY) {
    if (!stageDef.autoAdvance) continue;
    if (stageDef.autoAdvance.eventType !== eventType) continue;
    const rules = stageDef.autoAdvance.outcomeRules ?? {};
    const rulesMatch = Object.entries(rules).every(([k, v]) => payloadObj[k] === v);
    if (rulesMatch) matchingStageKeys.add(stageDef.key);
  }

  if (matchingStageKeys.size === 0) {
    return void res.json({
      advanced: false, toStage: null, results: [],
      reason: 'No stages match this event',
    });
  }

  // Fetch active pins in this company (stage filter applied in JS because
  // the matching set is small and avoids a dynamic SQL IN construction)
  const allActive = await db
    .select()
    .from(pinsTable)
    .where(and(eq(pinsTable.companyId, req.user.companyId), eq(pinsTable.status, 'active')));

  const pinsToAdvance = allActive.filter(
    (p) =>
      p.pipelineStage !== null &&
      matchingStageKeys.has(p.pipelineStage) &&
      (!leadId || p.id === leadId),
  );

  if (pinsToAdvance.length === 0) {
    return void res.json({
      advanced: false, toStage: null, results: [],
      reason: 'No pins are currently in matching stages',
    });
  }

  const results: Array<{ leadId: string; fromStage: string; toStage: string }> = [];

  for (const pin of pinsToAdvance) {
    const currentKey = pin.pipelineStage!;
    const currentDef = findServerStageByKey(currentKey);
    if (!currentDef) continue;

    // Resolve the target stage
    let toStage: string | null = null;

    if (currentDef.outcomes && currentDef.outcomes.length > 0) {
      // Find first outcome whose key appears in the eventType string, else first
      const match = currentDef.outcomes.find((o) => eventType.includes(o.key));
      toStage = match?.toStage ?? currentDef.outcomes[0].toStage;
    } else {
      // Sequential advance: next stage in pipeline order
      const pipelineList = STAGES_BY_PIPELINE[currentDef.pipeline as PipelineId] ?? [];
      const idx = pipelineList.findIndex((s) => s.key === currentKey);
      toStage = idx >= 0 && idx + 1 < pipelineList.length
        ? pipelineList[idx + 1].key
        : null;
    }

    if (!toStage) continue;

    await advancePinStage({
      pinId:       pin.id,
      fromStage:   currentKey,
      toStage,
      trigger:     'auto_event',
      taskPayload: { eventType, ...payloadObj },
      userId:      null, // system-driven
    });

    results.push({ leadId: pin.id, fromStage: currentKey, toStage });
  }

  return void res.json({
    advanced: results.length > 0,
    toStage:  results[0]?.toStage ?? null,
    results,
  });
});

export default router;
