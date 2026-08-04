/**
 * AssignUserWidget — lets a manager assign a rep to the lead, then advances
 * the stage. Fetches the rep list from the company's user roster.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useAdvanceStage, type WidgetProps } from './shared';

interface RepUser {
  id: string;
  firstName: string | null;
  lastName:  string | null;
}

export function AssignUserWidget({ leadId, toStage, config, onSuccess }: WidgetProps) {
  const label          = (config.label          as string | undefined) ?? 'Assign Rep';
  const sourcePipeline = (config.sourcePipeline as string | undefined);
  const [selectedId, setSelectedId] = useState('');
  const { mutate, isPending } = useAdvanceStage(leadId);

  const { data: repsData, isLoading: loadingReps } = useQuery({
    queryKey: ['company-reps'],
    queryFn: () => customFetch<{ users: RepUser[] }>('/api/companies/users'),
    staleTime: 60_000,
  });

  const reps = repsData?.users ?? [];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    const rep = reps.find((r) => r.id === selectedId);
    const repName = rep ? [rep.firstName, rep.lastName].filter(Boolean).join(' ') : selectedId;
    mutate(
      {
        toStage,
        trigger:        'task',
        taskPayload:    { assignedUserId: selectedId, assignedUserName: repName },
        sourcePipeline,
      },
      { onSuccess: (data) => onSuccess?.(data.lead) },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {loadingReps ? (
        <p className="text-xs text-muted-foreground">Loading reps…</p>
      ) : (
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
          required
        >
          <option value="">Select a rep…</option>
          {reps.map((rep) => (
            <option key={rep.id} value={rep.id}>
              {[rep.firstName, rep.lastName].filter(Boolean).join(' ') || rep.id}
            </option>
          ))}
        </select>
      )}
      <Button
        type="submit"
        size="sm"
        className="w-full"
        disabled={isPending || !selectedId}
      >
        {isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
        Assign
      </Button>
    </form>
  );
}
