/**
 * Insurance Pipeline — Kanban accordion view.
 * Each stage is a collapsible section; cards are laid out in a responsive grid inside.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Shell } from "@/components/layout/Shell";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { differenceInDays } from "date-fns";
import { ChevronDown, ChevronRight, MapPin, Clock, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetPipeline, type PipelineInspection } from "@/lib/claimHubApi";

// ---------------------------------------------------------------------------
// Stage definitions — maps DB status values to insurance pipeline stages
// ---------------------------------------------------------------------------

interface InsStage {
  key: string;
  label: string;
  statuses: string[];   // DB status values that fall into this stage
  accent: string;       // Tailwind border-color class
}

const INS_STAGES: InsStage[] = [
  { key: 'pin_dropped',             label: 'Pin Dropped',                   statuses: [],                              accent: 'border-slate-400' },
  { key: 'phase1_scheduled',        label: 'Phase 1 Inspection Scheduled',  statuses: ['scheduled'],                   accent: 'border-blue-400' },
  { key: 'fipsa_signed',            label: 'FIPSA Signed',                  statuses: [],                              accent: 'border-indigo-400' },
  { key: 'phase2_scheduled',        label: 'Phase 2 Inspection Scheduled',  statuses: [],                              accent: 'border-violet-400' },
  { key: 'phase2_complete',         label: 'Phase 2 Inspection Complete',   statuses: ['capturing'],                   accent: 'border-amber-400' },
  { key: 'proof_package_generated', label: 'Proof Package Generated',       statuses: ['validating', 'package_ready'], accent: 'border-orange-400' },
  { key: 'claim_filed',             label: 'Claim Filed w/ Proof Package',  statuses: ['submitted'],                   accent: 'border-emerald-400' },
  { key: 'claim_review',            label: 'Claim Review',                  statuses: [],                              accent: 'border-rose-400' },
  { key: 'claim_approved',          label: 'Claim Approved',                statuses: [],                              accent: 'border-green-400' },
  { key: 'contract_pending',        label: 'Contract Pending',              statuses: [],                              accent: 'border-teal-400' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDamageType(dt: string | null | undefined): string {
  if (!dt) return '';
  return dt.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Claim card
// ---------------------------------------------------------------------------

function ClaimCard({ inspection }: { inspection: PipelineInspection }) {
  const daysInStage = inspection.updatedAt
    ? differenceInDays(new Date(), new Date(inspection.updatedAt as string))
    : null;
  const hasPackage = (inspection.compiledReportVersions ?? []).length > 0;

  return (
    <Link href={`/inspections/${inspection.id}`}>
      <div className="group rounded-lg border bg-card hover:bg-card/80 p-3 cursor-pointer transition-all hover:shadow-sm space-y-2 h-full">
        {/* Address */}
        <div className="flex items-start gap-2">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <span className="text-xs font-medium leading-tight line-clamp-2 flex-1">
            {inspection.address ?? 'Unknown address'}
          </span>
        </div>

        {/* Package + damage */}
        <div className="flex flex-wrap items-center gap-1.5">
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

        {/* Footer */}
        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          <span className="text-[10px] text-muted-foreground truncate max-w-[110px]">
            {inspection.repName ?? <span className="italic opacity-50">No rep</span>}
          </span>
          {daysInStage !== null && (
            <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <Clock className="h-2.5 w-2.5" />
              {daysInStage === 0 ? 'today' : `${daysInStage}d`}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Accordion section
// ---------------------------------------------------------------------------

interface AccordionSectionProps {
  stage: InsStage;
  stageNumber: number;
  cards: PipelineInspection[];
  isLoading: boolean;
  open: boolean;
  onToggle: () => void;
}

function AccordionSection({ stage, stageNumber, cards, isLoading, open, onToggle }: AccordionSectionProps) {
  return (
    <div className={cn("rounded-lg border bg-card overflow-hidden border-l-[3px]", stage.accent)}>
      {/* Header — always visible */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        {/* Stage number */}
        <span className="text-[10px] font-bold text-muted-foreground/50 w-4 shrink-0 tabular-nums">
          {stageNumber}
        </span>

        {/* Chevron */}
        {open
          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        }

        {/* Label */}
        <span className="flex-1 text-sm font-semibold">{stage.label}</span>

        {/* Count badge */}
        <Badge
          variant="secondary"
          className={cn(
            "text-[10px] h-5 px-2 shrink-0",
            cards.length > 0 ? "bg-primary/10 text-primary" : "text-muted-foreground"
          )}
        >
          {isLoading ? '—' : cards.length}
        </Badge>
      </button>

      {/* Expandable body */}
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-border/50">
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 pt-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full opacity-70" />
              <Skeleton className="h-24 w-full opacity-40" />
            </div>
          ) : cards.length === 0 ? (
            <p className="text-xs text-muted-foreground/50 italic py-4 text-center">No claims in this stage</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 pt-3">
              {cards.map((insp) => (
                <ClaimCard key={insp.id} inspection={insp} />
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
  const { data, isLoading } = useGetPipeline();
  const inspections = data?.inspections ?? [];

  // Build a lookup: DB status → stage key
  const statusToStageKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const stage of INS_STAGES) {
      for (const s of stage.statuses) map.set(s, stage.key);
    }
    return map;
  }, []);

  // Group inspections into stages
  const grouped = useMemo(() => {
    const map = new Map<string, PipelineInspection[]>();
    for (const stage of INS_STAGES) map.set(stage.key, []);
    for (const insp of inspections) {
      const stageKey = statusToStageKey.get(insp.status) ?? null;
      if (stageKey) map.get(stageKey)?.push(insp);
    }
    return map;
  }, [inspections, statusToStageKey]);

  // Default: open all stages that have items; collapse empty ones
  const [openStages, setOpenStages] = useState<Set<string>>(() => {
    // We don't have data yet at init time, so start with all open
    return new Set(INS_STAGES.map((s) => s.key));
  });

  const toggle = (key: string) => {
    setOpenStages((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalClaims = inspections.length;

  return (
    <Shell>
      <div className="space-y-4 max-w-6xl">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Insurance Pipeline</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isLoading ? 'Loading…' : `${totalClaims} claim${totalClaims !== 1 ? 's' : ''} across all stages`}
            </p>
          </div>
          <div className="flex gap-2">
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
          {INS_STAGES.map((stage, idx) => (
            <AccordionSection
              key={stage.key}
              stage={stage}
              stageNumber={idx + 1}
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
