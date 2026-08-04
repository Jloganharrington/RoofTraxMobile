/**
 * DateRangeWidget — start + end date pickers that advance the stage on submit.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useAdvanceStage, type WidgetProps } from './shared';

export function DateRangeWidget({ leadId, toStage, config, onSuccess }: WidgetProps) {
  const label = (config.label as string | undefined) ?? 'Set Date Range';
  const [start, setStart] = useState('');
  const [end,   setEnd]   = useState('');
  const { mutate, isPending } = useAdvanceStage(leadId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!start || !end) return;
    mutate(
      {
        toStage,
        trigger: 'task',
        taskPayload: {
          startDate: new Date(start).toISOString(),
          endDate:   new Date(end).toISOString(),
        },
      },
      { onSuccess: (data) => onSuccess?.(data.lead) },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="space-y-1">
        <Label className="text-xs">Start</Label>
        <Input
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="h-8 text-sm"
          required
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">End</Label>
        <Input
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="h-8 text-sm"
          required
        />
      </div>
      <Button type="submit" size="sm" className="w-full" disabled={isPending || !start || !end}>
        {isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
        Confirm
      </Button>
    </form>
  );
}
