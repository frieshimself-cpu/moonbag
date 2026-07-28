/**
 * START-button CLI: wipes all stats and restarts the timer from zero.
 *
 *   CONFIRM=yes npm run reset
 *
 * Deliberately guarded — this erases the lock ledger, so it must never run
 * by accident. Only use it BEFORE launch (clearing rehearsal data) or at
 * the START moment itself. Never run it once real holders have locked.
 */
import { resetAll } from "./reset.js";

if (process.env.CONFIRM !== "yes") {
  console.error(`
  ⚠️  This wipes the ENTIRE ledger: locks, payouts, history, carry — all of it.
      Stats go to zero and the payout timer restarts from this moment.

      If that is really what you want:   CONFIRM=yes npm run reset

      Never run this after real holders have locked — their lock records
      (and any carried dust) would be erased.
  `);
  process.exit(1);
}

const { anchor } = resetAll();
console.log(`✅ Ledger wiped. Timer anchored to ${new Date(anchor).toISOString()}.`);
console.log("   Stats read zero; the first drop lands one full interval from now.");
console.log("   Start (or restart) the server and you are LIVE from a clean slate.");
