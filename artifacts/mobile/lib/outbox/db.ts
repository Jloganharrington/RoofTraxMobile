import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Opens (or returns the already-open) durable outbox database. The file
 * lives in the app's normal SQLite storage directory, so it survives app
 * restarts and force-quits — only an app uninstall or explicit user data
 * clear removes it.
 */
export function getOutboxDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('rooftrax-outbox.db').then(async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS outbox_items (
          id TEXT PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          lastError TEXT,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS outbox_items_status_idx ON outbox_items(status, createdAt);
      `);
      return db;
    });
  }
  return dbPromise;
}
