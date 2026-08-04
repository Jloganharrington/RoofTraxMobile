/**
 * OutcomeButtonsWidget — branch widget that lets the rep choose one of several
 * possible next stages (e.g. Claim Approved / Claim Denied / Public Adjuster).
 *
 * config.outcomes: Array<{ key: string; label: string; toStage: string }>
 * config.requiresLossReason: boolean — when true, outcomes going to archived_lost
 *   must first collect a lossReason before the stage advance fires.
 * config.datetimeFirst: boolean — when true, shows a datetime picker above the
 *   outcome buttons (used by the follow_up loop stage).
 * config.datetimeLabel: string — label for the datetime picker.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useAdvanceStage, type WidgetProps } from './shared';

interface Outcome {
  key: string;
  label: string;
  toStage: string;
}

const LOSS_REASONS = [
  { value: 'price',       label: 'Price' },
  { value: 'timing',      label: 'Timing' },
  { value: 'competitor',  label: 'Competitor' },
  { value: 'no_response', label: 'No Response' },
  { value: 'other',       label: 'Other' },
];

export function OutcomeButtonsWidget({ leadId, toStage: _toStage, config, onSuccess }: WidgetProps) {
  const label              = (config.label              as string    | undefined) ?? 'Choose Outcome';
  const outcomes           = (config.outcomes           as Outcome[] | undefined) ?? [];
  const requiresLossReason = (config.requiresLossReason as boolean   | undefined) ?? false;
  const datetimeFirst      = (config.datetimeFirst      as boolean   | undefined) ?? false;
  const datetimeLabel      = (config.datetimeLabel      as string    | undefined) ?? 'Next Action';

  const [pending, setPending]         = useState<string | null>(null);
  const [lossOutcome, setLossOutcome] = useState<Outcome | null>(null);
  const [lossReason, setLossReason]   = useState('');
  const [datetime, setDatetime]       = useState('');
  const { mutate } = useAdvanceStage(leadId);

  function handleOutcome(outcome: Outcome) {
    if (requiresLossReason && outcome.toStage === 'archived_lost') {
      // Show inline loss-reason picker before advancing
      setLossOutcome(outcome);
      return;
    }
    advance(outcome, undefined);
  }

  function handleLossSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lossOutcome || !lossReason) return;
    advance(lossOutcome, lossReason);
  }

  function advance(outcome: Outcome, lr: string | undefined) {
    setPending(outcome.key);
    const iso = datetime ? new Date(datetime).toISOString() : undefined;
    mutate(
      {
        toStage:          outcome.toStage,
        trigger:          'task',
        taskPayload:      { outcomeKey: outcome.key, ...(iso && { nextActionAt: iso }) },
        lossReason:       lr,
        loopNextActionAt: datetimeFirst && iso ? iso : undefined,
      },
      {
        onSuccess: (data) => {
          setPending(null);
          setLossOutcome(null);
          setLossReason('');
          onSuccess?.(data.lead);
        },
        onError: () => { setPending(null); setLossOutcome(null); },
      },
    );
  }

  if (outcomes.length === 0) return null;

  // Inline loss-reason picker
  if (lossOutcome) {
    return (
      <form onSubmit={handleLossSubmit} className="mt-2 space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Reason for loss</p>
        <select
          value={lossReason}
          onChange={(e) => setLossReason(e.target.value)}
          className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
          required
        >
          <option value="">Select reason…</option>
          {LOSS_REASONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="flex-1 text-muted-foreground"
            onClick={() => setLossOutcome(null)}
            disabled={pending !== null}
          >
            Back
          </Button>
          <Button
            type="submit"
            size="sm"
            variant="destructive"
            className="flex-1"
            disabled={!lossReason || pending !== null}
          >
            {pending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
            Confirm Lost
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      {datetimeFirst && (
        <div className="space-y-1 mb-2">
          <Label className="text-xs text-muted-foreground">{datetimeLabel}</Label>
          <Input
            type="datetime-local"
            value={datetime}
            onChange={(e) => setDatetime(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
      )}
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
