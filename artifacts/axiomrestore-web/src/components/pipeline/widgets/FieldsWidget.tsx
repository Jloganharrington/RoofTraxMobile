/**
 * FieldsWidget — one or more labeled text/number/date fields before advancing.
 * Used for stages like archived_lost where a lossReason must be captured.
 *
 * config.fields: Array<{ name: string; label: string; type: 'text'|'number'|'date' }>
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useAdvanceStage, type WidgetProps } from './shared';

interface FieldDef {
  name:  string;
  label: string;
  type:  'text' | 'number' | 'date';
}

export function FieldsWidget({ leadId, toStage, config, onSuccess }: WidgetProps) {
  const label  = (config.label  as string     | undefined) ?? 'Submit';
  const fields = (config.fields as FieldDef[] | undefined) ?? [];

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, ''])),
  );
  const { mutate, isPending } = useAdvanceStage(leadId);

  function handleChange(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const allFilled = fields.every((f) => values[f.name]?.trim());
    if (!allFilled) return;

    // lossReason is a special top-level field on the advance-stage payload
    const lossReason = values['lossReason'];
    mutate(
      {
        toStage,
        trigger: 'task',
        taskPayload: values,
        ...(lossReason ? { lossReason } : {}),
      },
      { onSuccess: (data) => onSuccess?.(data.lead) },
    );
  }

  const allFilled = fields.every((f) => values[f.name]?.trim());

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2">
      {fields.map((field) => (
        <div key={field.name} className="space-y-1">
          <Label className="text-xs text-muted-foreground">{field.label}</Label>
          <Input
            type={field.type}
            value={values[field.name] ?? ''}
            onChange={(e) => handleChange(field.name, e.target.value)}
            className="h-8 text-sm"
            required
          />
        </div>
      ))}
      <Button
        type="submit"
        size="sm"
        className="w-full"
        disabled={isPending || !allFilled}
      >
        {isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
        {label}
      </Button>
    </form>
  );
}
