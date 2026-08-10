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
  SERVER_STAGES,
  SERVER_STAGES_ARRAY,
  findServerStageByKey,
  STAGES_BY_PIPELINE,
  type PipelineId,
} from '../lib/pipelineStages';
// Permission key: lead.advance_stage (ownerOrRole: manager — no resource ownerId at this
// collection endpoint ⟹ effectively manager+). Wired via requirePermission middleware.
import { requirePermission } from '../middlewares/requirePermission';
import { logger } from '../lib/logger';

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
// Core event processing — shared by the HTTP route (manager-gated) and the
// internal business-action emitters (system-driven, via emitPipelineEvent).
//
// IDEMPOTENCY GUARANTEE: a pin only advances when its *current* stage's
// autoAdvance.eventType matches the emitted event. Once a pin has moved past
// that stage, re-emitting the same event matches nothing — no backwards move,
// no duplicate stage_transitions row.
// ---------------------------------------------------------------------------

export interface PipelineEventResult {
  results: Array<{ leadId: string; fromStage: string; toStage: string }>;
  reason: string | null;
  /**
   * True when the eventType has no autoAdvance mapping in any pipeline stage.
   * Distinct from results.length === 0 (which can also mean "valid event but
   * no pins are currently in a matching stage"). The HTTP route returns 422
   * when this is true; internal emitters ignore it.
   */
  unknownEventType?: boolean;
}

export async function processPipelineEvent(opts: {
  companyId: string;
  eventType: string;
  /** Restrict to a single lead — if omitted, advances all matching pins in company */
  leadId?: string;
  payload?: Record<string, unknown>;
}): Promise<PipelineEventResult> {
  const { companyId, eventType, leadId } = opts;
  const payloadObj = opts.payload ?? {};

  // Collect matching pipeline:key pairs to avoid cross-pipeline key collision
  // (e.g. 'contract_signed' exists in both retail and insurance — tracking the
  // full `${pipeline}:${key}` string ensures retail events don't advance
  // insurance pins and vice-versa).
  const matchingPipelineStageKeys = new Set<string>();
  for (const stageDef of SERVER_STAGES_ARRAY) {
    if (!stageDef.autoAdvance) continue;
    if (stageDef.autoAdvance.eventType !== eventType) continue;
    const rules = stageDef.autoAdvance.outcomeRules ?? {};
    const rulesMatch = Object.entries(rules).every(([k, v]) => payloadObj[k] === v);
    if (rulesMatch) matchingPipelineStageKeys.add(`${stageDef.pipeline}:${stageDef.key}`);
  }

  if (matchingPipelineStageKeys.size === 0) {
    return {
      results: [],
      reason: `'${eventType}' is not an autoAdvance event type — it maps to an outcome-only stage or is unknown. Use PATCH /leads/:id/advance-stage for outcome-driven transitions.`,
      unknownEventType: true,
    };
  }

  // Fetch active pins in this company (stage filter applied in JS because
  // the matching set is small and avoids a dynamic SQL IN construction)
  const allActive = await db
    .select()
    .from(pinsTable)
    .where(and(eq(pinsTable.companyId, companyId), eq(pinsTable.status, 'active')));

  const pinsToAdvance = allActive.filter((p) => {
    if (!p.pipelineStage) return false;
    if (leadId && p.id !== leadId) return false;
    // Match on pipeline:key to prevent cross-pipeline advances.
    // Pins handed off to the project pipeline still carry their original
    // workflow ('retail'|'insurance'), so we also check 'project' prefix.
    return (
      matchingPipelineStageKeys.has(`${p.workflow}:${p.pipelineStage}`) ||
      matchingPipelineStageKeys.has(`project:${p.pipelineStage}`)
    );
  });

  if (pinsToAdvance.length === 0) {
    return { results: [], reason: 'No pins are currently in matching stages' };
  }

  const results: Array<{ leadId: string; fromStage: string; toStage: string }> = [];

  for (const pin of pinsToAdvance) {
    const currentKey = pin.pipelineStage!;
    // Scope stage definition lookup to the pin's workflow/pipeline to avoid
    // cross-pipeline ambiguity when the same key exists in multiple pipelines
    // (e.g. 'contract_signed' exists in both retail and insurance).
    const pinPipeline = (pin.workflow as PipelineId | undefined) ?? 'retail';
    // Prefer the pin's own workflow pipeline; fall back to project (for handed-off
    // pins whose workflow is still retail/insurance but stage is a project key),
    // then cross-pipeline key search as a last resort.
    const currentDef =
      SERVER_STAGES[`${pinPipeline}:${currentKey}`] ??
      SERVER_STAGES[`project:${currentKey}`] ??
      findServerStageByKey(currentKey);
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

  return { results, reason: null };
}

// ---------------------------------------------------------------------------
// Internal emitter — called by business-action routes AFTER their transaction
// commits (never inside it). Follows the notify() pattern: fire-and-forget,
// all errors swallowed and logged, never throws. A pipeline advance failing
// must never roll back or fail a signature, payment, or compile.
//
// Usage at call sites (after the business commit / res.json):
//   void emitPipelineEvent({ ... });
// ---------------------------------------------------------------------------

export async function emitPipelineEvent(opts: {
  companyId: string;
  eventType: string;
  leadId?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { results } = await processPipelineEvent(opts);
    if (results.length > 0) {
      logger.info({ eventType: opts.eventType, results }, 'pipeline auto-advance');
    }
  } catch (err) {
    logger.error({ err, opts }, 'emitPipelineEvent: auto-advance failed (business action unaffected)');
  }
}

// ---------------------------------------------------------------------------
// POST /api/events/pipeline
// ---------------------------------------------------------------------------

// lead.advance_stage — ownerOrRole: manager. No resource ownerId at this
// collection endpoint, so the check collapses to manager+. Verdict unchanged.
router.post('/events/pipeline', requirePermission('lead.advance_stage'), async (req: Request, res: Response) => {
  const parsed = PipelineEventBody.safeParse(req.body);
  if (!parsed.success) {
    return void res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
  }

  const { eventType, leadId, payload } = parsed.data;
  const { results, reason, unknownEventType } = await processPipelineEvent({
    companyId: req.actorCtx!.companyId,
    eventType,
    leadId,
    payload,
  });

  if (unknownEventType) {
    return void res.status(422).json({ error: reason });
  }

  return void res.json({
    advanced: results.length > 0,
    toStage:  results[0]?.toStage ?? null,
    results,
    ...(reason ? { reason } : {}),
  });
});

export default router;
