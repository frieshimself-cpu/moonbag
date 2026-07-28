import Database from "better-sqlite3";
import { config } from "./config.js";

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS locks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  amount_raw INTEGER NOT NULL,          -- token base units; negative = unlock
  signature TEXT NOT NULL UNIQUE,
  slot INTEGER,
  block_time INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_locks_wallet ON locks(wallet);

CREATE TABLE IF NOT EXISTS distributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  pot_lamports INTEGER NOT NULL,
  total_locked_raw INTEGER NOT NULL,
  locker_count INTEGER NOT NULL,
  status TEXT NOT NULL,                 -- 'paid' | 'simulated' | 'skipped' | 'failed'
  note TEXT
);

CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  distribution_id INTEGER NOT NULL REFERENCES distributions(id),
  wallet TEXT NOT NULL,
  lamports INTEGER NOT NULL,
  share REAL NOT NULL,                  -- fraction of the pot, 0..1
  signature TEXT,
  status TEXT NOT NULL,                 -- 'paid' | 'simulated' | 'failed'
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_payouts_dist ON payouts(distribution_id);

-- Dust below the min payout accumulates here until it clears the threshold.
CREATE TABLE IF NOT EXISTS carry (
  wallet TEXT PRIMARY KEY,
  lamports INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- One row per accepted unlock request; blocks signature replay.
CREATE TABLE IF NOT EXISTS unlock_nonces (
  nonce TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`);

export function getMeta(key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

export interface LockerBalance {
  wallet: string;
  amountRaw: number;
}

/** Net locked balance per wallet (deposits minus unlocks), positive only. */
export function getLockerBalances(): LockerBalance[] {
  const rows = db
    .prepare(
      `SELECT wallet, SUM(amount_raw) AS amountRaw
       FROM locks GROUP BY wallet HAVING amountRaw > 0
       ORDER BY amountRaw DESC`
    )
    .all() as { wallet: string; amountRaw: number }[];
  return rows.map((r) => ({ wallet: r.wallet, amountRaw: r.amountRaw }));
}

export function getTotals() {
  const locked = db
    .prepare(
      `SELECT COALESCE(SUM(amountRaw), 0) AS total, COUNT(*) AS lockers FROM
       (SELECT wallet, SUM(amount_raw) AS amountRaw FROM locks GROUP BY wallet HAVING amountRaw > 0)`
    )
    .get() as { total: number; lockers: number };

  const paid = db
    .prepare(
      `SELECT COALESCE(SUM(lamports), 0) AS lamports, COUNT(*) AS count
       FROM payouts WHERE status IN ('paid', 'simulated')`
    )
    .get() as { lamports: number; count: number };

  const lastDist = db
    .prepare(
      `SELECT * FROM distributions WHERE status IN ('paid','simulated') ORDER BY id DESC LIMIT 1`
    )
    .get() as
    | {
        id: number;
        started_at: number;
        pot_lamports: number;
        locker_count: number;
        status: string;
      }
    | undefined;

  return { locked, paid, lastDist: lastDist ?? null };
}
