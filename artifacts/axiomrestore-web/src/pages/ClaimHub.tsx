/**
 * ClaimHub — legacy inspection view.
 *
 * This page has been superseded by the unified Lead Profile at /leads/:pinId.
 * Any old bookmark or link to /inspections/:id is transparently redirected
 * to the correct lead profile so nothing breaks for reps in the field.
 */
import { useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useGetInspection, getGetInspectionQueryKey } from "@workspace/api-client-react";
import { Shell } from "@/components/layout/Shell";
import { Loader2 } from "lucide-react";

export default function ClaimHub() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();

  const { data: env, error } = useGetInspection(id!, {
    query: { enabled: !!id, queryKey: getGetInspectionQueryKey(id!) },
  });

  useEffect(() => {
    if (!env) return;

    // The inspection response includes pinId when one has been assigned.
    // Fall back to the ins- prefix form which the leads API also resolves.
    const inspection = (env as unknown as { inspection?: { pinId?: string | null; id?: string } })
      ?.inspection;
    const dest = inspection?.pinId
      ? `/leads/${inspection.pinId}`
      : `/leads/ins-${inspection?.id ?? id}`;

    navigate(dest, { replace: true });
  }, [env, id, navigate]);

  if (error) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center py-32 gap-3 text-muted-foreground">
          <p className="text-sm">Inspection not found or you don&apos;t have access.</p>
          <button
            type="button"
            className="text-xs underline"
            onClick={() => navigate("/leads")}
          >
            Go to Leads
          </button>
        </div>
      </Shell>
    );
  }

  // Loading / redirecting spinner
  return (
    <Shell>
      <div className="flex flex-col items-center justify-center py-32 gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin opacity-40" />
        <p className="text-sm">Opening lead profile…</p>
      </div>
    </Shell>
  );
}
