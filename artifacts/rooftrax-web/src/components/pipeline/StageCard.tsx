/**
 * StageCard — kanban card wrapper that handles pipeline loop-stage visual states.
 *
 * - Amber border when loopNextActionAt is past (overdue)
 * - Red age badge when the pin has been in this stage >14 days
 */
import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface StageCardProps {
  children: ReactNode;
  /** Timestamp when the pin entered its current stage (ISO string or Date) */
  stageEnteredAt?: string | Date | null;
  /** For loop stages: when the next action is due (ISO string or Date) */
  loopNextActionAt?: string | Date | null;
  /** Whether this is a loop stage (enables overdue amber styling) */
  isLoopStage?: boolean;
  className?: string;
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}

function daysSince(d: Date): number {
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}

function formatDays(n: number): string {
  const rounded = Math.floor(n);
  return rounded === 1 ? '1d' : `${rounded}d`;
}

export function StageCard({
  children,
  stageEnteredAt,
  loopNextActionAt,
  isLoopStage = false,
  className,
}: StageCardProps) {
  const enteredDate  = toDate(stageEnteredAt);
  const nextActionDate = toDate(loopNextActionAt);

  const now = new Date();
  const isOverdue = isLoopStage && nextActionDate !== null && nextActionDate < now;
  const daysInStage = enteredDate ? daysSince(enteredDate) : null;
  const isAged = daysInStage !== null && daysInStage > 14;

  return (
    <div
      className={cn(
        'relative rounded-lg border bg-white shadow-sm p-3 transition-colors',
        isOverdue && 'border-amber-400 bg-amber-50/30',
        !isOverdue && 'border-border',
        className,
      )}
    >
      {/* Age badge — red when >14 days in stage */}
      {daysInStage !== null && daysInStage >= 1 && (
        <span
          className={cn(
            'absolute top-2 right-2 text-[10px] font-semibold rounded-full px-1.5 py-0.5 leading-none',
            isAged
              ? 'bg-red-100 text-red-700'
              : 'bg-muted text-muted-foreground',
          )}
          title={enteredDate ? `In stage since ${enteredDate.toLocaleDateString()}` : undefined}
        >
          {formatDays(daysInStage)}
        </span>
      )}

      {/* Overdue label for loop stages */}
      {isOverdue && (
        <p className="text-[10px] font-medium text-amber-600 mb-1">
          Action overdue
        </p>
      )}

      {children}
    </div>
  );
}

export default StageCard;
