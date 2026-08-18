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
 *
 * When onClose is provided the widget is in inline-card mode and renders
 * a × button to collapse back to the trigger.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
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

export function OutcomeButtonsWidget({ leadId, toStage: _toStage, config, onSuccess, onClose }: WidgetProps) {
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

  const dark = !!onClose;

  function handleOutcome(outcome: Outcome) {
    if (requiresLossReason && outcome.toStage === 'archived_lost') {
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
      <form onSubmit={handleLossSubmit} className="space-y-2">
        <div className="flex items-center justify-between">
          <p className={cn('text-xs font-medium', dark ? 'text-white/50' : 'text-muted-foreground')}>
            Reason for loss
          </p>
          {onClose && (
            <button type="button" onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <select
          value={lossReason}
          onChange={(e) => setLossReason(e.target.value)}
          className={cn(
            'w-full h-8 rounded-md border px-2 text-sm',
            dark ? 'border-white/15 bg-white/5 text-white' : 'border-input bg-background',
          )}
          required
        >
          <option value="" className={cn(dark && 'bg-slate-800')}>Select reason…</option>
          {LOSS_REASONS.map((r) => (
            <option key={r.value} value={r.value} className={cn(dark && 'bg-slate-800')}>
              {r.label}
            </option>
          ))}
        </select>
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn('flex-1', dark ? 'text-white/40 hover:text-white/60' : 'text-muted-foreground')}
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
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className={cn('text-xs font-medium', dark ? 'text-white/50' : 'text-muted-foreground')}>
          {label}
        </p>
        {onClose && (
          <button type="button" onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {datetimeFirst && (
        <div className="space-y-1 mb-2">
          <Label className={cn('text-xs', dark ? 'text-white/50' : 'text-muted-foreground')}>
            {datetimeLabel}
          </Label>
          <Input
            type="datetime-local"
            value={datetime}
            onChange={(e) => setDatetime(e.target.value)}
            className={cn('h-8 text-sm', dark && 'border-white/15 bg-white/5 text-white')}
          />
        </div>
      )}
      {outcomes.map((outcome) => (
        <Button
          key={outcome.key}
          size="sm"
          variant="outline"
          className={cn(
            'w-full justify-start text-left',
            dark && 'border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.07] hover:text-white',
          )}
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
