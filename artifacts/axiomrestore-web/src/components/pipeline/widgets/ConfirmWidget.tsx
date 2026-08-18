/**
 * ConfirmWidget — single-button confirmation to advance to the next stage.
 * Used for stages where no extra data is needed (e.g. "Mark Contract Signed").
 */
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useAdvanceStage, type WidgetProps } from './shared';

export function ConfirmWidget({ leadId, toStage, config, onSuccess }: WidgetProps) {
  const label = (config.label as string | undefined) ?? 'Confirm';
  const { mutate, isPending } = useAdvanceStage(leadId);

  function handleClick() {
    mutate(
      { toStage, trigger: 'task' },
      { onSuccess: (data) => onSuccess?.(data.lead) },
    );
  }

  return (
    <Button
      size="sm"
      className="w-full mt-2"
      onClick={handleClick}
      disabled={isPending}
    >
      {isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
      {label}
    </Button>
  );
}
