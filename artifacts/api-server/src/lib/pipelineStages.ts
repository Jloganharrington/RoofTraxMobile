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
  { pipeline: 'insurance', key: 'phase1_scheduled',    label: 'Inspection Scheduled',         isLoopStage: true,  isTerminal: false, order: 0,  autoAdvance: { eventType: 'inspection_submitted' } },
  { pipeline: 'insurance', key: 'phase1_complete',     label: 'Damage Documented',            isLoopStage: false, isTerminal: false, order: 1 },
  { pipeline: 'insurance', key: 'proof_package',       label: 'Generate Claim Proof Package', isLoopStage: false, isTerminal: false, order: 2,  autoAdvance: { eventType: 'proof_package_compiled' } },
  { pipeline: 'insurance', key: 'contract_generated',  label: 'Generate Contract',            isLoopStage: false, isTerminal: false, order: 3 },
  { pipeline: 'insurance', key: 'contract_sent_ins',   label: 'Contract Sent',                isLoopStage: true,  isTerminal: false, order: 4,  autoAdvance: { eventType: 'contract_signed', outcomeRules: { pipeline: 'insurance' } } },
  { pipeline: 'insurance', key: 'ins_contract_signed', label: 'Contract Signed',              isLoopStage: false, isTerminal: false, order: 5,  autoAdvance: { eventType: 'deposit_received', outcomeRules: { pipeline: 'insurance' } } },
  { pipeline: 'insurance', key: 'ins_deposit_received',label: 'Deposit Received',             isLoopStage: false, isTerminal: false, order: 6 },
  { pipeline: 'insurance', key: 'claim_filed',         label: 'Claim Filed',                  isLoopStage: false, isTerminal: false, order: 7 },
  { pipeline: 'insurance', key: 'adjuster_meeting',    label: 'Adjuster Meeting Scheduled',   isLoopStage: true,  isTerminal: false, order: 8 },
  { pipeline: 'insurance', key: 'adjuster_review',     label: 'Adjuster Review',              isLoopStage: true,  isTerminal: false, order: 9, outcomes: [{ key: 'approved', toStage: 'claim_approved' }, { key: 'denied', toStage: 'claim_denied' }, { key: 'pa', toStage: 'public_adjuster' }, { key: 'appraise', toStage: 'appraisal' }] },
  { pipeline: 'insurance', key: 'claim_approved',      label: 'Claim Approved',               isLoopStage: false, isTerminal: false, order: 10 },
  { pipeline: 'insurance', key: 'selections',          label: 'Selections',                   isLoopStage: false, isTerminal: false, order: 11 },
  { pipeline: 'insurance', key: 'claim_denied',        label: 'Claim Denied',                 isLoopStage: false, isTerminal: false, order: 12, outcomes: [{ key: 'pa', toStage: 'public_adjuster' }, { key: 'appraise', toStage: 'appraisal' }, { key: 'lost', toStage: 'archived_lost' }] },
  { pipeline: 'insurance', key: 'public_adjuster',     label: 'Public Adjuster',              isLoopStage: true,  isTerminal: false, order: 13, outcomes: [{ key: 'approved', toStage: 'claim_approved' }, { key: 'denied', toStage: 'claim_denied' }] },
  { pipeline: 'insurance', key: 'appraisal',           label: 'Appraisal',                    isLoopStage: true,  isTerminal: false, order: 14, outcomes: [{ key: 'approved', toStage: 'claim_approved' }, { key: 'denied', toStage: 'claim_denied' }] },
  { pipeline: 'insurance', key: 'archived_lost',       label: 'Archived – Lost',              isLoopStage: false, isTerminal: true,  order: 15 },
];

const project: ServerStageDef[] = [
  { pipeline: 'project', key: 'work_scheduled',          label: 'Work Scheduled',           isLoopStage: true,  isTerminal: false, order: 0 },
  { pipeline: 'project', key: 'materials_ordered',       label: 'Materials Ordered',        isLoopStage: false, isTerminal: false, order: 1 },
  { pipeline: 'project', key: 'work_started',            label: 'Work In Progress',         isLoopStage: false, isTerminal: false, order: 2 },
  { pipeline: 'project', key: 'replacement_complete',    label: 'Replacement Complete',     isLoopStage: false, isTerminal: false, order: 3 },
  { pipeline: 'project', key: 'certificate_of_completion', label: 'Certificate of Completion', isLoopStage: false, isTerminal: false, order: 4 },
  { pipeline: 'project', key: 'final_payment_pending',   label: 'Final Payment Pending',    isLoopStage: true,  isTerminal: false, order: 5, autoAdvance: { eventType: 'final_payment_received' } },
  { pipeline: 'project', key: 'final_payment_received',  label: 'Final Payment Received',   isLoopStage: false, isTerminal: false, order: 6 },
  { pipeline: 'project', key: 'archived_complete',       label: 'Archived – Complete',      isLoopStage: false, isTerminal: true,  order: 7 },
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
