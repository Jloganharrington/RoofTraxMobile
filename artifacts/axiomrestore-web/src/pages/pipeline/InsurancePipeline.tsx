/**
 * Insurance Pipeline — 15-stage inline-exit-task kanban.
 *
 * Every stage exit is performable from the card in ≤2 clicks.
 * Auto-advance stages show a waiting badge instead of a task widget.
 * supplement_dispute is a loop stage with composite widgets.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Shell } from '@/components/layout/Shell';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { differenceInDays, isPast, format } from 'date-fns';
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock,
  DollarSign,
  ExternalLink,
  FileText,
  Loader2,
  MapPin,
  Package,
  RefreshCw,
  UserPlus,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useGetPipeline,
  useAdvanceInsuranceStage,
  getPipelineQueryKey,
  type PipelineInspection,
} from '@/lib/claimHubApi';
import { StageCard } from '@/components/pipeline/StageCard';
import {
  AssignUserWidget,
  DatetimeWidget,
  FieldsWidget,
  OutcomeButtonsWidget,
  ButtonLinkWidget,
  MoneyConfirmWidget,
  UploadWidget,
} from '@/components/pipeline/widgets';

// ---------------------------------------------------------------------------
// Stage definitions — 15 stages in spec order
// ---------------------------------------------------------------------------

interface InsStage {
  key: string;
  label: string;
  accent: string;
  textAccent: string;
  isLoopStage: boolean;
  isTerminal: boolean;
  /** When true, show a waiting badge instead of a task widget */
  isAutoAdvance: boolean;
  /** Badge label shown on auto-advance cards */
  waitingLabel?: string;
}

const INS_STAGES: InsStage[] = [
  {
    key: 'pin_dropped',
    label: 'Pin Dropped',
    accent: 'border-slate-400',
    textAccent: 'text-slate-500',
    isLoopStage: false,
    isTerminal: false,
    isAutoAdvance: false,
  },
  {
    key: 'phase1_scheduled',
    label: 'Phase 1 Inspection Scheduled',
    accent: 'border-blue-400',
    textAccent: 'text-blue-500',
    isLoopStage: true,
    isTerminal: false,
    isAutoAdvance: true,
    waitingLabel: 'Awaiting field sync',
  },
  {
    key: 'phase1_complete',
    label: 'Phase 1 Complete',
    accent: 'border-indigo-400',
    textAccent: 'text-indigo-500',
    isLoopStage: false,
    isTerminal: false,
    isAutoAdvance: true,
    waitingLabel: 'Awaiting FIPSA',
  },
  {
    key: 'fipsa_signed',
    label: 'FIPSA Signed',
    accent: 'border-violet-400',
    textAccent: 'text-violet-500',
    isLoopStage: false,
    isTerminal: false,
    isAutoAdvance: false,
  },
  {
    key: 'phase2_scheduled',
    label: 'Phase 2 Inspection Scheduled',
    accent: 'border-purple-400',
    textAccent: 'text-purple-500',
    isLoopStage: true,
    isTerminal: false,
    isAutoAdvance: true,
    waitingLabel: 'Awaiting field sync',
  },
  {
    key: 'phase2_complete',
    label: 'Phase 2 Complete',
    accent: 'border-amber-400',
    textAccent: 'text-amber-500',
    isLoopStage: false,
    isTerminal: false,
    isAutoAdvance: true,
    waitingLabel: 'Awaiting package',
  },
  {
    key: 'package_ready',
    label: 'Proof Package Ready',
    accent: 'border-orange-400',
    textAccent: 'text-orange-500',
    isLoopStage: false,
    isTerminal: false,
    isAutoAdvance: false,
  },
  {
    key: 'claim_filed',
    label: 'Claim Filed',
    accent: 'border-emerald-400',
    textAccent: 'text-emerald-500',
    isLoopStage: false,
    isTerminal: false,
    isAutoAdvance: false,
  },
  {
    key: 'claim_review',
    label: 'Claim Under Review',
    accent: 'border-yellow-400',
    textAccent: 'text-yellow-600',
    isLoopStage: false,
    isTerminal: false,
    isAutoAdvance: false,
  },
  {
    key: 'supplement_dispute',
    label: 'Supplement / Dispute',
    accent: 'border-rose-400',
    textAccent: 'text-rose-500',
    isLoopStage: true,
    isTerminal: false,
    isAutoAdvance: false,
  },
  {
    key: 'claim_approved',
    label: 'Claim Approved',
    accent: 'border-green-400',
    textAccent: 'text-green-600',
    isLoopStage: false,
    isTerminal: false,
    isAutoAdvance: false,
  },
  {
    key: 'contract_pending',
    label: 'Contract Pending',
    accent: 'border-teal-400',
    textAccent: 'text-teal-500',
    isLoopStage: false,
    isTerminal: false,
    isAutoAdvance: true,
    waitingLabel: 'Awaiting signature',
  },
  {
    key: 'contract_signed',
    label: 'Contract Signed',
    accent: 'border-cyan-400',
    textAccent: 'text-cyan-600',
    isLoopStage: false,
    isTerminal: false,
    isAutoAdvance: false,
  },
  {
    key: 'deposit_received',
    label: 'Deposit Received',
    accent: 'border-lime-400',
    textAccent: 'text-lime-600',
    isLoopStage: false,
    isTerminal: false,
    isAutoAdvance: false,
  },
  {
    key: 'archived_no_damage',
    label: 'Archived — No Damage',
    accent: 'border-zinc-300',
    textAccent: 'text-zinc-400',
    isLoopStage: false,
    isTerminal: true,
    isAutoAdvance: false,
  },
];

const STAGE_BY_KEY = new Map(INS_STAGES.map((s) => [s.key, s]));

/** Compact trigger button — matches RetailPipeline style */
const COMPACT_BTN =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ' +
  'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 ' +
  'text-white text-[11px] font-semibold transition-colors whitespace-nowrap select-none';

// ---------------------------------------------------------------------------
// Legacy insurance stage keys → nearest new display column
// Ensures pins with old stage keys remain visible after the pipeline rebuild.
// ---------------------------------------------------------------------------

const LEGACY_INSURANCE_TO_NEW: Record<string, string> = {
  // Pre-claim legacy stages
  proof_package:        'package_ready',       // proof package generation
  contract_generated:   'claim_approved',      // post-approval contract generation
  contract_sent_ins:    'contract_pending',    // contract awaiting signature
  ins_contract_signed:  'contract_signed',     // contract signed
  ins_deposit_received: 'deposit_received',    // deposit collected
  // Claims legacy stages
  adjuster_meeting:     'claim_review',        // adjuster meeting ≈ under review
  adjuster_review:      'claim_review',        // adjuster review ≈ under review
  // Dispute/denial legacy stages
  claim_denied:         'supplement_dispute',  // denied → dispute loop
  public_adjuster:      'supplement_dispute',  // public adjuster engagement
  appraisal:            'supplement_dispute',  // appraisal process
  selections:           'claim_approved',      // material selections after approval
  archived_lost:        'archived_no_damage',  // terminal (closest equivalent)
};

// ---------------------------------------------------------------------------
// Status → stage key fallback (legacy ins- leads without a pin stageKey)
// ---------------------------------------------------------------------------

const STATUS_TO_STAGE: Record<string, string> = {
  pin_dropped:   'pin_dropped',
  scheduled:     'phase1_scheduled',
  capturing:     'phase2_complete',
  validating:    'package_ready',
  package_ready: 'package_ready',
  submitted:     'claim_filed',
};

function resolveStageKey(inspection: PipelineInspection): string | null {
  const key = inspection.stageKey;

  // Direct match in the new 15-stage vocabulary
  if (key && STAGE_BY_KEY.has(key)) return key;

  // Legacy insurance stage key → nearest new display column
  if (key && LEGACY_INSURANCE_TO_NEW[key]) return LEGACY_INSURANCE_TO_NEW[key];

  // Status-based fallback for legacy ins- leads without a pin stageKey
  return STATUS_TO_STAGE[inspection.status] ?? null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDamageType(dt: string | null | undefined): string {
  if (!dt) return '';
  return dt.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function leadId(inspection: PipelineInspection): string {
  return inspection.pinId ?? `ins-${inspection.id}`;
}

// ---------------------------------------------------------------------------
// Auto-advance waiting badge
// ---------------------------------------------------------------------------

function WaitingBadge({ label }: { label: string }) {
  return (
    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-400" />
      </span>
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SupplementDisputeWidget — composite widget for the loop stage
// ---------------------------------------------------------------------------

function SupplementDisputeWidget({
  inspection,
  onSuccess,
}: {
  inspection: PipelineInspection;
  onSuccess: () => void;
}) {
  const id = leadId(inspection);
  const [showDateForm, setShowDateForm] = useState(false);
  const [nextActionValue, setNextActionValue] = useState('');

  // Wire to the real API so loopNextActionAt is persisted
  const { mutate: setNextAction, isPending: isSavingDate } = useAdvanceInsuranceStage(id);

  function handleDateSave(e: React.FormEvent) {
    e.preventDefault();
    if (!nextActionValue) return;
    const iso = new Date(nextActionValue).toISOString();
    setNextAction(
      {
        toStage:         'supplement_dispute',
        trigger:         'manual_move',
        loopNextActionAt: iso,
      },
      {
        onSuccess: () => {
          setShowDateForm(false);
          setNextActionValue('');
          onSuccess();
        },
      },
    );
  }

  const nextAction = inspection.loopNextActionAt
    ? new Date(inspection.loopNextActionAt)
    : null;
  const isOverdue = nextAction !== null && isPast(nextAction);

  return (
    <div className="mt-2 space-y-2">
      {/* Claim Hub link */}
      <ButtonLinkWidget
        leadId={id}
        toStage="supplement_dispute"
        config={{ label: 'Open Claim Hub — Supplement', href: '/leads/:leadId?tab=claim' }}
        onSuccess={onSuccess}
      />

      {/* Next-action date */}
      {nextAction && !showDateForm ? (
        <div className={cn('text-[10px] flex items-center gap-1', isOverdue ? 'text-rose-600 font-medium' : 'text-muted-foreground')}>
          <Clock className="h-3 w-3 shrink-0" />
          {isOverdue ? 'Overdue · ' : 'Next: '}
          {format(nextAction, 'MMM d')}
          <button
            type="button"
            className="ml-auto text-[10px] underline"
            onClick={() => setShowDateForm(true)}
          >
            Update
          </button>
        </div>
      ) : showDateForm ? (
        <form onSubmit={handleDateSave} className="space-y-1">
          <Input
            type="datetime-local"
            value={nextActionValue}
            onChange={(e) => setNextActionValue(e.target.value)}
            className="h-7 text-xs"
            disabled={isSavingDate}
          />
          <div className="flex gap-1">
            <Button
              type="submit"
              size="sm"
              className="flex-1 h-6 text-xs"
              disabled={!nextActionValue || isSavingDate}
            >
              {isSavingDate && <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />}
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              onClick={() => setShowDateForm(false)}
              disabled={isSavingDate}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="text-[10px] text-muted-foreground underline"
          onClick={() => setShowDateForm(true)}
        >
          Set next action date
        </button>
      )}

      {/* Outcome buttons */}
      <OutcomeButtonsWidget
        leadId={id}
        toStage="supplement_dispute"
        config={{
          label: 'Resolution Outcome',
          outcomes: [
            { key: 'resolved_approved', label: 'Resolved — Approved',  toStage: 'claim_approved'      },
            { key: 'still_in_review',   label: 'Still in Review',      toStage: 'claim_review'        },
            { key: 'withdrawn',         label: 'Withdrawn by Owner',   toStage: 'archived_no_damage'  },
          ],
        }}
        onSuccess={onSuccess}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// contract_pending — auto-advance + wet-sign upload alternative
// ---------------------------------------------------------------------------

function ContractPendingWidget({
  inspection,
  onSuccess,
}: {
  inspection: PipelineInspection;
  onSuccess: () => void;
}) {
  const id = leadId(inspection);
  return (
    <div className="mt-2 space-y-2">
      <WaitingBadge label="Awaiting e-signature" />
      <p className="text-[10px] text-muted-foreground">Or upload a wet-signed contract:</p>
      <UploadWidget
        leadId={id}
        toStage="contract_signed"
        config={{ label: 'Upload Signed Contract' }}
        onSuccess={onSuccess}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// InsuranceCard — trigger-button → inline-expansion pattern (mirrors Retail)
// ---------------------------------------------------------------------------

function InsuranceCard({
  inspection,
  stage,
  onSuccess,
}: {
  inspection: PipelineInspection;
  stage: InsStage;
  onSuccess: () => void;
}) {
  const id = leadId(inspection);
  const hasPackage = (inspection.compiledReportVersions ?? []).length > 0;
  const [widgetOpen, setWidgetOpen] = useState(false);

  const daysInStage = inspection.stageEnteredAt
    ? differenceInDays(new Date(), new Date(inspection.stageEnteredAt))
    : inspection.updatedAt
    ? differenceInDays(new Date(), new Date(inspection.updatedAt))
    : null;

  const openWidget    = () => setWidgetOpen(true);
  const closeWidget   = () => setWidgetOpen(false);
  const handleAdvance = () => { setWidgetOpen(false); onSuccess(); };

  /**
   * Compact trigger shown in the card footer.
   * Only for stages that require data entry before advancing.
   * Hidden while the inline form is open.
   */
  function renderFooterTrigger(): ReactNode {
    if (widgetOpen) return null;
    switch (stage.key) {
      case 'pin_dropped':
        return (
          <button type="button" onClick={openWidget} className={COMPACT_BTN}>
            <UserPlus className="h-3 w-3 shrink-0" />Assign Rep
          </button>
        );
      case 'fipsa_signed':
        return (
          <button type="button" onClick={openWidget} className={COMPACT_BTN}>
            <Calendar className="h-3 w-3 shrink-0" />Schedule Phase 2
          </button>
        );
      case 'claim_filed':
        return (
          <button type="button" onClick={openWidget} className={COMPACT_BTN}>
            <FileText className="h-3 w-3 shrink-0" />Record Filing
          </button>
        );
      case 'claim_review':
        return (
          <button type="button" onClick={openWidget} className={COMPACT_BTN}>
            <ChevronRight className="h-3 w-3 shrink-0" />Log Outcome
          </button>
        );
      case 'contract_signed':
        return (
          <button type="button" onClick={openWidget} className={COMPACT_BTN}>
            <DollarSign className="h-3 w-3 shrink-0" />Collect Deposit
          </button>
        );
      case 'deposit_received':
        return (
          <button type="button" onClick={openWidget} className={COMPACT_BTN}>
            <UserPlus className="h-3 w-3 shrink-0" />Assign PM
          </button>
        );
      default:
        return null;
    }
  }

  /**
   * Inline expanded form — rendered above the footer when widgetOpen is true.
   * Widgets render in light-mode (no onClose passed); a wrapper X handles collapse.
   */
  function renderWidgetForm(): ReactNode {
    if (!widgetOpen) return null;
    switch (stage.key) {
      case 'pin_dropped':
        return (
          <AssignUserWidget
            leadId={id}
            toStage="phase1_scheduled"
            config={{ label: 'Assign Rep / Inspector' }}
            onSuccess={handleAdvance}
          />
        );
      case 'fipsa_signed':
        return (
          <DatetimeWidget
            leadId={id}
            toStage="phase2_scheduled"
            config={{ label: 'Schedule Phase 2 Inspection', setsNextAction: true }}
            onSuccess={handleAdvance}
          />
        );
      case 'claim_filed':
        return (
          <FieldsWidget
            leadId={id}
            toStage="claim_review"
            config={{
              label: "Record Homeowner's Claim Filing",
              fields: [
                { name: 'claimNumber', label: 'Claim Number', type: 'text' },
                { name: 'filingDate',  label: 'Filing Date',  type: 'date' },
              ],
            }}
            onSuccess={handleAdvance}
          />
        );
      case 'claim_review':
        return (
          <OutcomeButtonsWidget
            leadId={id}
            toStage="claim_review"
            config={{
              label: 'Review Outcome',
              outcomes: [
                { key: 'approved', label: 'Approved',          toStage: 'claim_approved'     },
                { key: 'partial',  label: 'Partial / Dispute', toStage: 'supplement_dispute' },
                { key: 'denied',   label: 'Denied',            toStage: 'supplement_dispute' },
              ],
            }}
            onSuccess={handleAdvance}
          />
        );
      case 'contract_signed':
        return (
          <MoneyConfirmWidget
            leadId={id}
            toStage="deposit_received"
            config={{ label: 'Collect Deposit', moneyField: 'depositAmount' }}
            onSuccess={handleAdvance}
          />
        );
      case 'deposit_received':
        return (
          <AssignUserWidget
            leadId={id}
            toStage="pm_handoff"
            config={{ label: 'Assign Project Manager' }}
            onSuccess={handleAdvance}
          />
        );
      default:
        return null;
    }
  }

  /**
   * Always-visible content: auto-advance waiting badges, navigation button-links,
   * and composite loop widgets. These are already button-like — no trigger needed.
   */
  function renderAlwaysVisible(): ReactNode {
    if (stage.isTerminal) {
      return (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
          <CheckCircle2 className="h-3 w-3 text-zinc-400" />
          No further action needed
        </div>
      );
    }
    if (stage.isAutoAdvance && stage.key !== 'contract_pending') {
      return <WaitingBadge label={stage.waitingLabel ?? 'Awaiting event'} />;
    }
    switch (stage.key) {
      case 'package_ready':
        return (
          <ButtonLinkWidget
            leadId={id}
            toStage="claim_filed"
            config={{ label: 'Send to Homeowner', href: '/leads/:leadId?tab=package' }}
            onSuccess={onSuccess}
          />
        );
      case 'claim_approved':
        return (
          <ButtonLinkWidget
            leadId={id}
            toStage="contract_pending"
            config={{ label: 'Generate Contract (PRSIA/CFR)', href: '/leads/:leadId?tab=contract' }}
            onSuccess={onSuccess}
          />
        );
      case 'contract_pending':
        return <ContractPendingWidget inspection={inspection} onSuccess={onSuccess} />;
      case 'supplement_dispute':
        return <SupplementDisputeWidget inspection={inspection} onSuccess={onSuccess} />;
      case 'phase2_complete':
        return (
          <div className="mt-2 space-y-1.5">
            <WaitingBadge label="Awaiting package" />
            <ButtonLinkWidget
              leadId={id}
              toStage="package_ready"
              config={{ label: 'Open Claim Hub', href: '/leads/:leadId?tab=claim' }}
              onSuccess={onSuccess}
            />
            <a
              href={`/axiomrestore-web/proof-packages?leadId=${id}`}
              className="block w-full text-center text-xs text-orange-400 hover:text-orange-300 underline underline-offset-2 py-0.5"
            >
              Open in Package Builder
            </a>
          </div>
        );
      default:
        return null;
    }
  }

  const footerTrigger = renderFooterTrigger();
  const widgetForm    = renderWidgetForm();
  const alwaysVisible = renderAlwaysVisible();

  return (
    <StageCard
      stageEnteredAt={inspection.stageEnteredAt ?? inspection.updatedAt}
      loopNextActionAt={inspection.loopNextActionAt}
      isLoopStage={stage.isLoopStage}
    >
      {/* Address */}
      <Link href={`/leads/${id}`}>
        <div className="flex items-start gap-1.5 cursor-pointer group">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <span className="text-xs font-medium leading-tight line-clamp-2 group-hover:underline">
            {inspection.address ?? 'Unknown address'}
          </span>
        </div>
      </Link>

      {/* Badges row */}
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        {hasPackage && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
            <Package className="h-2.5 w-2.5" />
            Package
          </span>
        )}
        {inspection.damageType && (
          <span className="text-[10px] text-muted-foreground">
            {formatDamageType(inspection.damageType)}
          </span>
        )}
      </div>

      {/* Inline expanded form (above footer, same as RetailCard) */}
      {widgetForm && (
        <div className="mt-2.5 pt-2 border-t border-border/40 relative">
          <button
            type="button"
            onClick={closeWidget}
            className="absolute top-0 right-0 p-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {widgetForm}
        </div>
      )}

      {/* Footer: rep name · days-in-stage · trigger button */}
      <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-border/40">
        <span className="text-[10px] text-muted-foreground truncate max-w-[90px]">
          {inspection.repName ?? <span className="italic opacity-50">No rep</span>}
        </span>
        <div className="flex items-center gap-1.5">
          {daysInStage !== null && daysInStage >= 1 && (
            <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <Clock className="h-2.5 w-2.5" />
              {daysInStage}d
            </div>
          )}
          {footerTrigger}
        </div>
      </div>

      {/* Always-visible widgets (waiting badges, nav buttons, composites) */}
      {alwaysVisible}
    </StageCard>
  );
}

// ---------------------------------------------------------------------------
// Sample Claim Card — pinned to "package_ready" stage
// ---------------------------------------------------------------------------

function SampleClaimCard() {
  return (
    <Link href="/sample-package">
      <div className="group relative rounded-xl border-2 border-dashed border-amber-400/60 bg-amber-50/40 dark:bg-amber-950/20 hover:bg-amber-50/70 dark:hover:bg-amber-950/30 p-3 cursor-pointer transition-all hover:shadow-md space-y-2 h-full">
        <div className="absolute -top-2.5 left-3">
          <span className="text-[9px] font-black tracking-widest px-2 py-0.5 rounded-full bg-amber-400 text-amber-900">
            SAMPLE
          </span>
        </div>
        <div className="flex items-start gap-2 mt-1">
          <MapPin className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
          <span className="text-xs font-medium leading-tight line-clamp-2 flex-1">
            1234 Maple Street, Springfield, IL 62704
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
            <Package className="h-2.5 w-2.5" />
            Package
          </span>
          <span className="text-[10px] text-muted-foreground">Hail</span>
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-amber-300/40">
          <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium truncate max-w-[110px]">
            Jordan Example
          </span>
          <span className="text-[10px] text-muted-foreground italic">demo</span>
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// AccordionSection
// ---------------------------------------------------------------------------

interface AccordionSectionProps {
  stage: InsStage;
  cards: PipelineInspection[];
  isLoading: boolean;
  open: boolean;
  onToggle: () => void;
  prefixSlot?: ReactNode;
  onCardSuccess: () => void;
}

function AccordionSection({
  stage,
  cards,
  isLoading,
  open,
  onToggle,
  prefixSlot,
  onCardSuccess,
}: AccordionSectionProps) {
  // supplement_dispute: sort by loopNextActionAt ascending (overdue first)
  const sortedCards = useMemo(() => {
    if (stage.key !== 'supplement_dispute') return cards;
    return [...cards].sort((a, b) => {
      const aDate = a.loopNextActionAt ? new Date(a.loopNextActionAt).getTime() : Infinity;
      const bDate = b.loopNextActionAt ? new Date(b.loopNextActionAt).getTime() : Infinity;
      return aDate - bDate;
    });
  }, [stage.key, cards]);

  const count = isLoading ? null : cards.length + (prefixSlot ? 1 : 0);

  return (
    <div className={cn('rounded-2xl border bg-card overflow-hidden border-l-4', stage.accent)}>
      {/* Header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-4 py-3.5 hover:bg-muted/20 transition-colors text-left"
      >
        <span className={cn('text-sm font-semibold flex-1', stage.textAccent)}>
          {stage.label}
          {stage.isLoopStage && (
            <span className="ml-1.5 text-[10px] font-normal text-muted-foreground/60">loop</span>
          )}
          {stage.isTerminal && (
            <span className="ml-1.5 text-[10px] font-normal text-muted-foreground/60">terminal</span>
          )}
        </span>
        <span className={cn('text-sm font-bold tabular-nums mr-1', stage.textAccent)}>
          {count ?? '—'}
        </span>
        {open
          ? <ChevronDown className="h-4 w-4 text-muted-foreground/60 shrink-0" />
          : <ChevronRight className="h-4 w-4 text-muted-foreground/60 shrink-0" />}
      </button>

      {/* Body */}
      {open && (
        <div className="px-4 pb-4 pt-2 border-t border-border/30 bg-muted/10">
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 pt-2">
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl opacity-70" />
              <Skeleton className="h-32 w-full rounded-xl opacity-40" />
            </div>
          ) : cards.length === 0 && !prefixSlot ? (
            <p className="text-xs text-muted-foreground/40 italic py-5 text-center">No leads in this stage</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 pt-2">
              {prefixSlot}
              {sortedCards.map((insp) => (
                <InsuranceCard
                  key={insp.id}
                  inspection={insp}
                  stage={stage}
                  onSuccess={onCardSuccess}
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

export default function InsurancePipeline() {
  const { data, isLoading, refetch } = useGetPipeline();
  const qc = useQueryClient();
  const inspections = data?.inspections ?? [];

  // Persist last-visited pipeline so the home redirect can resume here.
  useEffect(() => { localStorage.setItem('rt_last_pipeline', '/insurance-pipeline'); }, []);

  // Demo leads filter (persistent across page loads)
  const [hideDemos, setHideDemos] = useState(
    () => localStorage.getItem('rt_hide_demos') === 'true',
  );
  const visibleInspections = hideDemos ? inspections.filter((i) => !i.isDemo) : inspections;

  // Group by stage key (resolved from pin stageKey or legacy status)
  const grouped = useMemo(() => {
    const map = new Map<string, PipelineInspection[]>();
    for (const stage of INS_STAGES) map.set(stage.key, []);

    for (const insp of visibleInspections) {
      const key = resolveStageKey(insp);
      if (key && map.has(key)) {
        map.get(key)!.push(insp);
      }
    }
    return map;
  }, [visibleInspections]);

  // Default: all stages open
  const [openStages, setOpenStages] = useState<Set<string>>(
    () => new Set(INS_STAGES.map((s) => s.key)),
  );

  const toggle = (key: string) =>
    setOpenStages((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // After any card action, refresh the pipeline board
  function handleCardSuccess() {
    qc.invalidateQueries({ queryKey: getPipelineQueryKey() });
  }

  const demoCount  = inspections.filter((i) => i.isDemo).length;
  const totalLeads = visibleInspections.filter((i) => resolveStageKey(i) !== null).length;

  return (
    <Shell>
      <div className="space-y-4 max-w-6xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Insurance Pipeline</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Insurance restoration leads from inspection through project handoff.
            </p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">
              {isLoading ? 'Loading…' : `${totalLeads} lead${totalLeads !== 1 ? 's' : ''} across all stages`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {/* Hide demo toggle */}
            {demoCount > 0 && (
              <>
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
                <span className="text-muted-foreground/30 text-xs">·</span>
              </>
            )}
            <button
              type="button"
              onClick={() => refetch()}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
            <span className="text-muted-foreground/30 text-xs">·</span>
            <button
              type="button"
              onClick={() => setOpenStages(new Set(INS_STAGES.map((s) => s.key)))}
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

        {/* Accordion */}
        <div className="space-y-2">
          {INS_STAGES.map((stage) => (
            <AccordionSection
              key={stage.key}
              stage={stage}
              cards={grouped.get(stage.key) ?? []}
              isLoading={isLoading}
              open={openStages.has(stage.key)}
              onToggle={() => toggle(stage.key)}
              prefixSlot={stage.key === 'package_ready' ? <SampleClaimCard key="__sample" /> : undefined}
              onCardSuccess={handleCardSuccess}
            />
          ))}
        </div>
      </div>
    </Shell>
  );
}
