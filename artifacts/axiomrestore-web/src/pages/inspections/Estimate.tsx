/**
 * Standalone Estimate page (kept for backward-compat with /inspections/:id/estimate).
 * Core content lives in EstimatePanel, reused by the ClaimHub Estimate tab.
 */
import { useParams, Link } from "wouter";
import { useGetInspection, getGetInspectionQueryKey } from "@workspace/api-client-react";
import { Shell } from "@/components/layout/Shell";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft } from "lucide-react";
import { EstimatePanel } from "./EstimatePanel";

export default function Estimate() {
  const { id } = useParams<{ id: string }>();

  const { data: inspectionEnv, isLoading } = useGetInspection(id, {
    query: { enabled: !!id, queryKey: getGetInspectionQueryKey(id) },
  });

  if (isLoading) {
    return (
      <Shell>
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Shell>
    );
  }

  const inspection = inspectionEnv?.inspection;
  if (!inspection) return <Shell><div className="text-sm text-muted-foreground">Inspection not found.</div></Shell>;

  return (
    <Shell>
      <div className="mb-6">
        <Link href={`/inspections/${id}`} className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-1 mb-4 w-fit">
          <ArrowLeft className="h-4 w-4" /> Back to Claim
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Estimate Builder</h1>
        <p className="text-muted-foreground">{inspection.address}</p>
      </div>
      <EstimatePanel inspectionId={id} />
    </Shell>
  );
}
