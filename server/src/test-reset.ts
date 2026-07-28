/**
 * START-button verification: seed a dirty ledger, reset, and assert the
 * project is back to a true zero with the timer anchored to the reset
 * moment. Run via `npm test`.
 */
import assert from "node:assert/strict";
import { db, getLockerBalances, getTotals, getMeta } from "./db.js";
import { resetAll } from "./reset.js";
import { runDistribution, nextDistributionAt } from "./distribute.js";
import { config } from "./config.js";

assert.ok(config.dryRun, "reset test must run with DRY_RUN=true");

// Dirty the ledger: aged locks, a distribution round, payouts, carry.
const aged = Math.floor(Date.now() / 1000) - (config.minRewardAgeHours + 1) * 3600;
const seed = db.prepare(
  `INSERT INTO locks (wallet, amount_raw, signature, block_time) VALUES (?, ?, ?, ${aged})`
);
seed.run("ResetWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", 5_000_000_000, "r-a");
seed.run("ResetWalletBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", 123, "r-b"); // dust → carry
await runDistribution();

let totals = getTotals();
assert.ok(totals.locked.total > 0 && totals.paid.count > 0, "ledger must be dirty before reset");
assert.ok((db.prepare("SELECT COUNT(*) c FROM carry").get() as any).c > 0, "carry must exist");
console.log("✓ 1. dirty ledger prepared (locks, payouts, carry all populated)");

// START.
const before = Date.now();
const { anchor } = resetAll();

totals = getTotals();
assert.equal(totals.locked.total, 0, "locked supply must read zero");
assert.equal(totals.locked.lockers, 0, "locker count must read zero");
assert.equal(totals.paid.lamports, 0, "distributed SOL must read zero");
assert.equal(totals.paid.count, 0, "payout count must read zero");
assert.equal(totals.lastDist, null, "no distribution history may remain");
assert.equal(getLockerBalances().length, 0, "leaderboard must be empty");
assert.equal((db.prepare("SELECT COUNT(*) c FROM carry").get() as any).c, 0, "carry wiped");
assert.equal((db.prepare("SELECT COUNT(*) c FROM unlock_nonces").get() as any).c, 0, "nonces wiped");
console.log("✓ 2. after START: every stat reads zero, leaderboard empty, history gone");

// Timer: anchored to the reset moment, first drop exactly one interval out.
assert.ok(anchor >= before && anchor <= Date.now(), "anchor must be the reset moment");
assert.equal(getMeta("start_anchor"), String(anchor), "anchor persisted");
const next = nextDistributionAt();
assert.equal(next, anchor + config.distributionIntervalMs, "first drop lands one full interval after START");
console.log(
  `✓ 3. timer restarted: first drop ${config.distributionIntervalMs / 60000} minutes after the START moment`
);

console.log("\nALL RESET CHECKS PASSED");
