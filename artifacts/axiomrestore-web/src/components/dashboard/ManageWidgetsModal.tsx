import { useState, useEffect, useCallback } from 'react';
import { Reorder } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import {
  GripVertical, Eye, EyeOff, Loader2,
  BookmarkPlus, Trash2, Check,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import {
  useGetDashboardLayout,
  usePatchDashboardLayout,
  useDeleteDashboardLayout,
  getGetDashboardManifestQueryKey,
  getGetDashboardLayoutQueryKey,
} from '@workspace/api-client-react';
import type { GridCellEntry } from '@workspace/api-client-react';
import type { GridCell } from './DashboardGrid';
import {
  loadSavedSlots,
  persistSavedSlots,
  type SavedLayout,
} from '@/lib/dashboardLayouts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WidgetRow {
  key: string;
  title: string;
  visible: boolean;
}

export interface ManageWidgetsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Scopes saved layouts per user in localStorage. */
  userId: string;
  /** Current grid positions — captured when saving a named layout. */
  currentGridLayout: GridCell[] | null;
  /** Called when a saved layout is loaded so the parent can update positions. */
  onGridLayoutApplied: (grid: GridCell[] | null) => void;
  /** Called whenever slots are saved or deleted — lets the parent re-render quick-toggle buttons. */
  onSlotsChange: (slots: (SavedLayout | null)[]) => void;
}

// ---------------------------------------------------------------------------
// ManageWidgetsModal
// ---------------------------------------------------------------------------

export function ManageWidgetsModal({
  open,
  onOpenChange,
  userId,
  currentGridLayout,
  onGridLayoutApplied,
  onSlotsChange,
}: ManageWidgetsModalProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: layoutData, isLoading } = useGetDashboardLayout();
  const patchMutation = usePatchDashboardLayout();
  const deleteMutation = useDeleteDashboardLayout();

  const [rows, setRows] = useState<WidgetRow[]>([]);
  const [dirty, setDirty] = useState(false);
  // Incrementing this forces a row re-init from fresh layoutData
  const [initGen, setInitGen] = useState(0);

  const [slots, setSlots] = useState<(SavedLayout | null)[]>([null, null, null]);
  const [savingSlot, setSavingSlot] = useState<number | null>(null);
  const [slotName, setSlotName] = useState('');

  // Re-init rows whenever data arrives or initGen bumps
  useEffect(() => {
    if (!layoutData) return;
    setRows(
      layoutData.widgets.map((w) => ({
        key: w.key,
        title: w.title,
        visible: !w.hidden,
      })),
    );
    setDirty(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutData, initGen]);

  // On open: force fresh rows + reload slots from localStorage
  useEffect(() => {
    if (open) {
      setInitGen((g) => g + 1);
      setSlots(loadSavedSlots(userId));
    } else {
      setSavingSlot(null);
      setSlotName('');
    }
  }, [open, userId]);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: getGetDashboardManifestQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardLayoutQueryKey() });
  }, [qc]);

  // ── Widget list actions ────────────────────────────────────────────────────

  const toggleVisible = (idx: number) => {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, visible: !r.visible } : r)),
    );
    setDirty(true);
  };

  const handleApply = () => {
    const order = rows.map((r) => r.key);
    const hidden = rows.filter((r) => !r.visible).map((r) => r.key);
    patchMutation.mutate(
      { data: { order, hidden } },
      {
        onSuccess: () => {
          invalidate();
          setDirty(false);
          toast({ title: 'Dashboard updated' });
          onOpenChange(false);
        },
        onError: () =>
          toast({ title: 'Failed to apply changes', variant: 'destructive' }),
      },
    );
  };

  const handleRestoreDefaults = () => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        invalidate();
        setInitGen((g) => g + 1);
        setDirty(false);
        onGridLayoutApplied(null);
        toast({ title: 'Dashboard reset to defaults' });
      },
      onError: () =>
        toast({ title: 'Failed to reset', variant: 'destructive' }),
    });
  };

  // ── Saved layout actions ───────────────────────────────────────────────────

  const updateSlots = (updated: (SavedLayout | null)[]) => {
    setSlots(updated);
    persistSavedSlots(userId, updated);
    onSlotsChange(updated);
  };

  const handleSaveToSlot = (idx: number) => {
    const name = slotName.trim() || `Layout ${idx + 1}`;
    const layout: SavedLayout = {
      name,
      hidden: rows.filter((r) => !r.visible).map((r) => r.key),
      order: rows.map((r) => r.key),
      gridLayout: currentGridLayout,
      savedAt: new Date().toISOString(),
    };
    const updated = [...slots];
    updated[idx] = layout;
    updateSlots(updated);
    setSavingSlot(null);
    setSlotName('');
    toast({ title: `Saved as "${name}"` });
  };

  const handleLoadSlot = (layout: SavedLayout) => {
    const { order, hidden, gridLayout } = layout;
    patchMutation.mutate(
      {
        data: {
          order,
          hidden,
          gridLayout: (gridLayout as GridCellEntry[] | null) ?? null,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          onGridLayoutApplied(gridLayout);
          setInitGen((g) => g + 1);
          setDirty(false);
          toast({ title: `"${layout.name}" applied` });
          onOpenChange(false);
        },
        onError: () =>
          toast({ title: 'Failed to load layout', variant: 'destructive' }),
      },
    );
  };

  const handleDeleteSlot = (idx: number) => {
    const updated = [...slots];
    updated[idx] = null;
    updateSlots(updated);
  };

  const applying = patchMutation.isPending;
  const resetting = deleteMutation.isPending;
  const busy = applying || resetting;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px] max-h-[90vh] overflow-y-auto gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-4 border-b">
          <DialogTitle className="text-base font-bold">Manage Widgets</DialogTitle>
        </DialogHeader>

        <div className="px-5 py-4 space-y-5">

          {/* ── Widget Visibility & Order ────────────────────────────── */}
          <section className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Widget Visibility &amp; Order
            </p>
            <p className="text-[11px] text-muted-foreground/70 -mt-1">
              Drag to reorder · eye icon to show/hide
            </p>

            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-md" />
                ))}
              </div>
            ) : (
              <Reorder.Group
                axis="y"
                values={rows}
                onReorder={(next) => { setRows(next); setDirty(true); }}
                className="space-y-1.5"
              >
                {rows.map((row, idx) => (
                  <Reorder.Item
                    key={row.key}
                    value={row}
                    className={`flex items-center gap-2.5 rounded-md border px-3 py-2 select-none transition-opacity ${
                      row.visible ? 'bg-background' : 'opacity-50 bg-muted/30'
                    }`}
                  >
                    <span
                      className="cursor-grab active:cursor-grabbing touch-none text-muted-foreground"
                      aria-hidden
                    >
                      <GripVertical className="h-4 w-4" />
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleVisible(idx)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      aria-label={row.visible ? `Hide ${row.title}` : `Show ${row.title}`}
                    >
                      {row.visible ? (
                        <Eye className="h-4 w-4" />
                      ) : (
                        <EyeOff className="h-4 w-4" />
                      )}
                    </button>
                    <span className="flex-1 text-sm font-medium">{row.title}</span>
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            )}

            <div className="flex items-center justify-between pt-0.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRestoreDefaults}
                disabled={busy}
                className="text-muted-foreground text-xs h-7 px-2"
              >
                {resetting ? (
                  <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Resetting…</>
                ) : (
                  'Restore defaults'
                )}
              </Button>
              <Button
                size="sm"
                onClick={handleApply}
                disabled={!dirty || busy}
                className="h-7 text-xs"
              >
                {applying ? (
                  <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Applying…</>
                ) : (
                  'Apply Changes'
                )}
              </Button>
            </div>
          </section>

          <Separator />

          {/* ── Saved Layouts ────────────────────────────────────────── */}
          <section className="space-y-3 pb-1">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">
                Saved Layouts
              </p>
              <p className="text-[11px] text-muted-foreground/70">
                Save up to 3 named layouts — captures visibility, order, and widget positions.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {([0, 1, 2] as const).map((idx) => {
                const layout = slots[idx];
                const isSavingHere = savingSlot === idx;

                // ── Name-input state ────────────────────────────────────
                if (isSavingHere) {
                  return (
                    <div
                      key={idx}
                      className="flex flex-col gap-2 p-2.5 rounded-lg border border-primary bg-primary/5"
                    >
                      <Input
                        value={slotName}
                        onChange={(e) => setSlotName(e.target.value)}
                        placeholder={`Layout ${idx + 1}`}
                        className="h-7 text-xs"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveToSlot(idx);
                          if (e.key === 'Escape') {
                            setSavingSlot(null);
                            setSlotName('');
                          }
                        }}
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                      />
                      <Button
                        size="sm"
                        className="h-6 text-xs w-full"
                        onClick={() => handleSaveToSlot(idx)}
                      >
                        <Check className="h-3 w-3 mr-1" />Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs w-full text-muted-foreground"
                        onClick={() => { setSavingSlot(null); setSlotName(''); }}
                      >
                        Cancel
                      </Button>
                    </div>
                  );
                }

                // ── Filled slot ─────────────────────────────────────────
                if (layout) {
                  return (
                    <div
                      key={idx}
                      className="flex flex-col gap-1.5 p-2.5 rounded-lg border bg-muted/20"
                    >
                      <div className="flex items-start justify-between gap-1 min-w-0">
                        <span
                          className="text-xs font-semibold leading-tight break-words min-w-0 truncate"
                          title={layout.name}
                        >
                          {layout.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeleteSlot(idx)}
                          className="flex-shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                          aria-label={`Delete "${layout.name}"`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                      <p className="text-[10px] text-muted-foreground/60">
                        {new Date(layout.savedAt).toLocaleDateString()}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs w-full mt-auto"
                        onClick={() => handleLoadSlot(layout)}
                        disabled={busy}
                      >
                        Load
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] w-full text-muted-foreground px-1"
                        onClick={() => {
                          setSavingSlot(idx);
                          setSlotName(layout.name);
                        }}
                      >
                        Overwrite
                      </Button>
                    </div>
                  );
                }

                // ── Empty slot ──────────────────────────────────────────
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => { setSavingSlot(idx); setSlotName(''); }}
                    className="flex flex-col items-center justify-center gap-1.5 min-h-[90px] rounded-lg border border-dashed border-border/60 hover:border-primary/60 hover:bg-primary/5 transition-colors text-muted-foreground hover:text-primary"
                  >
                    <BookmarkPlus className="h-4 w-4" />
                    <span className="text-[11px] font-medium">Save here</span>
                  </button>
                );
              })}
            </div>
          </section>

        </div>
      </DialogContent>
    </Dialog>
  );
}
