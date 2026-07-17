import { OUTBOX_HANDLERS } from './handlers';
import {
  listSyncableOutboxItems,
  markOutboxItemDead,
  markOutboxItemDone,
  markOutboxItemFailed,
  markOutboxItemSyncing,
} from './queue';

// HTTP statuses that mean "the server understood and permanently rejected
// this payload" — retrying an identical body can never succeed. Transient
// (5xx), auth (401/403 — a session refresh may fix it), timeout (408) and
// rate-limit (429) statuses stay retryable.
function isPermanentRejection(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  if (typeof status !== 'number') return false;
  if (status === 401 || status === 403 || status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

let draining = false;

/**
 * Drains the outbox: attempts every pending/failed item once, oldest
 * first. Single-flight guarded — a connectivity event, an app-foreground
 * check, and the periodic safety-net timer can all fire close together,
 * and without this guard they would race to double-submit the same item.
 * A crash or force-quit mid-drain simply leaves the in-flight item in
 * `syncing`; the next drain treats it as syncable again (see queue.ts),
 * so an interrupted sync always gets retried rather than silently lost.
 */
export async function drainOutbox(): Promise<{ synced: number; failed: number }> {
  if (draining) return { synced: 0, failed: 0 };
  draining = true;

  let synced = 0;
  let failed = 0;
  try {
    const items = await listSyncableOutboxItems();
    for (const item of items) {
      const handler = OUTBOX_HANDLERS[item.kind];
      if (!handler) {
        await markOutboxItemFailed(item.id, `No handler registered for kind "${item.kind}"`);
        failed++;
        continue;
      }

      await markOutboxItemSyncing(item.id);
      try {
        await handler(item.payload);
        await markOutboxItemDone(item.id);
        synced++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isPermanentRejection(error)) {
          await markOutboxItemDead(item.id, message);
        } else {
          await markOutboxItemFailed(item.id, message);
        }
        failed++;
      }
    }
  } finally {
    draining = false;
  }

  return { synced, failed };
}
