/**
 * Pipeline — Kanban view of all claims (inspections) grouped by lifecycle stage.
 * Package status is a first-class attribute on each card.
 */
import { useMemo } from "react";
import { Link } from "wouter";
import { Shell } from "@/components/layout/Shell";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { differenceInDays } from "date-fns";
import { Package, Clock, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetPipeline, type PipelineInspection } from "@/lib/claimHubApi";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type InspectionStatus = 'scheduled' | 'capturing' | 'validating' | 'submitted' | 'package_ready';

const STAGES: { status: InspectionStatus; label: string; description: string }[] = [
  { status: 'scheduled', label: 'Scheduled', description: 'Not yet in the field' },
  { status: 'capturing', label: 'Capturing', description: 'Field work in progress' },
  { status: 'validating', label: 'In Review', description: 'Office review & AI generation' },
  { status: 'submitted', label: 'Submitted', description: 'Package submitted to adjuster' },
  { status: 'package_ready', label: 'Package Ready', description: 'Compiled & ready to deliver' },
];

type PackageStatus = 'none' | 'drafting' | 'in_review' | 'compiled' | 'delivered';

function derivePackageStatus(inspection: PipelineInspection): PackageStatus {
  const versions = inspection.compiledReportVersions ?? [];
  if (versions.length > 0) return 'compiled';
  if (inspection.status === 'validating') return 'drafting';
  return 'none';
}

const PACKAGE_BADGE: Record<PackageStatus, { label: string; className: string }> = {
  none:      { label: 'No Package',  className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
  drafting:  { label: 'Drafting',    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
  in_review: { label: 'In Review',   className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' },
  compiled:  { label: 'Compiled',    className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  delivered: { label: 'Delivered',   className: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' },
};

function formatDamageType(dt: string | null | undefined): string {
  if (!dt) return '';
  return dt.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Card component
// ---------------------------------------------------------------------------

function ClaimCard({ inspection }: { inspection: PipelineInspection }) {
  const pkg = derivePackageStatus(inspection);
  const badge = PACKAGE_BADGE[pkg];
  const daysInStage = inspection.updatedAt
    ? differenceInDays(new Date(), new Date(inspection.updatedAt as string))
    : null;

  return (
    <Link href={`/inspections/${inspection.id}`}>
      <div className="group rounded-lg border bg-card hover:bg-card/80 p-3 cursor-pointer transition-all hover:shadow-sm space-y-2.5">
        {/* Address */}
        <div className="flex items-start gap-2">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <span className="text-xs font-medium leading-tight line-clamp-2 flex-1">
            {inspection.address ?? 'Unknown address'}
          </span>
        </div>

        {/* Package status */}
        <div className="flex items-center gap-1.5">
          <Package className="h-3 w-3 text-muted-foreground" />
          <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded', badge.className)}>
            {badge.label}
          </span>
        </div>

        {/* Damage types */}
        {inspection.damageType && (
          <div className="text-[10px] text-muted-foreground">
            {formatDamageType(inspection.damageType)}
          </div>
        )}

        {/* Footer: rep + days in stage */}
        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          {inspection.repName ? (
            <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">
              {inspection.repName}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground/40 italic">No rep</span>
          )}
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
// Main page
// ---------------------------------------------------------------------------

export default function Pipeline() {
  const { data, isLoading } = useGetPipeline();

  const inspections = data?.inspections ?? [];

  const grouped = useMemo(() => {
    const map = new Map<InspectionStatus, PipelineInspection[]>();
    for (const s of STAGES) map.set(s.status, []);
    for (const insp of inspections) {
      const bucket = map.get(insp.status as InspectionStatus);
      if (bucket) bucket.push(insp);
    }
    return map;
  }, [inspections]);

  return (
    <Shell>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            {inspections.length} claim{inspections.length !== 1 ? 's' : ''} across all stages
          </p>
        </div>

        {/* Kanban board */}
        <div className="flex gap-4 overflow-x-auto pb-4 min-h-[60vh]">
          {STAGES.map((stage) => {
            const cards = grouped.get(stage.status) ?? [];
            return (
              <div
                key={stage.status}
                className="flex-shrink-0 w-64 flex flex-col"
              >
                {/* Column header */}
                <div className="mb-2 px-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-widest text-foreground">
                      {stage.label}
                    </span>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                      {isLoading ? '—' : cards.length}
                    </Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{stage.description}</p>
                </div>

                {/* Column body */}
                <div className="flex-1 bg-muted/30 rounded-lg p-2 space-y-2 min-h-32">
                  {isLoading ? (
                    <>
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-20 w-full opacity-60" />
                    </>
                  ) : cards.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-20 text-center">
                      <p className="text-[10px] text-muted-foreground/50">Empty</p>
                    </div>
                  ) : (
                    cards.map((insp) => (
                      <ClaimCard key={insp.id} inspection={insp} />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
