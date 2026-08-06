import { useGetPipelineFunnelWidget } from '@workspace/api-client-react';
import { PipelineFunnelDisplay, FunnelLoading, FunnelError } from './_PipelineFunnelDisplay';

// Claim-lifecycle stages are highlighted (full-opacity primary bars).
// All other insurance stages render at reduced opacity so the manager's
// attention lands on the adjudication funnel, not the pre-filing stages.
const CLAIM_LIFECYCLE_KEYS = new Set([
  'claim_review',
  'supplement_dispute',
  'adjuster_meeting',
  'adjuster_review',
  'appraisal',
  'public_adjuster',
  'claim_approved',
  'claim_denied',   // rendered if present in the stage vocabulary
]);

export function InsuranceClaimsWidget() {
  const { data, isLoading, isError } = useGetPipelineFunnelWidget({ pipeline: 'insurance' });

  if (isLoading) return <FunnelLoading />;
  if (isError || !data) return <FunnelError label="insurance claims" />;

  return <PipelineFunnelDisplay data={data} highlightKeys={CLAIM_LIFECYCLE_KEYS} />;
}
