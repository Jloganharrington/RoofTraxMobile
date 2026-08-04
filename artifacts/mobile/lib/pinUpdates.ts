/**
 * Pin update notifications — recent stage transitions on the rep's own pins.
 * Surfaces appointment-set, appointment-completed, and FIPSA-signed events
 * for both Retail and Insurance workflows.
 */
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';

export interface PinUpdate {
  id: string;
  leadId: string;
  toStage: string;
  label: string;
  address: string | null;
  customerName: string | null;
  workflow: 'retail' | 'insurance';
  createdAt: string;
}

export const MY_PIN_UPDATES_KEY = ['my-pin-updates'] as const;

export function useMyPinUpdates() {
  return useQuery({
    queryKey: MY_PIN_UPDATES_KEY,
    queryFn: () =>
      customFetch<{ updates: PinUpdate[] }>('/api/leads/my-pin-updates'),
    staleTime: 60_000, // re-fetch after 1 min
  });
}

/** Human-friendly relative timestamp, e.g. "2h ago", "Yesterday", "3d ago" */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}
