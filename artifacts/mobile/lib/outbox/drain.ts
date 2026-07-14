import { OUTBOX_HANDLERS } from './handlers';
import { listSyncableOutboxItems, markOutboxItemDone, markOutboxItemFailed, markOutboxItemSyncing } from './queue';

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
        await markOutboxItemFailed(item.id, error instanceof Error ? error.message : String(error));
        failed++;
      }
    }
  } finally {
    draining = false;
  }

  return { synced, failed };
}
