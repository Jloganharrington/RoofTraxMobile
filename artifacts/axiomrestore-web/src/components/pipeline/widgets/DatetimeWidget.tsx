/**
 * DatetimeWidget — date/time picker that advances the stage on submit.
 * When config.setsNextAction is true the picked datetime is sent as
 * loopNextActionAt (loop stage due-date).
 * When onClose is provided the widget is in inline-card mode and renders
 * a × button to collapse back to the trigger.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdvanceStage, type WidgetProps } from './shared';

export function DatetimeWidget({ leadId, toStage, config, onSuccess, onClose }: WidgetProps) {
  const label          = (config.label as string | undefined)        ?? 'Set Date';
  const setsNextAction = (config.setsNextAction as boolean | undefined) ?? false;
  const [value, setValue] = useState('');
  const { mutate, isPending } = useAdvanceStage(leadId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value) return;
    const iso = new Date(value).toISOString();
    mutate(
      {
        toStage,
        trigger: 'task',
        taskPayload: { scheduledAt: iso },
        ...(setsNextAction && { loopNextActionAt: iso }),
      },
      { onSuccess: (data) => onSuccess?.(data.lead) },
    );
  }

  const dark = !!onClose;

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className={cn('text-xs', dark ? 'text-white/50' : 'text-muted-foreground')}>
          {label}
        </Label>
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
      <Input
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={cn('h-8 text-sm', dark && 'border-white/15 bg-white/5 text-white')}
        required
        autoFocus={dark}
      />
      <Button type="submit" size="sm" className="w-full" disabled={isPending || !value}>
        {isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
        Confirm
      </Button>
    </form>
  );
}
