/**
 * Module-level store for AI-parsed measurements awaiting confirmation.
 * Written by the hub screen after a successful analyze call, read by the
 * confirmation screen. Cleared after apply or on discard.
 */
import type { ParsedMeasurements } from '@workspace/protocol';

let _pending: ParsedMeasurements | null = null;

export function setPendingMeasurements(m: ParsedMeasurements | null): void {
  _pending = m;
}

export function getPendingMeasurements(): ParsedMeasurements | null {
  return _pending;
}
