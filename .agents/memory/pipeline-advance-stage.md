---
name: Pipeline advance-stage endpoint
description: How the stage-advance logic is structured and shared across endpoints
---

## Rule
`advancePinStage()` is the single shared helper that writes both the `stage_transitions` audit row and updates `pins.pipeline_stage` / `stageEnteredAt` / `loopNextActionAt` / `lossReason` — always inside a transaction. It lives in `artifacts/api-server/src/routes/pipelineEvents.ts` and is imported by `inspections.ts`.

## Endpoints
- `PATCH /api/leads/:leadId/advance-stage` — in `inspections.ts` (line ~8515). Validates auth, company scope, stage key existence, lossReason requirement for archived_lost.
- `POST /api/events/pipeline` — in `pipelineEvents.ts`. Looks up pins whose current stage has a matching autoAdvance trigger, advances them all, returns `{ advanced, toStage, results[] }`.

## Why
Both endpoints share the same DB write logic to keep the audit trail consistent. Only pin leads (not `ins-` inspection leads) support advance-stage.

## Frontend
- `widgets/shared.ts` — `useAdvanceStage(leadId)` mutation used by all 9 ExitTaskWidgets
- `claimHubApi.ts` — `useAdvanceLeadStage(leadId)` export for kanban UI pages
- Widget components: `src/components/pipeline/widgets/` (9 files + index.ts + shared.ts)
- `StageCard.tsx` — amber border when `loopNextActionAt` past, red age badge >14 days

## DB columns added to pins
`stage_entered_at`, `loop_next_action_at`, `loss_reason`, `source_pipeline` (all nullable).
`stage_transitions` table created with: id, lead_id, from_stage, to_stage, trigger, task_payload, user_id, created_at.
