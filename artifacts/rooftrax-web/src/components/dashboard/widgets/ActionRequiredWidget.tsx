import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface ActionRequiredItem {
  id: string;
  label: string;
  detail?: string;
}

interface ActionRequiredResponse {
  items: ActionRequiredItem[];
}

function useActionRequired() {
  return useQuery({
    queryKey: ['dashboard', 'widgets', 'action_required'],
    queryFn: () =>
      customFetch<ActionRequiredResponse>('/api/dashboard/widgets/action_required'),
  });
}

/** Items stuck across pipeline stages, CFR clocks, and claim blockers (manager+). */
export function ActionRequiredWidget() {
  const { data, isLoading, isError } = useActionRequired();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
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
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li key={item.id} className="py-3">
          <p className="text-sm font-semibold">{item.label}</p>
          {item.detail && (
            <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
