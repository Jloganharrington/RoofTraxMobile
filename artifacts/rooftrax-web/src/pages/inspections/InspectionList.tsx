/**
 * /inspections — legacy entry point, superseded by the pipeline boards and
 * unified Leads list. Transparently redirects so old bookmarks still work.
 */
import { useEffect } from "react";
import { useLocation } from "wouter";
import { Shell } from "@/components/layout/Shell";
import { Loader2 } from "lucide-react";

export default function InspectionList() {
  const [, navigate] = useLocation();

  useEffect(() => {
    navigate("/leads", { replace: true });
  }, [navigate]);

  return (
    <Shell>
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    </Shell>
  );
}
