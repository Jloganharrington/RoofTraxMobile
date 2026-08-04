/**
 * DatetimeWidget — date/time picker that advances the stage on submit.
 * When config.setsNextAction is true the picked datetime is sent as
 * loopNextActionAt (loop stage due-date).
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useAdvanceStage, type WidgetProps } from './shared';

export function DatetimeWidget({ leadId, toStage, config, onSuccess }: WidgetProps) {
  const label         = (config.label as string | undefined)        ?? 'Set Date';
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

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 text-sm"
        required
      />
      <Button type="submit" size="sm" className="w-full" disabled={isPending || !value}>
        {isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
        Confirm
      </Button>
    </form>
  );
}
