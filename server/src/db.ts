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

/**
 * Reward-eligible balance per wallet: FIFO-net deposits that have been
 * locked for at least `minAgeSeconds`. Unlocks consume oldest deposits
 * first (matching the unlock module), and only the remaining deposits old
 * enough to clear the age gate count toward reward shares.
 */
export function getAgedLockerBalances(
  minAgeSeconds: number,
  nowSec = Math.floor(Date.now() / 1000)
): LockerBalance[] {
  const rows = db
    .prepare(
      `SELECT wallet, amount_raw AS amount, COALESCE(block_time, created_at) AS t
       FROM locks ORDER BY t ASC, id ASC`
    )
    .all() as { wallet: string; amount: number; t: number }[];

  const deposits = new Map<string, { amount: number; t: number }[]>();
  const unlocked = new Map<string, number>();
  for (const r of rows) {
    if (r.amount > 0) {
      let list = deposits.get(r.wallet);
      if (!list) deposits.set(r.wallet, (list = []));
      list.push({ amount: r.amount, t: r.t });
    } else {
      unlocked.set(r.wallet, (unlocked.get(r.wallet) ?? 0) - r.amount);
    }
  }

  const cutoff = nowSec - minAgeSeconds;
  const out: LockerBalance[] = [];
  for (const [wallet, list] of deposits) {
    let pool = unlocked.get(wallet) ?? 0;
    let aged = 0;
    for (const d of list) {
      const consumed = Math.min(d.amount, pool);
      pool -= consumed;
      const remaining = d.amount - consumed;
      if (remaining > 0 && d.t <= cutoff) aged += remaining;
    }
    if (aged > 0) out.push({ wallet, amountRaw: aged });
  }
  return out.sort((a, b) => b.amountRaw - a.amountRaw);
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
