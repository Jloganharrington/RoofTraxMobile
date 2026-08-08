import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, SlidersHorizontal, LayoutGrid, Bookmark } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetDashboardManifest,
  usePatchDashboardLayout,
  useGetCurrentAuthUser,
  getGetDashboardManifestQueryKey,
  getGetDashboardLayoutQueryKey,
} from '@workspace/api-client-react';
import type { GridCellEntry } from '@workspace/api-client-react';
import { Shell } from '@/components/layout/Shell';
import { DashboardGrid, type GridCell } from '@/components/dashboard/DashboardGrid';
import { ManageWidgetsModal } from '@/components/dashboard/ManageWidgetsModal';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { loadSavedSlots, type SavedLayout } from '@/lib/dashboardLayouts';

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
  const { data: authEnvelope } = useGetCurrentAuthUser();
  const patchLayout = usePatchDashboardLayout();
  const qc = useQueryClient();
  const { toast } = useToast();

  const userId = authEnvelope?.user?.id ?? '';

  // Tracks draft positions while the user is in edit mode.
  const [draftLayout, setDraftLayout] = useState<GridCell[] | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applyingSlot, setApplyingSlot] = useState<string | null>(null);

  // Saved layout slots — shown as quick-toggle buttons in the header.
  const [slots, setSlots] = useState<(SavedLayout | null)[]>([null, null, null]);

  // Load slots from localStorage once userId is known, and whenever it changes.
  useEffect(() => {
    if (userId) setSlots(loadSavedSlots(userId));
  }, [userId]);

  // Keep a ref so "Done" always sees the latest draft.
  const draftRef = useRef<GridCell[] | null>(null);
  draftRef.current = draftLayout;

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: getGetDashboardManifestQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardLayoutQueryKey() });
  }, [qc]);

  const handleLayoutChange = useCallback((cells: GridCell[]) => {
    setDraftLayout(cells);
  }, []);

  // Enter edit mode only (no modal) — for drag/resize only.
  const enterEditMode = () => {
    setDraftLayout(null);
    setEditMode(true);
  };

  // Open modal + enter edit mode.
  const openManageWidgets = () => {
    setDraftLayout(null);
    setEditMode(true);
    setManageOpen(true);
  };

  // Save current drag/resize positions and exit edit mode.
  const saveAndExit = async () => {
    setSaving(true);
    try {
      const layoutToSave = draftRef.current;
      if (layoutToSave) {
        await patchLayout.mutateAsync({ data: { gridLayout: layoutToSave } });
        await refetch();
      }
    } finally {
      setSaving(false);
      setEditMode(false);
      setDraftLayout(null);
    }
  };

  // Apply a saved layout from a quick-toggle button.
  const handleApplySavedLayout = async (layout: SavedLayout) => {
    setApplyingSlot(layout.name);
    try {
      await patchLayout.mutateAsync({
        data: {
          order: layout.order,
          hidden: layout.hidden,
          // GridCell and GridCellEntry are structurally identical — safe cast.
          gridLayout: (layout.gridLayout as GridCellEntry[] | null) ?? null,
        },
      });
      invalidate();
      await refetch();
      // Update draft so the grid reflects the loaded positions immediately.
      setDraftLayout(layout.gridLayout);
      toast({ title: `"${layout.name}" applied` });
    } catch {
      toast({ title: 'Failed to apply layout', variant: 'destructive' });
    } finally {
      setApplyingSlot(null);
    }
  };

  // Called when ManageWidgetsModal loads a saved layout.
  const handleGridLayoutApplied = useCallback((grid: GridCell[] | null) => {
    setDraftLayout(grid);
    if (!grid) setEditMode(false);
  }, []);

  // Called when the modal saves or deletes a slot.
  const handleSlotsChange = useCallback((updated: (SavedLayout | null)[]) => {
    setSlots(updated);
  }, []);

  // The server's stored grid layout.
  const serverGridLayout = (data?.gridLayout ?? null) as GridCell[] | null;

  // In edit mode show draft; otherwise use server layout.
  const activeGridLayout = editMode
    ? (draftLayout ?? serverGridLayout)
    : serverGridLayout;

  // What's passed to modal for saving (draft takes priority over server).
  const currentGridLayout = draftLayout ?? serverGridLayout;

  // Named slots that have been saved.
  const filledSlots = slots.filter((s): s is SavedLayout => s !== null);

  return (
    <Shell>
      <div className="pb-8">
        {/* ── Page header ─────────────────────────────────────────────── */}
        <div className="mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
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

            {data && (
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {/* ── Saved layout quick-toggle buttons ─────────────── */}
                {filledSlots.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    {filledSlots.map((layout) => {
                      const isApplying = applyingSlot === layout.name;
                      return (
                        <Button
                          key={layout.name}
                          size="sm"
                          variant="ghost"
                          onClick={() => handleApplySavedLayout(layout)}
                          disabled={!!applyingSlot || saving}
                          className="h-7 px-2.5 text-xs gap-1.5 text-muted-foreground hover:text-foreground border border-border/60 hover:border-border"
                        >
                          {isApplying ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Bookmark className="h-3 w-3" />
                          )}
                          {layout.name}
                        </Button>
                      );
                    })}
                  </div>
                )}

                {/* ── Divider when slots exist ───────────────────────── */}
                {filledSlots.length > 0 && (
                  <div className="w-px h-5 bg-border/60 flex-shrink-0" />
                )}

                {/* ── Done (edit mode only) ──────────────────────────── */}
                {editMode && (
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
                )}

                {/* ── Edit Layout (not in edit mode) ────────────────── */}
                {!editMode && (
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

                {/* ── Manage Widgets ─────────────────────────────────── */}
                <Button
                  size="sm"
                  variant={editMode ? 'secondary' : 'outline'}
                  onClick={openManageWidgets}
                  className="gap-1.5"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Manage Widgets
                </Button>
              </div>
            )}
          </div>
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

      {/* Manage Widgets modal */}
      <ManageWidgetsModal
        open={manageOpen}
        onOpenChange={(open) => {
          setManageOpen(open);
          // Modal closed without applying — keep edit mode for drag/resize.
        }}
        userId={userId}
        currentGridLayout={currentGridLayout}
        onGridLayoutApplied={handleGridLayoutApplied}
        onSlotsChange={handleSlotsChange}
      />
    </Shell>
  );
}
