import { db, setMeta } from "./db.js";

/**
 * Wipe the ledger back to a true zero and anchor the distribution timer to
 * this moment: stats read 0, the leaderboard empties, and the countdown
 * starts a fresh full interval from "now". Used at launch (START) — and by
 * the runbook to clear rehearsal data before going live.
 */
export function resetAll(): { anchor: number } {
  const anchor = Date.now();
  db.exec(`
    DELETE FROM payouts;
    DELETE FROM distributions;
    DELETE FROM sf_locks;
    DELETE FROM carry;
    DELETE FROM meta;
  `);
  setMeta("start_anchor", String(anchor));
  return { anchor };
}
