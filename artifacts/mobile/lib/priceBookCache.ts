/**
 * Durable offline cache for price book items, backed by SQLite.
 *
 * On every successful network fetch the cache is atomically replaced with
 * the server's authoritative list. When the network is unavailable the same
 * data is served back so the change-order line-item picker keeps working.
 *
 * Kept in a dedicated database file (rooftrax-cache.db) so it stays
 * separate from the write outbox and is easy to wipe independently.
 */
import * as SQLite from 'expo-sqlite';

export interface CachedPriceBookItem {
  id: string;
  name: string;
  description: string | null;
  unitPrice: number; // cents
  unit: string | null;
  createdAt: string;
  updatedAt: string;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getCacheDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('rooftrax-cache.db').then(async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS price_book_items (
          id          TEXT    PRIMARY KEY NOT NULL,
          name        TEXT    NOT NULL,
          description TEXT,
          unit_price  INTEGER NOT NULL DEFAULT 0,
          unit        TEXT,
          created_at  TEXT    NOT NULL,
          updated_at  TEXT    NOT NULL
        );
      `);
      return db;
    });
  }
  return dbPromise;
}

/** Read every item from the local cache, ordered by creation date. */
export async function getPriceBookFromCache(): Promise<CachedPriceBookItem[]> {
  const db = await getCacheDb();
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    description: string | null;
    unit_price: number;
    unit: string | null;
    created_at: string;
    updated_at: string;
  }>('SELECT * FROM price_book_items ORDER BY created_at ASC');
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    unitPrice: r.unit_price,
    unit: r.unit ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Atomically replace the cache with the server's authoritative list.
 * Runs inside a single SQLite transaction so a partial write never leaves
 * a mixed state.
 */
export async function savePriceBookToCache(items: CachedPriceBookItem[]): Promise<void> {
  const db = await getCacheDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM price_book_items');
    for (const item of items) {
      await db.runAsync(
        `INSERT INTO price_book_items
           (id, name, description, unit_price, unit, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          item.name,
          item.description ?? null,
          item.unitPrice,
          item.unit ?? null,
          item.createdAt,
          item.updatedAt,
        ],
      );
    }
  });
}

/** Wipe the cache (e.g. on logout). */
export async function clearPriceBookCache(): Promise<void> {
  const db = await getCacheDb();
  await db.runAsync('DELETE FROM price_book_items');
}
