---
name: Pipeline stage vocabulary
description: 30-stage pipeline map structure and dual-file sync requirement
---

## Rule
Two copies of the stage vocabulary exist — keep them in sync when adding stages:
- **UI (React)**: `artifacts/rooftrax-web/src/lib/pipelineStages.ts` — full metadata including ExitTask config
- **Server**: `artifacts/api-server/src/lib/pipelineStages.ts` — autoAdvance, isTerminal, isLoopStage, outcomes; no React/UI data

## Why
The API server can't import from rooftrax-web (wrong dependency direction). The server-side copy (`SERVER_STAGES`, `SERVER_STAGES_ARRAY`) is used by `pipelineEvents.ts` and the advance-stage endpoint.

## Stage key renames (old → new)
Old insurance stage keys were renamed; the SQL migration in `lib/db/data-migrations/pipeline-stage-remap.sql` handles the data backfill:
- `inspection_scheduled` → `phase1_scheduled`
- `damage_documented` → `phase1_complete`
- `create_claim_proof_package` → `proof_package`
- `generate_contract` → `contract_generated`
- `contract_signed` (insurance) → `ins_contract_signed`
- `deposit_received` (insurance) → `ins_deposit_received`

## How to apply
When adding a new stage: add to both files, update the SQL migration file, and update `ALL_STAGE_KEYS` in the server lib. The DB `pipeline_stage` column stores the raw stage key string.
