/**
 * MoneyConfirmWidget — currency amount input + confirm button.
 * Sends the amount as taskPayload[config.moneyField] on advance.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useAdvanceStage, type WidgetProps } from './shared';

export function MoneyConfirmWidget({ leadId, toStage, config, onSuccess }: WidgetProps) {
  const label      = (config.label      as string | undefined) ?? 'Record Amount';
  const moneyField = (config.moneyField as string | undefined) ?? 'amount';
  const [amount, setAmount] = useState('');
  const { mutate, isPending } = useAdvanceStage(leadId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount) return;
    mutate(
      {
        toStage,
        trigger: 'task',
        taskPayload: { [moneyField]: amount },
      },
      { onSuccess: (data) => onSuccess?.(data.lead) },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          $
        </span>
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="h-8 pl-6 text-sm"
          required
        />
      </div>
      <Button type="submit" size="sm" className="w-full" disabled={isPending || !amount}>
        {isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
        Confirm
      </Button>
    </form>
  );
}
