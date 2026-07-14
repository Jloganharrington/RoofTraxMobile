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

/** Items eligible to attempt a sync: never-tried or previously-failed, oldest first (FIFO). */
export async function listSyncableOutboxItems(): Promise<OutboxItem[]> {
  const db = await getOutboxDb();
  return db.getAllAsync<OutboxItem>(
    `SELECT * FROM outbox_items WHERE status IN ('pending', 'failed') ORDER BY createdAt ASC`,
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
