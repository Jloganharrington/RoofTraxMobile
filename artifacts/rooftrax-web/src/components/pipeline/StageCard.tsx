/**
 * StageCard — dark kanban card wrapper.
 * Handles pipeline loop-stage visual states (overdue, aged, stage-review).
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
  /**
   * When true the stage was automatically assigned during a null-stage
   * normalisation pass. Renders an orange badge so a manager can confirm
   * the placement is correct.
   */
  needsStageReview?: boolean;
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
  const r = Math.floor(n);
  return r === 1 ? '1d' : `${r}d`;
}

export function StageCard({
  children,
  stageEnteredAt,
  loopNextActionAt,
  isLoopStage = false,
  needsStageReview = false,
  className,
}: StageCardProps) {
  const enteredDate    = toDate(stageEnteredAt);
  const nextActionDate = toDate(loopNextActionAt);
  const now            = new Date();

  const isOverdue   = isLoopStage && nextActionDate !== null && nextActionDate < now;
  const daysInStage = enteredDate ? daysSince(enteredDate) : null;
  const isAged      = daysInStage !== null && daysInStage > 14;

  return (
    <div
      className={cn(
        'relative rounded-xl p-3.5 transition-all',
        'bg-[#1e2235] border border-white/[0.08]',
        isOverdue && 'border-amber-500/40 ring-1 ring-amber-500/10',
        className,
      )}
    >
      {/* Age badge — red when >14 days in stage */}
      {daysInStage !== null && daysInStage >= 1 && (
        <span
          className={cn(
            'absolute top-2.5 right-2.5 text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none',
            isAged
              ? 'bg-red-500/20 text-red-400'
              : 'bg-white/[0.07] text-white/40',
          )}
          title={enteredDate ? `In stage since ${enteredDate.toLocaleDateString()}` : undefined}
        >
          {formatDays(daysInStage)}
        </span>
      )}

      {/* Stage-review badge */}
      {needsStageReview && (
        <p className="text-[10px] font-medium text-orange-400 mb-1.5">Stage review needed</p>
      )}

      {/* Overdue badge */}
      {isOverdue && (
        <p className="text-[10px] font-medium text-amber-400 mb-1.5">Action overdue</p>
      )}

      {children}
    </div>
  );
}

export default StageCard;
