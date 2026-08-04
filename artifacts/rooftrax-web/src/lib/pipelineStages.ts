/**
 * Pipeline stage vocabulary — mirrors the RoofTraxAdmin shared schema.
 * Defines stages, labels, and profile sub-statuses for all three pipelines.
 */

// ---------------------------------------------------------------------------
// Insurance pipeline stages
// ---------------------------------------------------------------------------

export const INSURANCE_STAGES = [
  { key: 'inspection_scheduled',       label: 'Inspection Scheduled',         phase: 'pre-claim'  },
  { key: 'damage_documented',          label: 'Damage Documented',             phase: 'pre-claim'  },
  { key: 'create_claim_proof_package', label: 'Generate Claim Proof Package',  phase: 'pre-claim'  },
  { key: 'generate_contract',          label: 'Generate Contract',             phase: 'pre-claim'  },
  { key: 'contract_signed',            label: 'Contract Signed',               phase: 'pre-claim'  },
  { key: 'deposit_received',           label: 'Deposit Received',              phase: 'pre-claim'  },
  { key: 'claim_filed',                label: 'Claim Filed',                   phase: 'claims'     },
  { key: 'adjuster_review',            label: 'Adjuster Review',               phase: 'claims'     },
  { key: 'claim_approved',             label: 'Claim Approved',                phase: 'outcome'    },
  { key: 'selections',                 label: 'Selections',                    phase: 'outcome'    },
  { key: 'claim_denied',               label: 'Claim Denied',                  phase: 'outcome'    },
  { key: 'public_adjuster',            label: 'Public Adjuster',               phase: 'outcome'    },
  { key: 'appraisal',                  label: 'Appraisal',                     phase: 'outcome'    },
] as const;

export type InsuranceStageKey = (typeof INSURANCE_STAGES)[number]['key'];

// ---------------------------------------------------------------------------
// Retail pipeline stages
// ---------------------------------------------------------------------------

export const RETAIL_STAGES = [
  { key: 'pin_dropped',       label: 'Pin Dropped'        },
  { key: 'appt_scheduled',    label: 'Appt. Scheduled'    },
  { key: 'appt_confirmed',    label: 'Appt. Confirmed'    },
  { key: 'estimate_provided', label: 'Estimate Provided'  },
  { key: 'followup_required', label: 'Follow-Up Required' },
  { key: 'contract_signed',   label: 'Contract Signed'    },
  { key: 'deposit_received',  label: 'Deposit Received'   },
  { key: 'archived_lost',     label: 'Archived – Lost'    },
] as const;

export type RetailStageKey = (typeof RETAIL_STAGES)[number]['key'];

// ---------------------------------------------------------------------------
// Project pipeline stages
// ---------------------------------------------------------------------------

export const PROJECT_STAGES = [
  { key: 'work_scheduled',          label: 'Work Scheduled'           },
  { key: 'order_materials',         label: 'Order Materials'          },
  { key: 'replacement_complete',    label: 'Replacement Complete'     },
  { key: 'certificate_of_completion', label: 'Certificate of Completion' },
  { key: 'final_payment_received',  label: 'Final Payment Received'   },
  { key: 'archived_complete',       label: 'Archived – Complete'      },
] as const;

export type ProjectStageKey = (typeof PROJECT_STAGES)[number]['key'];

// ---------------------------------------------------------------------------
// Profile sub-statuses (insurance only) — keyed by pipeline stage
// ---------------------------------------------------------------------------

export const STAGE_PROFILE_STATUSES: Record<string, string[]> = {
  inspection_scheduled: [
    'Appointment Set',
    'Appointment Confirmed',
    'Inspection Completed',
  ],
  generate_contract: [
    'Damage Assessment In Progress',
    'Measurements Needed',
    'Measurements Received',
    'Building Estimate',
    'Contract Ready',
  ],
  contract_signed: [
    'Contract Sent',
    'Contract Signed',
    'Awaiting Deposit',
  ],
  deposit_received: [
    'Deposit Received',
    'Ready to File Claim',
  ],
  claim_filed: [
    'Claim Submitted',
    'Awaiting Adjuster Assignment',
    'Adjuster Assigned',
    'Meeting Scheduled',
  ],
  create_claim_proof_package: [
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
  inspection_scheduled:       'Appointment Set',
  generate_contract:          'Damage Assessment In Progress',
  contract_signed:            'Contract Sent',
  deposit_received:           'Deposit Received',
  claim_filed:                'Claim Submitted',
  create_claim_proof_package: 'Gathering Documentation',
  adjuster_review:            'Awaiting Initial Estimate',
  claim_approved:             'Full Approval Received',
  selections:                 'Material Selections Pending',
  claim_denied:               'Claim Denied - Reviewing Options',
  public_adjuster:            'PA Engaged',
  appraisal:                  'Appraisal Clause Invoked',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up a human-readable label for any stage key across all pipelines */
export function getStageLabel(key: string | null | undefined): string {
  if (!key) return '—';
  const all = [
    ...INSURANCE_STAGES,
    ...RETAIL_STAGES,
    ...PROJECT_STAGES,
  ] as { key: string; label: string }[];
  return all.find((s) => s.key === key)?.label ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
