/**
 * Module-level store for AI-parsed measurements awaiting confirmation.
 * Written by the hub screen after a successful analyze call, read by the
 * confirmation screen. Cleared after apply or on discard.
 */
import type { ParsedMeasurements, FacetInventory, FacetInventoryStatus } from '@workspace/protocol';

export interface PendingMeasurementsData extends ParsedMeasurements {
  facetInventory?: FacetInventory | null;
  facetInventoryStatus?: FacetInventoryStatus | null;
  /** All rendered measurement-report pages returned by analyze-measurements. */
  measurementPages?: Array<{ page: number; url: string }>;
}

let _pending: PendingMeasurementsData | null = null;

export function setPendingMeasurements(m: PendingMeasurementsData | null): void {
  _pending = m;
}

export function getPendingMeasurements(): PendingMeasurementsData | null {
  return _pending;
}
