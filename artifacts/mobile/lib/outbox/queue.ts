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
    `SELECT * FROM outbox_items WHERE status IN ('pending', 'failed', 'syncing') ORDER BY createdAt ASC`,
  );
}

export async function listAllOutboxItems(): Promise<OutboxItem[]> {
  const db = await getOutboxDb();
  return db.getAllAsync<OutboxItem>(`SELECT * FROM outbox_items ORDER BY createdAt ASC`);
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
