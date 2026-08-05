/**
 * MoneyConfirmWidget — currency amount input + confirm button.
 * Sends the amount as taskPayload[config.moneyField] on advance.
 * When onClose is provided the widget is in inline-card mode.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdvanceStage, type WidgetProps } from './shared';

export function MoneyConfirmWidget({ leadId, toStage, config, onSuccess, onClose }: WidgetProps) {
  const label      = (config.label      as string | undefined) ?? 'Record Amount';
  const moneyField = (config.moneyField as string | undefined) ?? 'amount';
  const [amount, setAmount] = useState('');
  const { mutate, isPending } = useAdvanceStage(leadId);
  const dark = !!onClose;

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
      <div className="relative">
        <span className={cn(
          'absolute left-2.5 top-1/2 -translate-y-1/2 text-sm',
          dark ? 'text-white/40' : 'text-muted-foreground',
        )}>
          $
        </span>
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={cn('h-8 pl-6 text-sm', dark && 'border-white/15 bg-white/5 text-white')}
          required
          autoFocus={dark}
        />
      </div>
      <Button type="submit" size="sm" className="w-full" disabled={isPending || !amount}>
        {isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
        Confirm
      </Button>
    </form>
  );
}
