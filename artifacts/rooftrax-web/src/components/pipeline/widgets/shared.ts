/**
 * Shared types and the useAdvanceStage hook used by every exit-task widget.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { getLeadQueryKey, getLeadsQueryKey, type FullLead } from '@/lib/claimHubApi';

export type AdvanceTrigger = 'task' | 'manual_move';

export interface AdvanceStagePayload {
  toStage: string;
  trigger: AdvanceTrigger;
  taskPayload?: Record<string, unknown>;
  lossReason?: string;
  loopNextActionAt?: string; // ISO datetime
}

export interface WidgetProps {
  leadId: string;
  /** The stage key this widget will advance to on success */
  toStage: string;
  /** Widget display config (label, placeholder, outcomes list, etc.) */
  config: Record<string, unknown>;
  /** Called after a successful advance — parent can close inline widget */
  onSuccess?: (lead: FullLead) => void;
}

/** Returns a mutation that calls PATCH /api/leads/:leadId/advance-stage */
export function useAdvanceStage(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdvanceStagePayload) =>
      customFetch<{ lead: FullLead }>(`/api/leads/${leadId}/advance-stage`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      qc.setQueryData(getLeadQueryKey(leadId), data);
      qc.invalidateQueries({ queryKey: getLeadsQueryKey() });
    },
  });
}
