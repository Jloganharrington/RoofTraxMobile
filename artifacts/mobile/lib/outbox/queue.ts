import * as Crypto from 'expo-crypto';

import { getOutboxDb } from './db';
import type { OutboxItem, OutboxItemKind, OutboxStatus } from './types';

/**
 * Appends a new pending item to the outbox. This is the only place a
 * `payload` is ever written — every later transition only touches
 * status/attempts/lastError, keeping the capture record itself immutable.
 */
export async function enqueueOutboxItem(kind: OutboxItemKind, payload: unknown): Promise<string> {
  const db = await getOutboxDb();
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO outbox_items (id, kind, payload, status, attempts, lastError, createdAt, updatedAt)
     VALUES (?, ?, ?, 'pending', 0, NULL, ?, ?)`,
    [id, kind, JSON.stringify(payload), now, now],
  );
  return id;
}

/**
 * Atomically enqueue multiple outbox items in a single SQLite exclusive
 * transaction. All items are inserted or none are — a process-kill between
 * two `enqueueOutboxItem` calls can leave a partial sequence; this function
 * prevents that for sequences that must land together (e.g. the three
 * change-order items: create → line_item × N → sign).
 *
 * The items are inserted in the array order, preserving FIFO drain sequence.
 * Returns the generated IDs in the same order as the input array.
 */
export async function enqueueOutboxItemsBulk(
  items: Array<{ kind: OutboxItemKind; payload: unknown }>,
): Promise<string[]> {
  const db = await getOutboxDb();
  const ids: string[] = [];
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const item of items) {
      const id = Crypto.randomUUID();
      ids.push(id);
      await txn.runAsync(
        `INSERT INTO outbox_items (id, kind, payload, status, attempts, lastError, createdAt, updatedAt)
         VALUES (?, ?, ?, 'pending', 0, NULL, ?, ?)`,
        [id, item.kind, JSON.stringify(item.payload), now, now],
      );
    }
  });
  return ids;
}

/**
 * Items eligible to attempt a sync: never-tried, previously-failed, or left
 * mid-flight by an interrupted drain (a crash/force-quit after an item was
 * marked `syncing` but before it could be marked done/failed). The in-process
 * single-flight guard in drain.ts plus JS's single thread guarantee that any
 * `syncing` row observed at the start of a drain is such a leftover — never a
 * genuinely concurrent send — so it is safe to retry. Without this, a crash
 * mid-sync would strand the row in `syncing` forever, silently losing the
 * offline write. Oldest first (FIFO) so a create always precedes its
 * dependents.
 */
export async function listSyncableOutboxItems(): Promise<OutboxItem[]> {
  const db = await getOutboxDb();
  return db.getAllAsync<OutboxItem>(
    `SELECT * FROM outbox_items WHERE status IN ('pending', 'failed', 'syncing') ORDER BY createdAt ASC, rowid ASC`,
  );
}

export async function listAllOutboxItems(): Promise<OutboxItem[]> {
  const db = await getOutboxDb();
  return db.getAllAsync<OutboxItem>(`SELECT * FROM outbox_items ORDER BY createdAt ASC, rowid ASC`);
}

/**
 * Counts still-unsynced capture writes (photos, measurements, interior
 * observations, attestations, etc.) belonging to one inspection — everything
 * EXCEPT the submission item itself. The E6 readiness screen blocks submit
 * until this reaches zero, so the submission manifest can never reference a
 * child record that has not durably persisted server-side. A permanently
 * failing child therefore surfaces as "still uploading" rather than a silently
 * invalid package. `dead` (permanently rejected) items count too: they will
 * never sync, so the package is missing evidence and must not be submittable.
 */
export async function countUnsyncedWritesForInspection(inspectionId: string): Promise<number> {
  const db = await getOutboxDb();
  const items = await db.getAllAsync<OutboxItem>(
    `SELECT * FROM outbox_items WHERE status IN ('pending', 'failed', 'syncing', 'dead')`,
  );
  return items.filter((item) => {
    if (item.kind === 'inspection.submission') return false;
    // Bug reports are a beta side-channel, never inspection evidence — a
    // wedged/dead bug report must not make an inspection unsubmittable, even
    // though its context blob may mention an inspectionId.
    if (item.kind === 'bug_report') return false;
    try {
      const payload = JSON.parse(item.payload) as { inspectionId?: string };
      return payload.inspectionId === inspectionId;
    } catch {
      return false;
    }
  }).length;
}

async function setStatus(id: string, status: OutboxStatus, lastError: string | null, bumpAttempts: boolean) {
  const db = await getOutboxDb();
  await db.runAsync(
    `UPDATE outbox_items
     SET status = ?, lastError = ?, updatedAt = ?, attempts = attempts + ?
     WHERE id = ?`,
    [status, lastError, new Date().toISOString(), bumpAttempts ? 1 : 0, id],
  );
}

export const markOutboxItemSyncing = (id: string) => setStatus(id, 'syncing', null, false);
export const markOutboxItemDone = (id: string) => setStatus(id, 'done', null, false);
export const markOutboxItemFailed = (id: string, error: string) => setStatus(id, 'failed', error, true);
/** Permanently rejected (4xx) — excluded from every future drain. */
export const markOutboxItemDead = (id: string, error: string) => setStatus(id, 'dead', error, true);

/**
 * Returns true if a photo with the same sha256 is already pending/failed/syncing
 * for this inspection. Prevents double-tap from creating two distinct photo records
 * when the outbox has not yet drained the first item.
 *
 * This check is fast (SQLite, no network) and called on the capture hot path — keep
 * it simple and non-throwing.
 */
export async function hasPendingPhotoInOutbox(inspectionId: string, sha256: string): Promise<boolean> {
  try {
    const db = await getOutboxDb();
    const items = await db.getAllAsync<{ id: string; payload: string }>(
      `SELECT id, payload FROM outbox_items
       WHERE kind = 'inspection.photo' AND status IN ('pending', 'failed', 'syncing')`,
    );
    return items.some((item) => {
      try {
        const p = JSON.parse(item.payload) as { inspectionId?: string; sha256?: string };
        return p.inspectionId === inspectionId && p.sha256 === sha256;
      } catch {
        return false;
      }
    });
  } catch {
    // Non-fatal: if the DB is unavailable we just allow the enqueue.
    return false;
  }
}
