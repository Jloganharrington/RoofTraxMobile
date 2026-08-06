import { useCallback, useRef, useState } from 'react';
import { LayoutGrid, Check, Loader2 } from 'lucide-react';
import { useGetDashboardManifest, usePatchDashboardLayout } from '@workspace/api-client-react';
import { Shell } from '@/components/layout/Shell';
import { DashboardGrid, type GridCell } from '@/components/dashboard/DashboardGrid';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

// Skeleton shown while the manifest loads.
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
  const { data, isLoading, isError, refetch } = useGetDashboardManifest();
  const patchLayout = usePatchDashboardLayout();

  // Tracks draft positions while the user is in edit mode.
  // Null = no unsaved changes yet (use server's gridLayout).
  const [draftLayout, setDraftLayout] = useState<GridCell[] | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);

  // We keep a ref so the "Done" handler always sees the latest draft.
  const draftRef = useRef<GridCell[] | null>(null);
  draftRef.current = draftLayout;

  const handleLayoutChange = useCallback((cells: GridCell[]) => {
    setDraftLayout(cells);
  }, []);

  const enterEditMode = () => {
    setDraftLayout(null); // reset draft — start from server's current positions
    setEditMode(true);
  };

  const saveAndExit = async () => {
    setSaving(true);
    try {
      const layoutToSave = draftRef.current;
      if (layoutToSave) {
        await patchLayout.mutateAsync({
          data: { gridLayout: layoutToSave },
        });
        await refetch();
      }
    } finally {
      setSaving(false);
      setEditMode(false);
      setDraftLayout(null);
    }
  };

  // The server's stored grid layout (may be null = not yet customised).
  // data.gridLayout is GridCellEntry[] from the generated type, structurally
  // identical to GridCell — safe to treat as the same type.
  const serverGridLayout = (data?.gridLayout ?? null) as GridCell[] | null;

  // While in edit mode show draft; once exiting revert to server's layout.
  const activeGridLayout = editMode
    ? (draftLayout ?? serverGridLayout)
    : serverGridLayout;

  return (
    <Shell>
      <div className="pb-8">
        {/* Page header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1
              className="text-2xl font-black uppercase tracking-wide text-foreground"
              style={{ fontFamily: 'var(--app-font-condensed)' }}
            >
              Dashboard
            </h1>
            <p className="text-xs text-muted-foreground mt-1 uppercase tracking-widest font-semibold">
              {editMode ? 'Drag to rearrange · resize from corner' : 'Command center'}
            </p>
          </div>

          {/* Edit layout toggle — hidden while loading / errored */}
          {data && (
            <div className="flex-shrink-0">
              {editMode ? (
                <Button
                  size="sm"
                  onClick={saveAndExit}
                  disabled={saving}
                  className="gap-1.5"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  {saving ? 'Saving…' : 'Done'}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={enterEditMode}
                  className="gap-1.5"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Edit Layout
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Loading */}
        {isLoading && <ManifestSkeleton />}

        {/* Error */}
        {isError && (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-muted-foreground">
            <AlertTriangle className="h-5 w-5" />
            <p className="text-sm">Could not load dashboard — please refresh.</p>
          </div>
        )}

        {/* Grid */}
        {data && (
          <DashboardGrid
            widgets={data.widgets}
            gridLayout={activeGridLayout}
            editMode={editMode}
            onLayoutChange={handleLayoutChange}
          />
        )}
      </div>
    </Shell>
  );
}
