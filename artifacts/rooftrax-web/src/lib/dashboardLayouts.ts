/**
 * Shared saved-layout types and localStorage helpers.
 * Imported by both Dashboard.tsx (to render quick-toggle buttons)
 * and ManageWidgetsModal.tsx (to read/write the slots).
 */
import type { GridCell } from '@/components/dashboard/DashboardGrid';

export interface SavedLayout {
  name: string;
  hidden: string[];
  order: string[];
  /** Widget drag/resize positions at time of save. Null = never saved positions. */
  gridLayout: GridCell[] | null;
  savedAt: string;
}

const lsKey = (userId: string) => `rt_dash_saved_${userId}`;

export function loadSavedSlots(userId: string): (SavedLayout | null)[] {
  if (!userId) return [null, null, null];
  try {
    const raw = localStorage.getItem(lsKey(userId));
    if (!raw) return [null, null, null];
    const parsed = JSON.parse(raw) as unknown[];
    return [
      (parsed[0] as SavedLayout) ?? null,
      (parsed[1] as SavedLayout) ?? null,
      (parsed[2] as SavedLayout) ?? null,
    ];
  } catch {
    return [null, null, null];
  }
}

export function persistSavedSlots(
  userId: string,
  slots: (SavedLayout | null)[],
): void {
  localStorage.setItem(lsKey(userId), JSON.stringify(slots));
}
