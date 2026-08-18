import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Link } from 'wouter';
import { customFetch, getGetActionRequiredWidgetQueryKey } from '@workspace/api-client-react';
import { CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface ActionRequiredItem {
  id: string;
  category: 'overdue_loop' | 'stalled_stage' | 'blocked_claim' | 'needs_review';
  label: string;
  ownerName: string;
  ownerId: string;
  stuckForLabel: string;
  rank: number;
  pinId: string;
  inspectionId: string | null;
  detail: string | null;
  pipelineStage: string | null;
}

interface ActionRequiredEnvelope {
  items: ActionRequiredItem[];
  total: number;
  capped: boolean;
}

const ACTION_REQUIRED_KEY = getGetActionRequiredWidgetQueryKey();

function useActionRequired() {
  return useQuery({
    queryKey: ACTION_REQUIRED_KEY,
    queryFn: () =>
      customFetch<ActionRequiredEnvelope>('/api/dashboard/widgets/action_required'),
  });
}

const CATEGORY_CONFIG: Record<
  ActionRequiredItem['category'],
  { label: string; badgeClass: string }
> = {
  overdue_loop: {
    label: 'Loop Overdue',
    badgeClass: 'bg-orange-100 text-orange-700 border-orange-200',
  },
  blocked_claim: {
    label: 'Blocked Claim',
    badgeClass: 'bg-red-100 text-red-700 border-red-200',
  },
  stalled_stage: {
    label: 'Stalled',
    badgeClass: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  },
  needs_review: {
    label: 'Review',
    badgeClass: 'bg-muted text-muted-foreground border-border',
  },
};

// ── Inline snooze widget for overdue loop items ───────────────────────────────

interface SnoozeFormProps {
  pinId: string;
  toStage: string;
  onClose: () => void;
}

function SnoozeForm({ pinId, toStage, onClose }: SnoozeFormProps) {
  const [value, setValue] = useState('');
  const qc = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: (isoDate: string) =>
      customFetch<unknown>(`/api/leads/${pinId}/advance-stage`, {
        method: 'PATCH',
        body: JSON.stringify({ toStage, trigger: 'task', loopNextActionAt: isoDate }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACTION_REQUIRED_KEY });
      onClose();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value) return;
    mutate(new Date(value).toISOString());
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2">
      <Label className="text-xs text-muted-foreground">Snooze until</Label>
      <Input
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 text-sm"
        required
        autoFocus
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="flex-1" disabled={isPending || !value}>
          {isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          Confirm
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ── Single item row ───────────────────────────────────────────────────────────

function ActionItem({ item }: { item: ActionRequiredItem }) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const cat = CATEGORY_CONFIG[item.category];

  return (
    <li className="py-3 space-y-1.5">
      <div className="flex items-start gap-2">
        <Badge
          className={cn(
            'shrink-0 mt-0.5 text-[10px] font-semibold uppercase tracking-wide border px-1.5 py-0',
            cat.badgeClass,
          )}
        >
          {cat.label}
        </Badge>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-snug truncate">{item.label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {item.ownerName} · {item.stuckForLabel}
          </p>
        </div>
      </div>

      {/* Inline snooze for overdue loop items */}
      {item.category === 'overdue_loop' && item.pipelineStage && !snoozeOpen && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setSnoozeOpen(true)}
          >
            Snooze
          </Button>
          <Link href={`/leads/${item.pinId}`} className="inline-flex">
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
              View <ExternalLink className="h-3 w-3" />
            </Button>
          </Link>
        </div>
      )}

      {item.category === 'overdue_loop' && item.pipelineStage && snoozeOpen && (
        <SnoozeForm
          pinId={item.pinId}
          toStage={item.pipelineStage}
          onClose={() => setSnoozeOpen(false)}
        />
      )}

      {/* Link-out for all other categories */}
      {item.category !== 'overdue_loop' && (
        <Link href={`/leads/${item.pinId}`} className="inline-flex">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 -ml-2">
            View Lead <ExternalLink className="h-3 w-3" />
          </Button>
        </Link>
      )}
    </li>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

/** Items stuck across pipeline stages and claim blockers (manager+). */
export function ActionRequiredWidget() {
  const { data, isLoading, isError } = useActionRequired();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        Could not load action items.
      </p>
    );
  }

  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-6 text-muted-foreground/50">
        <CheckCircle2 className="h-6 w-6" />
        <p className="text-xs font-semibold uppercase tracking-wide">
          Nothing requires your attention
        </p>
      </div>
    );
  }

  return (
    <div>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <ActionItem key={item.id} item={item} />
        ))}
      </ul>
      {data?.capped && (
        <p className="text-xs text-muted-foreground text-center pt-2 pb-1">
          Showing {items.length} of {data.total} items
        </p>
      )}
    </div>
  );
}
