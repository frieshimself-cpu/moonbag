import Database from "better-sqlite3";
import { config } from "./config.js";

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
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

-- Mirror of every Streamflow lock contract for our mint (refreshed by the
-- scanner; the chain is the source of truth, this is a read model).
CREATE TABLE IF NOT EXISTS sf_locks (
  contract TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,            -- recipient: owns the lock, gets the SOL
  deposited_raw INTEGER NOT NULL,
  withdrawn_raw INTEGER NOT NULL,
  created_at INTEGER NOT NULL,     -- unix seconds, from the contract
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,       -- unlock date the holder chose
  canceled_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sf_locks_wallet ON sf_locks(wallet);
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

/**
 * A Streamflow lock counts as ACTIVE while it is not canceled, not fully
 * withdrawn, and its unlock date is still in the future — once the lock
 * expires the tokens are free, so they stop earning.
 */
const ACTIVE = `canceled_at = 0 AND deposited_raw > withdrawn_raw AND end_time > ?`;

/**
 * Reward-eligible balance per wallet. A lock earns when, on top of being
 * active: it was created at least `minAgeSeconds` ago (the warm-up gate),
 * and its total duration is at least MIN_LOCK_HOURS (no 5-minute locks).
 */
export function getAgedLockerBalances(
  minAgeSeconds: number,
  nowSec = Math.floor(Date.now() / 1000)
): LockerBalance[] {
  const rows = db
    .prepare(
      `SELECT wallet, SUM(deposited_raw - withdrawn_raw) AS amountRaw
       FROM sf_locks
       WHERE ${ACTIVE}
         AND created_at <= ?
         AND (end_time - created_at) >= ?
       GROUP BY wallet HAVING amountRaw > 0
       ORDER BY amountRaw DESC`
    )
    .all(nowSec, nowSec - minAgeSeconds, config.minLockHours * 3600) as {
    wallet: string;
    amountRaw: number;
  }[];
  return rows.map((r) => ({ wallet: r.wallet, amountRaw: r.amountRaw }));
}

/** Active locked balance per wallet (for display), regardless of warm-up. */
export function getLockerBalances(nowSec = Math.floor(Date.now() / 1000)): LockerBalance[] {
  const rows = db
    .prepare(
      `SELECT wallet, SUM(deposited_raw - withdrawn_raw) AS amountRaw
       FROM sf_locks WHERE ${ACTIVE}
       GROUP BY wallet HAVING amountRaw > 0
       ORDER BY amountRaw DESC`
    )
    .all(nowSec) as { wallet: string; amountRaw: number }[];
  return rows.map((r) => ({ wallet: r.wallet, amountRaw: r.amountRaw }));
}

/** All of one wallet's lock contracts, for the site's position panel. */
export function getWalletLocks(wallet: string, nowSec = Math.floor(Date.now() / 1000)) {
  return db
    .prepare(
      `SELECT contract, deposited_raw AS depositedRaw, withdrawn_raw AS withdrawnRaw,
              created_at AS createdAt, end_time AS endTime, canceled_at AS canceledAt
       FROM sf_locks WHERE wallet = ? ORDER BY created_at DESC`
    )
    .all(wallet) as {
    contract: string;
    depositedRaw: number;
    withdrawnRaw: number;
    createdAt: number;
    endTime: number;
    canceledAt: number;
  }[];
}

export function getTotals(nowSec = Math.floor(Date.now() / 1000)) {
  const locked = db
    .prepare(
      `SELECT COALESCE(SUM(amountRaw), 0) AS total, COUNT(*) AS lockers FROM
       (SELECT wallet, SUM(deposited_raw - withdrawn_raw) AS amountRaw
        FROM sf_locks WHERE ${ACTIVE} GROUP BY wallet HAVING amountRaw > 0)`
    )
    .get(nowSec) as { total: number; lockers: number };

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
