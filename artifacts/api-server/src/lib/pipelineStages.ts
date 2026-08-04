/**
 * Server-side pipeline stage vocabulary.
 * Mirrors the autoAdvance/isTerminal/isLoopStage data from rooftrax-web's
 * pipelineStages.ts but without any React/UI metadata.
 *
 * Keep stage keys in sync with the full definition in
 * artifacts/rooftrax-web/src/lib/pipelineStages.ts.
 */

export type PipelineId = 'retail' | 'insurance' | 'project';

export interface ServerStageDef {
  pipeline: PipelineId;
  key: string;
  label: string;
  isLoopStage: boolean;
  isTerminal: boolean;
  /** Which pipeline event automatically advances this stage */
  autoAdvance?: {
    eventType: string;
    outcomeRules?: Record<string, unknown>;
  };
  /** For OutcomeButtons stages: the stage each outcome routes to */
  outcomes?: Array<{ key: string; toStage: string }>;
  /** Ordered index within the pipeline (for sequential auto-advance) */
  order: number;
}

const retail: ServerStageDef[] = [
  { pipeline: 'retail', key: 'pin_dropped',       label: 'Pin Dropped',         isLoopStage: false, isTerminal: false, order: 0 },
  { pipeline: 'retail', key: 'contact_made',       label: 'Contact Made',        isLoopStage: false, isTerminal: false, order: 1 },
  { pipeline: 'retail', key: 'appt_scheduled',     label: 'Appt. Scheduled',     isLoopStage: true,  isTerminal: false, order: 2, autoAdvance: { eventType: 'appointment_confirmed' } },
  { pipeline: 'retail', key: 'appt_confirmed',     label: 'Appt. Confirmed',     isLoopStage: true,  isTerminal: false, order: 3 },
  { pipeline: 'retail', key: 'estimate_provided',  label: 'Estimate Provided',   isLoopStage: false, isTerminal: false, order: 4, outcomes: [{ key: 'followup', toStage: 'followup_required' }, { key: 'contract_sent', toStage: 'contract_sent' }] },
  { pipeline: 'retail', key: 'followup_required',  label: 'Follow-Up Required',  isLoopStage: true,  isTerminal: false, order: 5, outcomes: [{ key: 'send_contract', toStage: 'contract_sent' }, { key: 'lost', toStage: 'archived_lost' }] },
  { pipeline: 'retail', key: 'contract_sent',      label: 'Contract Sent',       isLoopStage: true,  isTerminal: false, order: 6, autoAdvance: { eventType: 'contract_signed', outcomeRules: { pipeline: 'retail' } } },
  { pipeline: 'retail', key: 'contract_signed',    label: 'Contract Signed',     isLoopStage: false, isTerminal: false, order: 7, autoAdvance: { eventType: 'deposit_received', outcomeRules: { pipeline: 'retail' } } },
  { pipeline: 'retail', key: 'deposit_received',   label: 'Deposit Received',    isLoopStage: false, isTerminal: false, order: 8 },
  { pipeline: 'retail', key: 'archived_lost',      label: 'Archived – Lost',     isLoopStage: false, isTerminal: true,  order: 9 },
];

const insurance: ServerStageDef[] = [
  // ── New 15-stage spec (inline exit-task kanban) ─────────────────────────
  { pipeline: 'insurance', key: 'pin_dropped',        label: 'Pin Dropped',                    isLoopStage: false, isTerminal: false, order: 0 },
  { pipeline: 'insurance', key: 'phase1_scheduled',   label: 'Phase 1 Inspection Scheduled',   isLoopStage: true,  isTerminal: false, order: 1,  autoAdvance: { eventType: 'preliminary_record_synced' } },
  { pipeline: 'insurance', key: 'phase1_complete',    label: 'Phase 1 Complete',               isLoopStage: false, isTerminal: false, order: 2,  autoAdvance: { eventType: 'fipsa_signed' } },
  { pipeline: 'insurance', key: 'fipsa_signed',       label: 'FIPSA Signed',                   isLoopStage: false, isTerminal: false, order: 3 },
  { pipeline: 'insurance', key: 'phase2_scheduled',   label: 'Phase 2 Inspection Scheduled',   isLoopStage: true,  isTerminal: false, order: 4,  autoAdvance: { eventType: 'forensic_record_attested' } },
  { pipeline: 'insurance', key: 'phase2_complete',    label: 'Phase 2 Complete',               isLoopStage: false, isTerminal: false, order: 5,  autoAdvance: { eventType: 'report_attested' } },
  { pipeline: 'insurance', key: 'package_ready',      label: 'Proof Package Ready',            isLoopStage: false, isTerminal: false, order: 6,  autoAdvance: { eventType: 'package_delivered' } },
  { pipeline: 'insurance', key: 'claim_filed',        label: 'Claim Filed',                    isLoopStage: false, isTerminal: false, order: 7 },
  { pipeline: 'insurance', key: 'claim_review',       label: 'Claim Under Review',             isLoopStage: false, isTerminal: false, order: 8,  outcomes: [{ key: 'approved', toStage: 'claim_approved' }, { key: 'partial', toStage: 'supplement_dispute' }, { key: 'denied', toStage: 'supplement_dispute' }] },
  { pipeline: 'insurance', key: 'supplement_dispute', label: 'Supplement / Dispute',           isLoopStage: true,  isTerminal: false, order: 9,  outcomes: [{ key: 'resolved_approved', toStage: 'claim_approved' }, { key: 'still_in_review', toStage: 'claim_review' }, { key: 'withdrawn', toStage: 'archived_no_damage' }] },
  { pipeline: 'insurance', key: 'claim_approved',     label: 'Claim Approved',                 isLoopStage: false, isTerminal: false, order: 10 },
  { pipeline: 'insurance', key: 'contract_pending',   label: 'Contract Pending',               isLoopStage: false, isTerminal: false, order: 11, autoAdvance: { eventType: 'contract_signed', outcomeRules: { pipeline: 'insurance' } } },
  { pipeline: 'insurance', key: 'contract_signed',    label: 'Contract Signed',                isLoopStage: false, isTerminal: false, order: 12 },
  { pipeline: 'insurance', key: 'deposit_received',   label: 'Deposit Received',               isLoopStage: false, isTerminal: false, order: 13 },
  { pipeline: 'insurance', key: 'archived_no_damage', label: 'Archived — No Damage',           isLoopStage: false, isTerminal: true,  order: 14 },
  // Convergence target — receives the lead into the project pipeline
  { pipeline: 'insurance', key: 'pm_handoff',         label: 'PM Handoff (Project Pipeline)',  isLoopStage: false, isTerminal: true,  order: 15 },

  // ── Legacy stage keys — kept for backward compatibility with existing pins ─
  { pipeline: 'insurance', key: 'proof_package',       label: 'Generate Claim Proof Package', isLoopStage: false, isTerminal: false, order: 100, autoAdvance: { eventType: 'proof_package_compiled' } },
  { pipeline: 'insurance', key: 'contract_generated',  label: 'Generate Contract',            isLoopStage: false, isTerminal: false, order: 101 },
  { pipeline: 'insurance', key: 'contract_sent_ins',   label: 'Contract Sent',                isLoopStage: true,  isTerminal: false, order: 102, autoAdvance: { eventType: 'contract_signed', outcomeRules: { pipeline: 'insurance' } } },
  { pipeline: 'insurance', key: 'ins_contract_signed', label: 'Contract Signed',              isLoopStage: false, isTerminal: false, order: 103, autoAdvance: { eventType: 'deposit_received', outcomeRules: { pipeline: 'insurance' } } },
  { pipeline: 'insurance', key: 'ins_deposit_received',label: 'Deposit Received',             isLoopStage: false, isTerminal: false, order: 104 },
  { pipeline: 'insurance', key: 'adjuster_meeting',    label: 'Adjuster Meeting Scheduled',   isLoopStage: true,  isTerminal: false, order: 105 },
  { pipeline: 'insurance', key: 'adjuster_review',     label: 'Adjuster Review',              isLoopStage: true,  isTerminal: false, order: 106, outcomes: [{ key: 'approved', toStage: 'claim_approved' }, { key: 'denied', toStage: 'claim_denied' }, { key: 'pa', toStage: 'public_adjuster' }, { key: 'appraise', toStage: 'appraisal' }] },
  { pipeline: 'insurance', key: 'selections',          label: 'Selections',                   isLoopStage: false, isTerminal: false, order: 107 },
  { pipeline: 'insurance', key: 'claim_denied',        label: 'Claim Denied',                 isLoopStage: false, isTerminal: false, order: 108, outcomes: [{ key: 'pa', toStage: 'public_adjuster' }, { key: 'appraise', toStage: 'appraisal' }, { key: 'lost', toStage: 'archived_lost' }] },
  { pipeline: 'insurance', key: 'public_adjuster',     label: 'Public Adjuster',              isLoopStage: true,  isTerminal: false, order: 109, outcomes: [{ key: 'approved', toStage: 'claim_approved' }, { key: 'denied', toStage: 'claim_denied' }] },
  { pipeline: 'insurance', key: 'appraisal',           label: 'Appraisal',                    isLoopStage: true,  isTerminal: false, order: 110, outcomes: [{ key: 'approved', toStage: 'claim_approved' }, { key: 'denied', toStage: 'claim_denied' }] },
  { pipeline: 'insurance', key: 'archived_lost',       label: 'Archived – Lost',              isLoopStage: false, isTerminal: true,  order: 111 },
];

const project: ServerStageDef[] = [
  { pipeline: 'project', key: 'pm_handoff',       label: 'PM Handoff',        isLoopStage: false, isTerminal: false, order: 0 },
  { pipeline: 'project', key: 'pre_production',   label: 'Pre-Production',    isLoopStage: false, isTerminal: false, order: 1 },
  { pipeline: 'project', key: 'materials_ordered',label: 'Materials Ordered', isLoopStage: false, isTerminal: false, order: 2 },
  { pipeline: 'project', key: 'scheduled',        label: 'Scheduled',         isLoopStage: false, isTerminal: false, order: 3 },
  { pipeline: 'project', key: 'in_production',    label: 'In Production',     isLoopStage: false, isTerminal: false, order: 4 },
  { pipeline: 'project', key: 'complete',         label: 'Complete',          isLoopStage: false, isTerminal: false, order: 5, autoAdvance: { eventType: 'completion_package_generated' } },
  { pipeline: 'project', key: 'final_invoiced',   label: 'Final Invoiced',    isLoopStage: true,  isTerminal: false, order: 6 },
  { pipeline: 'project', key: 'closed_warranty',  label: 'Closed (Warranty)', isLoopStage: false, isTerminal: true,  order: 7 },
];

/** All stage definitions, keyed by `${pipeline}:${key}` */
export const SERVER_STAGES: Record<string, ServerStageDef> = {};
for (const s of [...retail, ...insurance, ...project]) {
  SERVER_STAGES[`${s.pipeline}:${s.key}`] = s;
}

/** All stage definitions as a flat array */
export const SERVER_STAGES_ARRAY: ServerStageDef[] = Object.values(SERVER_STAGES);

/** Look up a stage definition by key alone (returns first match across pipelines) */
export function findServerStageByKey(key: string): ServerStageDef | undefined {
  return SERVER_STAGES_ARRAY.find((s) => s.key === key);
}

/** All valid stage keys */
export const ALL_STAGE_KEYS = new Set(SERVER_STAGES_ARRAY.map((s) => s.key));

/** Stages indexed by pipeline for ordered iteration */
export const STAGES_BY_PIPELINE: Record<PipelineId, ServerStageDef[]> = {
  retail: retail,
  insurance: insurance,
  project: project,
};
