import { useGetPipelineFunnelWidget } from '@workspace/api-client-react';
import { PipelineFunnelDisplay, FunnelLoading, FunnelError } from './_PipelineFunnelDisplay';

// Decision: retail-only.
// The insurance pipeline has its own dedicated InsuranceClaimsWidget that
// emphasises the claim-lifecycle stages. Including insurance here would
// conflate two very different sales motions into one count.
export function SalesFunnelWidget() {
  const { data, isLoading, isError } = useGetPipelineFunnelWidget({ pipeline: 'retail' });

  if (isLoading) return <FunnelLoading />;
  if (isError || !data) return <FunnelError label="sales funnel" />;

  return <PipelineFunnelDisplay data={data} />;
}
