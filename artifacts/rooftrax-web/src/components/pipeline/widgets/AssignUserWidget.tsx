/**
 * AssignUserWidget — lets a manager assign a rep to the lead, then advances
 * the stage. Fetches the rep list from the company's user roster.
 * When onClose is provided the widget is in inline-card mode.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdvanceStage, type WidgetProps } from './shared';

interface RepUser {
  id: string;
  firstName: string | null;
  lastName:  string | null;
}

export function AssignUserWidget({ leadId, toStage, config, onSuccess, onClose }: WidgetProps) {
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
  const dark = !!onClose;

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
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex items-center justify-between">
        <p className={cn('text-xs font-medium', dark ? 'text-white/50' : 'text-muted-foreground')}>
          {label}
        </p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-white/30 hover:text-white/60 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {loadingReps ? (
        <p className={cn('text-xs', dark ? 'text-white/40' : 'text-muted-foreground')}>Loading reps…</p>
      ) : (
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className={cn(
            'w-full h-8 rounded-md border px-2 text-sm',
            dark
              ? 'border-white/15 bg-white/5 text-white'
              : 'border-input bg-background',
          )}
          required
        >
          <option value="" className={cn(dark && 'bg-slate-800')}>Select a rep…</option>
          {reps.map((rep) => (
            <option key={rep.id} value={rep.id} className={cn(dark && 'bg-slate-800')}>
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
