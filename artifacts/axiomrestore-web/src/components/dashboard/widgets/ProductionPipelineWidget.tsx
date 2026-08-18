import { useGetPipelineFunnelWidget } from '@workspace/api-client-react';
import { PipelineFunnelDisplay, FunnelLoading, FunnelError } from './_PipelineFunnelDisplay';

// All project-pipeline stages treated equally — no highlights needed.
// Closed (Warranty) is the only terminal stage; it appears in the
// archived footer if any pins have reached it.
export function ProductionPipelineWidget() {
  const { data, isLoading, isError } = useGetPipelineFunnelWidget({ pipeline: 'project' });

  if (isLoading) return <FunnelLoading />;
  if (isError || !data) return <FunnelError label="production pipeline" />;

  return <PipelineFunnelDisplay data={data} />;
}
