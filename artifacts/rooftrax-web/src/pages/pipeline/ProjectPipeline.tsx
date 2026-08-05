/**
 * Project Pipeline — 8-stage kanban (accordion) for converged Retail + Insurance projects.
 *
 * Stages (in order):
 *   pm_handoff → pre_production → materials_ordered → scheduled →
 *   in_production → complete → final_invoiced → closed_warranty (terminal)
 *
 * Cards carry a source badge (R = retail / I = insurance). Insurance-sourced
 * cards show a CFR supplement clock counting down from the 21-day window that
 * starts at pm_handoff entry. The closed_warranty column is hidden by default
 * and revealed by the "Show Closed" toggle.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Shell } from '@/components/layout/Shell';
import { Skeleton } from '@/components/ui/skeleton';
import { StageCard } from '@/components/pipeline/StageCard';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, ExternalLink, MapPin } from 'lucide-react';
import {
  useGetProjectPipeline,
  useAdvanceProjectStage,
  type ProjectPipelineLead,
} from '@/lib/claimHubApi';

// ---------------------------------------------------------------------------
// Stage definitions
// ---------------------------------------------------------------------------

interface ProjStageDef {
  key: string;
  label: string;
  accent: string;
  textAccent: string;
  isTerminal: boolean;
  /** Stage key this stage's exit task advances to (undefined for terminal) */
  toStage?: string;
}

const ALL_PROJ_STAGES: ProjStageDef[] = [
  { key: 'pm_handoff',        label: 'PM Handoff',       accent: 'border-blue-400',    textAccent: 'text-blue-400',    isTerminal: false, toStage: 'pre_production'   },
  { key: 'pre_production',    label: 'Pre-Production',   accent: 'border-violet-400',  textAccent: 'text-violet-400',  isTerminal: false, toStage: 'materials_ordered' },
  { key: 'materials_ordered', label: 'Materials Ordered',accent: 'border-amber-400',   textAccent: 'text-amber-400',   isTerminal: false, toStage: 'scheduled'        },
  { key: 'scheduled',         label: 'Scheduled',        accent: 'border-orange-400',  textAccent: 'text-orange-400',  isTerminal: false, toStage: 'in_production'    },
  { key: 'in_production',     label: 'In Production',    accent: 'border-emerald-400', textAccent: 'text-emerald-400', isTerminal: false, toStage: 'complete'         },
  { key: 'complete',          label: 'Complete',         accent: 'border-green-400',   textAccent: 'text-green-400',   isTerminal: false, toStage: 'final_invoiced'   },
  { key: 'final_invoiced',    label: 'Final Invoiced',   accent: 'border-teal-400',    textAccent: 'text-teal-400',    isTerminal: false, toStage: 'closed_warranty'  },
  { key: 'closed_warranty',   label: 'Closed (Warranty)',accent: 'border-zinc-400',    textAccent: 'text-zinc-400',    isTerminal: true                               },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysSinceIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

function formatDamageType(dt: string | null | undefined): string {
  if (!dt) return '';
  return dt.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Source badge — "R" (retail, green) or "I" (insurance, blue)
// ---------------------------------------------------------------------------

function SourceBadge({ source }: { source: string | null }) {
  if (!source) return null;
  const isIns = source === 'insurance';
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center text-[9px] font-black w-4 h-4 rounded-full shrink-0',
        isIns
          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
          : 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
      )}
      title={isIns ? 'Insurance pipeline' : 'Retail pipeline'}
    >
      {isIns ? 'I' : 'R'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CFR supplement clock — 21-day window from pm_handoff entry
// ---------------------------------------------------------------------------

function CfrClock({ pmHandoffAt }: { pmHandoffAt: string | null }) {
  const elapsed = daysSinceIso(pmHandoffAt);
  if (elapsed === null) return null;
  const remaining = 21 - Math.floor(elapsed);
  const isExpired = remaining <= 0;
  const isWarning = !isExpired && remaining <= 7;
  return (
    <span
      className={cn(
        'inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded',
        isExpired
          ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
          : isWarning
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
            : 'bg-muted text-muted-foreground',
      )}
      title="Days remaining in 21-day CFR supplement window from PM Handoff"
    >
      CFR&nbsp;{isExpired ? 'expired' : `${remaining}d`}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Exit-task widgets
// ---------------------------------------------------------------------------

function ConfirmWidget({
  label,
  onConfirm,
  isPending,
}: {
  label: string;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onConfirm(); }}
      disabled={isPending}
      className="w-full mt-2 text-[11px] font-medium px-2 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
    >
      {isPending ? 'Saving…' : label}
    </button>
  );
}

function FieldsWidget({
  fields,
  submitLabel,
  onSubmit,
  onClose,
  isPending,
}: {
  fields: Array<{ name: string; label: string; type: 'text' | 'date' }>;
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => void;
  onClose?: () => void;
  isPending: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(fields.map((f) => [f.name, ''])),
  );
  const set = (name: string, val: string) =>
    setValues((prev) => ({ ...prev, [name]: val }));

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); onSubmit(values); }}
      onClick={(e) => e.stopPropagation()}
      className="mt-2 space-y-1.5"
    >
      {onClose && (
        <div className="flex justify-end -mt-0.5 mb-0.5">
          <button type="button" onClick={onClose} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            <span className="sr-only">Close</span>✕
          </button>
        </div>
      )}
      {fields.map((f) => (
        <div key={f.name}>
          <label className="text-[10px] text-muted-foreground block mb-0.5">{f.label}</label>
          <input
            type={f.type}
            value={values[f.name]}
            onChange={(e) => set(f.name, e.target.value)}
            className="w-full text-[11px] border border-input rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={f.type === 'text' ? f.label : undefined}
          />
        </div>
      ))}
      <button
        type="submit"
        disabled={isPending}
        className="w-full text-[11px] font-medium px-2 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {isPending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}

function DateRangeWidget({
  submitLabel,
  onSubmit,
  onClose,
  isPending,
}: {
  submitLabel: string;
  onSubmit: (startDate: string, endDate: string) => void;
  onClose?: () => void;
  isPending: boolean;
}) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); onSubmit(startDate, endDate); }}
      onClick={(e) => e.stopPropagation()}
      className="mt-2 space-y-1.5"
    >
      {onClose && (
        <div className="flex justify-end -mt-0.5 mb-0.5">
          <button type="button" onClick={onClose} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            <span className="sr-only">Close</span>✕
          </button>
        </div>
      )}
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Start Date</label>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-full text-[11px] border border-input rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">End Date</label>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="w-full text-[11px] border border-input rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="w-full text-[11px] font-medium px-2 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {isPending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}

function MoneyConfirmWidget({
  submitLabel,
  fieldLabel,
  onConfirm,
  onClose,
  isPending,
}: {
  submitLabel: string;
  fieldLabel: string;
  onConfirm: (amount: string) => void;
  onClose?: () => void;
  isPending: boolean;
}) {
  const [amount, setAmount] = useState('');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); onConfirm(amount); }}
      onClick={(e) => e.stopPropagation()}
      className="mt-2 space-y-1.5"
    >
      {onClose && (
        <div className="flex justify-end -mt-0.5 mb-0.5">
          <button type="button" onClick={onClose} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            <span className="sr-only">Close</span>✕
          </button>
        </div>
      )}
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">{fieldLabel}</label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full text-[11px] border border-input rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="0.00"
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="w-full text-[11px] font-medium px-2 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {isPending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}

/** Full-width action button style for project pipeline (below-card position). */
const PROJ_BTN =
  'w-full text-[11px] font-medium px-2 py-1.5 rounded-md ' +
  'bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-center';

// ---------------------------------------------------------------------------
// Project card
// ---------------------------------------------------------------------------

function ProjectCard({
  lead,
  stageKey,
  toStage,
}: {
  lead: ProjectPipelineLead;
  stageKey: string;
  toStage?: string;
}) {
  const advance   = useAdvanceProjectStage(lead.id);
  const isIns     = lead.sourcePipeline === 'insurance';
  const [widgetOpen, setWidgetOpen] = useState(false);

  const openWidget  = () => setWidgetOpen(true);
  const closeWidget = () => setWidgetOpen(false);
  const handleAdvance = (payload: Parameters<typeof advance.mutate>[0]) => {
    advance.mutate(payload, { onSuccess: closeWidget });
  };

  return (
    <div className="relative">
      {/* Navigate to lead detail on card body click */}
      <Link href={`/leads/${lead.id}`} className="block">
        <StageCard stageEnteredAt={lead.stageEnteredAt} className="h-full">
          {/* Address + source badge */}
          <div className="flex items-start gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <span className="text-xs font-medium leading-tight line-clamp-2 flex-1 min-w-0">
              {lead.address ?? 'Unknown address'}
            </span>
            <SourceBadge source={lead.sourcePipeline} />
          </div>

          {/* Customer name */}
          {lead.customerName && (
            <p className="text-[10px] text-muted-foreground truncate mt-1">
              {lead.customerName}
            </p>
          )}

          {/* CFR clock for insurance leads that have entered pm_handoff */}
          {isIns && lead.pmHandoffAt && (
            <div className="mt-1">
              <CfrClock pmHandoffAt={lead.pmHandoffAt} />
            </div>
          )}

          {/* Damage type */}
          {lead.damageType && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {formatDamageType(lead.damageType)}
            </p>
          )}

          {/* Footer: rep + link icon */}
          <div className="flex items-center gap-1 pt-1.5 mt-1 border-t border-border/40">
            <span className="text-[10px] text-muted-foreground truncate flex-1">
              {lead.repName ?? <span className="italic opacity-50">No rep</span>}
            </span>
            <ExternalLink className="h-3 w-3 text-muted-foreground/40 shrink-0" />
          </div>
        </StageCard>
      </Link>

      {/* Exit-task widget — rendered below the card so clicks don't trigger Link navigation */}
      <div className="mt-1.5 px-0.5">

        {/* Simple confirm buttons — always visible, no data entry needed */}
        {stageKey === 'pm_handoff' && toStage && (
          <ConfirmWidget
            label="Accept Handoff"
            isPending={advance.isPending}
            onConfirm={() =>
              advance.mutate({
                toStage,
                trigger: 'task',
                taskPayload: { pmHandoffAt: new Date().toISOString() },
              })
            }
          />
        )}

        {stageKey === 'scheduled' && toStage && (
          <ConfirmWidget
            label="Start Project"
            isPending={advance.isPending}
            onConfirm={() => advance.mutate({ toStage, trigger: 'task' })}
          />
        )}

        {stageKey === 'in_production' && toStage && (
          <ConfirmWidget
            label="Mark Complete"
            isPending={advance.isPending}
            onConfirm={() => advance.mutate({ toStage, trigger: 'task' })}
          />
        )}

        {stageKey === 'complete' && (
          <Link
            href={`/leads/${lead.id}`}
            className={`block mt-2 ${PROJ_BTN}`}
          >
            Open Completion Package
          </Link>
        )}

        {/* Form-requiring stages — trigger button → inline expansion */}
        {stageKey === 'pre_production' && toStage && (
          widgetOpen ? (
            <FieldsWidget
              fields={[
                { name: 'supplierName', label: 'Supplier Name', type: 'text' },
                { name: 'etaDate',      label: 'ETA Date',      type: 'date' },
              ]}
              submitLabel="Order Materials"
              isPending={advance.isPending}
              onClose={closeWidget}
              onSubmit={(values) =>
                handleAdvance({ toStage, trigger: 'task', taskPayload: values })
              }
            />
          ) : (
            <button
              type="button"
              onClick={openWidget}
              className={`mt-2 ${PROJ_BTN}`}
            >
              Order Materials
            </button>
          )
        )}

        {stageKey === 'materials_ordered' && toStage && (
          widgetOpen ? (
            <DateRangeWidget
              submitLabel="Schedule Project"
              isPending={advance.isPending}
              onClose={closeWidget}
              onSubmit={(startDate, endDate) =>
                handleAdvance({
                  toStage,
                  trigger: 'task',
                  taskPayload: { startDate, endDate },
                })
              }
            />
          ) : (
            <button
              type="button"
              onClick={openWidget}
              className={`mt-2 ${PROJ_BTN}`}
            >
              Schedule Project
            </button>
          )
        )}

        {stageKey === 'final_invoiced' && toStage && (
          widgetOpen ? (
            <MoneyConfirmWidget
              submitLabel="Record Final Payment"
              fieldLabel="Payment Amount ($)"
              isPending={advance.isPending}
              onClose={closeWidget}
              onConfirm={(amount) =>
                handleAdvance({
                  toStage,
                  trigger: 'task',
                  taskPayload: { finalPaymentAmount: amount },
                })
              }
            />
          ) : (
            <button
              type="button"
              onClick={openWidget}
              className={`mt-2 ${PROJ_BTN}`}
            >
              Record Final Payment
            </button>
          )
        )}

        {/* closed_warranty: terminal — no exit widget */}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accordion section
// ---------------------------------------------------------------------------

interface AccordionSectionProps {
  stage: ProjStageDef;
  cards: ProjectPipelineLead[];
  isLoading: boolean;
  open: boolean;
  onToggle: () => void;
}

function AccordionSection({ stage, cards, isLoading, open, onToggle }: AccordionSectionProps) {
  return (
    <div className={cn('rounded-2xl border bg-card overflow-hidden border-l-4', stage.accent)}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-4 py-3.5 hover:bg-muted/20 transition-colors text-left"
      >
        <span className={cn('text-sm font-semibold flex-1', stage.textAccent)}>{stage.label}</span>
        {stage.isTerminal && (
          <span className="text-[10px] font-medium text-muted-foreground/50 mr-1">terminal</span>
        )}
        <span className={cn('text-sm font-bold tabular-nums mr-1', stage.textAccent)}>
          {isLoading ? '—' : cards.length}
        </span>
        {open
          ? <ChevronDown className="h-4 w-4 text-muted-foreground/60 shrink-0" />
          : <ChevronRight className="h-4 w-4 text-muted-foreground/60 shrink-0" />
        }
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2 border-t border-border/30 bg-muted/10">
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pt-2">
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl opacity-70" />
              <Skeleton className="h-28 w-full rounded-xl opacity-40" />
            </div>
          ) : cards.length === 0 ? (
            <p className="text-xs text-muted-foreground/40 italic py-5 text-center">
              No projects in this stage
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pt-2">
              {cards.map((lead) => (
                <ProjectCard
                  key={lead.id}
                  lead={lead}
                  stageKey={stage.key}
                  toStage={stage.toStage}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProjectPipeline() {
  const { data, isLoading } = useGetProjectPipeline();
  const leads = data?.leads ?? [];

  // Persist last-visited pipeline so the home redirect can resume here.
  useEffect(() => { localStorage.setItem('rt_last_pipeline', '/project-pipeline'); }, []);

  // Demo leads filter (persistent across page loads)
  const [hideDemos, setHideDemos] = useState(
    () => localStorage.getItem('rt_hide_demos') === 'true',
  );
  const visibleLeads = hideDemos ? leads.filter((l) => !l.isDemo) : leads;

  const [showClosed, setShowClosed] = useState(false);

  const visibleStages = showClosed
    ? ALL_PROJ_STAGES
    : ALL_PROJ_STAGES.filter((s) => s.key !== 'closed_warranty');

  const grouped = useMemo(() => {
    const map = new Map<string, ProjectPipelineLead[]>();
    for (const s of ALL_PROJ_STAGES) map.set(s.key, []);
    for (const lead of visibleLeads) {
      map.get(lead.pipelineStage)?.push(lead);
    }
    return map;
  }, [visibleLeads]);

  const demoCount  = leads.filter((l) => l.isDemo).length;
  const activeCount = visibleLeads.filter((l) => l.pipelineStage !== 'closed_warranty').length;
  const closedCount = grouped.get('closed_warranty')?.length ?? 0;

  // All non-terminal stages open by default; closed_warranty collapsed until toggled.
  const [openStages, setOpenStages] = useState<Set<string>>(
    () => new Set(ALL_PROJ_STAGES.filter((s) => !s.isTerminal).map((s) => s.key)),
  );

  const toggle = (key: string) => {
    setOpenStages((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Shell>
      <div className="space-y-4 max-w-6xl">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Project Pipeline</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isLoading
                ? 'Loading…'
                : `${activeCount} active project${activeCount !== 1 ? 's' : ''}${
                    closedCount > 0 ? ` · ${closedCount} closed` : ''
                  }`}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Hide demo toggle */}
            {demoCount > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hideDemos}
                  onChange={(e) => {
                    setHideDemos(e.target.checked);
                    localStorage.setItem('rt_hide_demos', String(e.target.checked));
                  }}
                  className="rounded border-border"
                />
                Hide demo
                <span className="text-[10px] tabular-nums bg-muted px-1.5 py-0.5 rounded-full">
                  {demoCount}
                </span>
              </label>
            )}
            {demoCount > 0 && <span className="text-muted-foreground/30 text-xs">·</span>}
            {/* Show Closed toggle */}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showClosed}
                onChange={(e) => {
                  setShowClosed(e.target.checked);
                  if (e.target.checked) {
                    setOpenStages((prev) => new Set([...prev, 'closed_warranty']));
                  }
                }}
                className="rounded border-border"
              />
              Show Closed
              {closedCount > 0 && (
                <span className="text-[10px] tabular-nums bg-muted px-1.5 py-0.5 rounded-full">
                  {closedCount}
                </span>
              )}
            </label>
            <span className="text-muted-foreground/30 text-xs">·</span>
            <button
              type="button"
              onClick={() => setOpenStages(new Set(visibleStages.map((s) => s.key)))}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Expand all
            </button>
            <span className="text-muted-foreground/30 text-xs">·</span>
            <button
              type="button"
              onClick={() => setOpenStages(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Collapse all
            </button>
          </div>
        </div>

        {/* Stage pills — horizontal scrollable overview */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none -mx-1 px-1">
          {visibleStages.map((stage) => {
            const count  = grouped.get(stage.key)?.length ?? 0;
            const active = openStages.has(stage.key);
            return (
              <button
                key={stage.key}
                type="button"
                onClick={() => toggle(stage.key)}
                className={cn(
                  'flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-all',
                  count > 0
                    ? cn(stage.accent, stage.textAccent, 'bg-card', active ? 'opacity-100' : 'opacity-50')
                    : 'border-border/40 text-muted-foreground/40 cursor-default',
                )}
                disabled={count === 0}
              >
                {stage.label}
                {count > 0 && (
                  <span
                    className={cn(
                      'min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold',
                      active ? 'bg-foreground/15' : 'bg-foreground/10',
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Stage accordions */}
        <div className="space-y-2">
          {visibleStages.map((stage) => (
            <AccordionSection
              key={stage.key}
              stage={stage}
              cards={grouped.get(stage.key) ?? []}
              isLoading={isLoading}
              open={openStages.has(stage.key)}
              onToggle={() => toggle(stage.key)}
            />
          ))}
        </div>
      </div>
    </Shell>
  );
}
