import { useGetDashboardManifest } from '@workspace/api-client-react';
import { Shell } from '@/components/layout/Shell';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle } from 'lucide-react';

// Skeleton displayed while the manifest is loading. Shows a plausible layout
// so the page doesn't flicker to blank then jump to content.
function ManifestSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-4">
      <div className="col-span-4 sm:col-span-2 lg:col-span-1">
        <Skeleton className="h-36 w-full rounded-lg" />
      </div>
      <div className="col-span-4 lg:col-span-2">
        <Skeleton className="h-44 w-full rounded-lg" />
      </div>
      <div className="col-span-4 lg:col-span-2">
        <Skeleton className="h-44 w-full rounded-lg" />
      </div>
      <div className="col-span-4">
        <Skeleton className="h-56 w-full rounded-lg" />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data, isLoading, isError } = useGetDashboardManifest();

  return (
    <Shell>
      <div className="pb-8">
        {/* Page header */}
        <div className="mb-6">
          <h1
            className="text-2xl font-black uppercase tracking-wide text-foreground"
            style={{ fontFamily: 'var(--app-font-condensed)' }}
          >
            Dashboard
          </h1>
          <p className="text-xs text-muted-foreground mt-1 uppercase tracking-widest font-semibold">
            Command center
          </p>
        </div>

        {/* Manifest loading */}
        {isLoading && <ManifestSkeleton />}

        {/* Manifest error */}
        {isError && (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-muted-foreground">
            <AlertTriangle className="h-5 w-5" />
            <p className="text-sm">Could not load dashboard — please refresh.</p>
          </div>
        )}

        {/* Grid — rendered only after manifest resolves */}
        {data && <DashboardGrid widgets={data.widgets} />}
      </div>
    </Shell>
  );
}
