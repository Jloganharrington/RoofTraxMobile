/**
 * Pipeline stage vocabulary — full 30-stage definition for all three pipelines.
 * Each stage carries label, phase, loop/terminal flags, exit-task metadata,
 * and optional auto-advance trigger info.
 *
 * Backward-compatible named exports (INSURANCE_STAGES, RETAIL_STAGES,
 * PROJECT_STAGES) are preserved as filtered arrays for existing consumers.
 */

// ---------------------------------------------------------------------------
// Exit-task widget types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Profile sub-statuses (insurance only) — preserved for existing consumers
// ---------------------------------------------------------------------------

export const STAGE_PROFILE_STATUSES: Record<string, string[]> = {
  phase1_scheduled: [
    'Appointment Set',
    'Appointment Confirmed',
    'Inspection Completed',
  ],
  contract_generated: [
    'Damage Assessment In Progress',
    'Measurements Needed',
    'Measurements Received',
    'Building Estimate',
    'Contract Ready',
  ],
  ins_contract_signed: [
    'Contract Sent',
    'Contract Signed',
    'Awaiting Deposit',
  ],
  ins_deposit_received: [
    'Deposit Received',
    'Ready to File Claim',
  ],
  claim_filed: [
    'Claim Submitted',
    'Awaiting Adjuster Assignment',
    'Adjuster Assigned',
    'Meeting Scheduled',
  ],
  proof_package: [
    'Gathering Documentation',
    'Code Violations Identified',
    'Photo Organization',
    'Package Complete',
  ],
  adjuster_review: [
    'Awaiting Initial Estimate',
    'Initial Estimate Received',
    'Reviewing Variance',
    'Supplement Needed',
    'Supplement Package Created',
    'Supplement Submitted',
    'Supplement Under Review',
    'Negotiating Additional Items',
  ],
  claim_approved: [
    'Full Approval Received',
    'Partial Approval Received',
    'ACV Pending',
    'ACV Received',
    'Ready for Production',
  ],
  selections: [
    'Material Selections Pending',
    'Selections In Progress',
    'Selections Complete',
    'Awaiting Material Order',
  ],
  claim_denied: [
    'Below Deductible',
    'Claim Denied - Reviewing Options',
    'Appeal Prepared',
    'Appeal Submitted',
    'Converting to Self-Pay',
    'Cancelling Contract',
  ],
  public_adjuster: [
    'PA Engaged',
    'PA Reviewing File',
    'PA Supplement Submitted',
    'PA Negotiating',
  ],
  appraisal: [
    'Appraisal Clause Invoked',
    'Selecting Appraiser',
    'Appraisal Scheduled',
    'Appraisal In Progress',
    'Appraisal Award Received',
  ],
};

/** Auto-populated profile status when a lead enters a stage */
export const STAGE_DEFAULT_PROFILE_STATUS: Record<string, string> = {
  phase1_scheduled:     'Appointment Set',
  contract_generated:   'Damage Assessment In Progress',
  ins_contract_signed:  'Contract Sent',
  ins_deposit_received: 'Deposit Received',
  claim_filed:          'Claim Submitted',
  proof_package:        'Gathering Documentation',
  adjuster_review:      'Awaiting Initial Estimate',
  claim_approved:       'Full Approval Received',
  selections:           'Material Selections Pending',
  claim_denied:         'Claim Denied - Reviewing Options',
  public_adjuster:      'PA Engaged',
  appraisal:            'Appraisal Clause Invoked',
};
/** Human-readable label for any stage key across all pipelines */
export function getStageLabel(key: string | null | undefined): string {
  if (!key) return '—';
  const found = findStageByKey(key);
  if (found) return found.label;
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export type ExitTaskType =
  | 'AssignUser'
  | 'Datetime'
  | 'DateRange'
  | 'Confirm'
  | 'MoneyConfirm'
  | 'OutcomeButtons'
  | 'ButtonLink'
  | 'Fields'
  | 'Upload';

export type PipelineId = 'retail' | 'insurance' | 'project';

const define = (d: StageDefinition): StageDefinition => d;

/** Look up a stage definition by pipeline + key */
export function getStage(pipeline: PipelineId, key: string): StageDefinition | undefined {
  return ALL_STAGES[`${pipeline}:${key}`];
}

export interface StageDefinition {
  pipeline: PipelineId;
  key: string;
  label: string;
  phase: string;
  /** Stage requires a recurring action — shows amber border / red age badge */
  isLoopStage: boolean;
  /** Stage is an end state — no further transitions expected */
  isTerminal: boolean;
  exitTask: ExitTask;
  /** If set, this stage auto-advances when a matching pipeline event fires */
  autoAdvance?: {
    eventType: string;
    /** Optional key/value conditions from the event payload that must match */
    outcomeRules?: Record<string, unknown>;
  };
}

/**
 * Look up a stage definition by key alone (searches all pipelines).
 * When a key appears in multiple pipelines, returns the first match.
 * Prefer `getStage(pipeline, key)` when the pipeline is known.
 */
export function findStageByKey(key: string): StageDefinition | undefined {
  return Object.values(ALL_STAGES).find((s) => s.key === key);
}

export interface ExitTask {
  type: ExitTaskType;
  config: ExitTaskConfig;
}

export const ALL_STAGES: Record<string, StageDefinition> = {
  // ══════════════════════════════════════════════════════════════════════════
  // RETAIL (10 stages) — spec-exact keys from task #206
  // ══════════════════════════════════════════════════════════════════════════

  'retail:pin_dropped': define({
    pipeline: 'retail',
    key: 'pin_dropped',
    label: 'Pin Dropped',
    phase: 'new',
    isLoopStage: false,
    isTerminal: false,
    exitTask: { type: 'AssignUser', config: { label: 'Assign Sales Rep', toStage: 'appt_needed' } },
  }),

  'retail:appt_needed': define({
    pipeline: 'retail',
    key: 'appt_needed',
    label: 'Appt. Needed',
    phase: 'new',
    isLoopStage: false,
    isTerminal: false,
    exitTask: { type: 'Datetime', config: { label: 'Schedule Appt.', setsNextAction: true, toStage: 'appt_scheduled' } },
  }),

  'retail:appt_scheduled': define({
    pipeline: 'retail',
    key: 'appt_scheduled',
    label: 'Appt. Scheduled',
    phase: 'active',
    isLoopStage: true,
    isTerminal: false,
    // Soft confirm — visual only, stage does not change
    exitTask: { type: 'Confirm', config: { label: 'Confirm Appt.', softConfirm: true } },
  }),

  'retail:appt_complete': define({
    pipeline: 'retail',
    key: 'appt_complete',
    label: 'Appt. Complete',
    phase: 'active',
    isLoopStage: false,
    isTerminal: false,
    exitTask: {
      type: 'ButtonLink',
      config: { label: 'Open Proposal Builder', href: '/leads/:leadId', awaitingBadge: 'Awaiting proposal' },
    },
    autoAdvance: { eventType: 'proposal_generated' },
  }),

  'retail:proposal_provided': define({
    pipeline: 'retail',
    key: 'proposal_provided',
    label: 'Proposal Provided',
    phase: 'active',
    isLoopStage: false,
    isTerminal: false,
    exitTask: {
      type: 'OutcomeButtons',
      config: {
        label: 'Next Step',
        requiresLossReason: true,
        outcomes: [
          { key: 'won',       label: 'Won — Contract',  toStage: 'contract_pending' },
          { key: 'follow_up', label: 'Follow-Up',        toStage: 'follow_up'        },
          { key: 'lost',      label: 'Lost',             toStage: 'archived_lost'    },
        ],
      },
    },
  }),

  'retail:follow_up': define({
    pipeline: 'retail',
    key: 'follow_up',
    label: 'Follow Up',
    phase: 'active',
    isLoopStage: true,
    isTerminal: false,
    exitTask: {
      type: 'OutcomeButtons',
      config: {
        label: 'Outcome',
        requiresLossReason: true,
        datetimeFirst: true,
        datetimeLabel: 'Next Follow-Up',
        outcomes: [
          { key: 'won',       label: 'Won — Contract',  toStage: 'contract_pending' },
          { key: 'follow_up', label: 'Follow-Up Again', toStage: 'follow_up'        },
          { key: 'lost',      label: 'Lost',            toStage: 'archived_lost'    },
        ],
      },
    },
  }),

  'retail:contract_pending': define({
    pipeline: 'retail',
    key: 'contract_pending',
    label: 'Contract Pending',
    phase: 'closing',
    isLoopStage: true,
    isTerminal: false,
    exitTask: {
      type: 'ButtonLink',
      config: { label: 'Generate Contract', href: '/leads/:leadId', awaitingBadge: 'Awaiting signature' },
    },
    autoAdvance: { eventType: 'contract_signed', outcomeRules: { pipeline: 'retail' } },
  }),

  'retail:contract_signed': define({
    pipeline: 'retail',
    key: 'contract_signed',
    label: 'Contract Signed',
    phase: 'closing',
    isLoopStage: false,
    isTerminal: false,
    exitTask: { type: 'MoneyConfirm', config: { label: 'Collect Deposit', moneyField: 'depositAmount', toStage: 'deposit_received' } },
  }),

  'retail:deposit_received': define({
    pipeline: 'retail',
    key: 'deposit_received',
    label: 'Deposit Received',
    phase: 'closing',
    isLoopStage: false,
    isTerminal: false,
    exitTask: { type: 'AssignUser', config: { label: 'Assign Project Manager', roleFilter: 'manager', toStage: 'pm_handoff', sourcePipeline: 'retail' } },
  }),

  'retail:archived_lost': define({
    pipeline: 'retail',
    key: 'archived_lost',
    label: 'Archived – Lost',
    phase: 'closed',
    isLoopStage: false,
    isTerminal: true,
    exitTask: { type: 'Confirm', config: { label: 'Archived' } },
  }),

  // ══════════════════════════════════════════════════════════════════════════
  // INSURANCE (15 stages)
  // ══════════════════════════════════════════════════════════════════════════

  'insurance:phase1_scheduled': define({
    pipeline: 'insurance',
    key: 'phase1_scheduled',
    label: 'Inspection Scheduled',
    phase: 'pre-claim',
    isLoopStage: true,
    isTerminal: false,
    exitTask: { type: 'Confirm', config: { label: 'Mark Inspection Complete' } },
    autoAdvance: { eventType: 'inspection_submitted' },
  }),

  'insurance:phase1_complete': define({
    pipeline: 'insurance',
    key: 'phase1_complete',
    label: 'Damage Documented',
    phase: 'pre-claim',
    isLoopStage: false,
    isTerminal: false,
    exitTask: { type: 'Confirm', config: { label: 'Start Proof Package' } },
  }),

  'insurance:proof_package': define({
    pipeline: 'insurance',
    key: 'proof_package',
    label: 'Generate Claim Proof Package',
    phase: 'pre-claim',
    isLoopStage: false,
    isTerminal: false,
    exitTask: {
      type: 'ButtonLink',
      config: { label: 'Open Claim Hub', href: '/rooftrax-web/leads/:leadId' },
    },
    autoAdvance: { eventType: 'proof_package_compiled' },
  }),

  'insurance:contract_generated': define({
    pipeline: 'insurance',
    key: 'contract_generated',
    label: 'Generate Contract',
    phase: 'pre-claim',
    isLoopStage: false,
    isTerminal: false,
    exitTask: { type: 'Confirm', config: { label: 'Mark Contract Sent' } },
  }),

  'insurance:contract_sent_ins': define({
    pipeline: 'insurance',
    key: 'contract_sent_ins',
    label: 'Contract Sent',
    phase: 'pre-claim',
    isLoopStage: true,
    isTerminal: false,
    exitTask: { type: 'Confirm', config: { label: 'Mark Contract Signed' } },
    autoAdvance: { eventType: 'contract_signed', outcomeRules: { pipeline: 'insurance' } },
  }),

  'insurance:ins_contract_signed': define({
    pipeline: 'insurance',
    key: 'ins_contract_signed',
    label: 'Contract Signed',
    phase: 'pre-claim',
    isLoopStage: false,
    isTerminal: false,
    exitTask: { type: 'MoneyConfirm', config: { label: 'Record Deposit', moneyField: 'depositAmount' } },
    autoAdvance: { eventType: 'deposit_received', outcomeRules: { pipeline: 'insurance' } },
  }),

  'insurance:ins_deposit_received': define({
    pipeline: 'insurance',
    key: 'ins_deposit_received',
    label: 'Deposit Received',
    phase: 'pre-claim',
    isLoopStage: false,
    isTerminal: false,
    exitTask: { type: 'Confirm', config: { label: 'File Claim' } },
  }),

  'insurance:claim_filed': define({
    pipeline: 'insurance',
    key: 'claim_filed',
    label: 'Claim Filed',
    phase: 'claims',
    isLoopStage: false,
    isTerminal: false,
    exitTask: { type: 'Datetime', config: { label: 'Schedule Adjuster Meeting', setsNextAction: true } },
  }),

  'insurance:adjuster_meeting': define({
    pipeline: 'insurance',
    key: 'adjuster_meeting',
    label: 'Adjuster Meeting Scheduled',
    phase: 'claims',
    isLoopStage: true,
    isTerminal: false,
    exitTask: { type: 'Confirm', config: { label: 'Meeting Held — Start Review' } },
  }),

  'insurance:adjuster_review': define({
    pipeline: 'insurance',
    key: 'adjuster_review',
    label: 'Adjuster Review',
    phase: 'claims',
    isLoopStage: true,
    isTerminal: false,
    exitTask: {
      type: 'OutcomeButtons',
      config: {
        label: 'Adjuster Outcome',
        outcomes: [
          { key: 'approved', label: 'Claim Approved',  toStage: 'claim_approved'  },
          { key: 'denied',   label: 'Claim Denied',    toStage: 'claim_denied'    },
          { key: 'pa',       label: 'Public Adjuster', toStage: 'public_adjuster' },
          { key: 'appraise', label: 'Appraisal',       toStage: 'appraisal'       },
        ],
      },
    },
  }),

  'insurance:claim_approved': define({
    pipeline: 'insurance',
    key: 'claim_approved',
    label: 'Claim Approved',
    phase: 'outcome',
    isLoopStage: false,
    isTerminal: false,
    exitTask: { type: 'MoneyConfirm', config: { label: 'Confirm RCV Amount', moneyField: 'rcvAmount' } },
  }),

  'insurance:selections': define({
    pipeline: 'insurance',
    key: 'selections',
    label: 'Selections',
    phase: 'outcome',
    isLoopStage: false,
    isTerminal: false,
    exitTask: { type: 'Confirm', config: { label: 'Selections Complete — Schedule Work' } },
  }),

  'insurance:claim_denied': define({
    pipeline: 'insurance',
    key: 'claim_denied',
    label: 'Claim Denied',
    phase: 'outcome',
    isLoopStage: false,
    isTerminal: false,
    exitTask: {
      type: 'OutcomeButtons',
      config: {
        label: 'Next Step',
        outcomes: [
          { key: 'pa',       label: 'Hire Public Adjuster', toStage: 'public_adjuster' },
          { key: 'appraise', label: 'Invoke Appraisal',     toStage: 'appraisal'       },
          { key: 'lost',     label: 'Archive as Lost',      toStage: 'archived_lost'   },
        ],
      },
    },
  }),

  'insurance:public_adjuster': define({
    pipeline: 'insurance',
    key: 'public_adjuster',
    label: 'Public Adjuster',
    phase: 'outcome',
    isLoopStage: true,
    isTerminal: false,
    exitTask: {
      type: 'OutcomeButtons',
      config: {
        label: 'PA Outcome',
        outcomes: [
          { key: 'approved', label: 'Claim Approved', toStage: 'claim_approved' },
          { key: 'denied',   label: 'Still Denied',   toStage: 'claim_denied'   },
        ],
      },
    },
  }),

  'insurance:appraisal': define({
    pipeline: 'insurance',
    key: 'appraisal',
    label: 'Appraisal',
    phase: 'outcome',
    isLoopStage: true,
    isTerminal: false,
    exitTask: {
      type: 'OutcomeButtons',
      config: {
        label: 'Appraisal Outcome',
        outcomes: [
          { key: 'approved', label: 'Award Received — Approved', toStage: 'claim_approved' },
          { key: 'denied',   label: 'Award Insufficient',        toStage: 'claim_denied'   },
        ],
      },
    },
  }),

  // Insurance terminal
  'insurance:archived_lost': define({
    pipeline: 'insurance',
    key: 'archived_lost',
    label: 'Archived – Lost',
    phase: 'closed',
    isLoopStage: false,
    isTerminal: true,
    exitTask: { type: 'Fields', config: { label: 'Archive Lead', fields: [{ name: 'lossReason', label: 'Loss Reason', type: 'text' }] } },
  }),

  // ══════════════════════════════════════════════════════════════════════════
  // PROJECT (8 stages) — authoritative keys from task #208
  // ══════════════════════════════════════════════════════════════════════════

  'project:pm_handoff': define({
    pipeline: 'project',
    key: 'pm_handoff',
    label: 'PM Handoff',
    phase: 'handoff',
    isLoopStage: false,
    isTerminal: false,
    exitTask: { type: 'Confirm', config: { label: 'Accept Handoff' } },
  }),

  'project:pre_production': define({
    pipeline: 'project',
    key: 'pre_production',
    label: 'Pre-Production',
    phase: 'production',
    isLoopStage: false,
    isTerminal: false,
    exitTask: {
      type: 'Fields',
      config: {
        label: 'Order Materials',
        fields: [
          { name: 'supplierName', label: 'Supplier Name', type: 'text' },
          { name: 'etaDate',      label: 'ETA Date',      type: 'date' },
        ],
      },
    },
  }),

  'project:materials_ordered': define({
    pipeline: 'project',
    key: 'materials_ordered',
    label: 'Materials Ordered',
    phase: 'production',
    isLoopStage: false,
    isTerminal: false,
    exitTask: { type: 'DateRange', config: { label: 'Schedule Project' } },
  }),

  'project:scheduled': define({
    pipeline: 'project',
    key: 'scheduled',
    label: 'Scheduled',
    phase: 'production',
    isLoopStage: false,
    isTerminal: false,
    exitTask: { type: 'Confirm', config: { label: 'Start Project' } },
  }),

  'project:in_production': define({
    pipeline: 'project',
    key: 'in_production',
    label: 'In Production',
    phase: 'production',
    isLoopStage: false,
    isTerminal: false,
    exitTask: { type: 'Confirm', config: { label: 'Mark Complete' } },
  }),

  'project:complete': define({
    pipeline: 'project',
    key: 'complete',
    label: 'Complete',
    phase: 'closeout',
    isLoopStage: false,
    isTerminal: false,
    exitTask: {
      type: 'ButtonLink',
      config: { label: 'Open Completion Package', href: '/rooftrax-web/leads/:leadId' },
    },
    autoAdvance: { eventType: 'completion_package_generated' },
  }),

  'project:final_invoiced': define({
    pipeline: 'project',
    key: 'final_invoiced',
    label: 'Final Invoiced',
    phase: 'closeout',
    isLoopStage: true,
    isTerminal: false,
    exitTask: { type: 'MoneyConfirm', config: { label: 'Record Final Payment', moneyField: 'finalPaymentAmount' } },
  }),

  'project:closed_warranty': define({
    pipeline: 'project',
    key: 'closed_warranty',
    label: 'Closed (Warranty)',
    phase: 'closed',
    isLoopStage: false,
    isTerminal: true,
    exitTask: { type: 'Confirm', config: { label: 'Reopen' } },
  }),
};

// ---------------------------------------------------------------------------
// Backward-compatible filtered arrays (declared AFTER ALL_STAGES to avoid TDZ)
// ---------------------------------------------------------------------------

export const INSURANCE_STAGES = Object.values(ALL_STAGES).filter(
  (s) => s.pipeline === 'insurance',
);
export type InsuranceStageKey = string;

export const RETAIL_STAGES = Object.values(ALL_STAGES).filter(
  (s) => s.pipeline === 'retail',
);
export type RetailStageKey = string;

export const PROJECT_STAGES = Object.values(ALL_STAGES).filter(
  (s) => s.pipeline === 'project',
);
export type ProjectStageKey = string;

export interface ExitTaskConfig {
  /** Button label shown on the kanban card */
  label?: string;
  /** Placeholder / helper text */
  placeholder?: string;
  /** For OutcomeButtons: list of {key, label, toStage} choices */
  outcomes?: Array<{ key: string; label: string; toStage: string }>;
  /** For ButtonLink: href pattern (may contain :leadId) */
  href?: string;
  /** For Fields: field definitions */
  fields?: Array<{ name: string; label: string; type: 'text' | 'number' | 'date' }>;
  /** Whether the datetime sets loopNextActionAt (loop stages) */
  setsNextAction?: boolean;
  /** For MoneyConfirm: currency display label */
  moneyField?: string;
  /** The stage to advance to (used inline in config for clarity) */
  toStage?: string;
  /** Whether this confirm is visual-only (no stage change) */
  softConfirm?: boolean;
  /** Badge text shown while awaiting an async event (ButtonLink stages) */
  awaitingBadge?: string;
  /** For OutcomeButtons: require a loss reason before transitioning to archived_lost */
  requiresLossReason?: boolean;
  /** For OutcomeButtons: show a datetime picker above the outcome buttons */
  datetimeFirst?: boolean;
  /** Label for the datetimeFirst picker */
  datetimeLabel?: string;
  /** For AssignUser: role filter (e.g. 'manager') */
  roleFilter?: string;
  /** For cross-pipeline convergence: stamp sourcePipeline when advancing */
  sourcePipeline?: string;
  /** Extra arbitrary payload to merge into taskPayload on advance */
  taskPayload?: Record<string, unknown>;
}
