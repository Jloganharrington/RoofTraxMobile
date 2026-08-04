/**
 * OutcomeButtonsWidget — branch widget that lets the rep choose one of several
 * possible next stages (e.g. Claim Approved / Claim Denied / Public Adjuster).
 *
 * config.outcomes: Array<{ key: string; label: string; toStage: string }>
 */
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useAdvanceStage, type WidgetProps } from './shared';

interface Outcome {
  key: string;
  label: string;
  toStage: string;
}

export function OutcomeButtonsWidget({ leadId, toStage: _toStage, config, onSuccess }: WidgetProps) {
  const label    = (config.label    as string    | undefined) ?? 'Choose Outcome';
  const outcomes = (config.outcomes as Outcome[] | undefined) ?? [];
  const [pending, setPending] = useState<string | null>(null);
  const { mutate } = useAdvanceStage(leadId);

  function handleOutcome(outcome: Outcome) {
    setPending(outcome.key);
    mutate(
      {
        toStage:     outcome.toStage,
        trigger:     'task',
        taskPayload: { outcomeKey: outcome.key },
      },
      {
        onSuccess: (data) => {
          setPending(null);
          onSuccess?.(data.lead);
        },
        onError: () => setPending(null),
      },
    );
  }

  if (outcomes.length === 0) return null;

  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {outcomes.map((outcome) => (
        <Button
          key={outcome.key}
          size="sm"
          variant="outline"
          className="w-full justify-start text-left"
          disabled={pending !== null}
          onClick={() => handleOutcome(outcome)}
        >
          {pending === outcome.key && (
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
          )}
          {outcome.label}
        </Button>
      ))}
    </div>
  );
}
