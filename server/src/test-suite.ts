/**
 * Engine verification suite (Streamflow model). Runs the real distribution
 * code in dry-run against a throwaway DB:
 *
 *   1. No lockers               → round skipped, nothing paid
 *   2. Proportionality          → 1% locker earns exactly 2× a 0.5% locker,
 *      and neither a warming-up lock nor a too-short lock earns anything
 *   3. Dust carry-over          → sub-threshold payouts accumulate, then pay
 *   4. Expiry                   → a lock past its unlock date stops earning
 *
 * Usage: npm test
 */
import assert from "node:assert/strict";
import { db } from "./db.js";
import { runDistribution } from "./distribute.js";
import { config } from "./config.js";

assert.ok(config.dryRun, "test suite must run with DRY_RUN=true");

const SUPPLY = config.totalSupplyRaw;
const now = Math.floor(Date.now() / 1000);
const DAY = 86_400;
const A = "WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "WalletBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const C = "WalletCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const FRESH = "WalletFRESHFRESHFRESHFRESHFRESHFRESHFRESHFRES";
const SHORTY = "WalletSHORTSHORTSHORTSHORTSHORTSHORTSHORTSHOR";

const seed = db.prepare(
  `INSERT INTO sf_locks (contract, wallet, deposited_raw, withdrawn_raw, created_at, start_time, end_time, canceled_at)
   VALUES (?, ?, ?, 0, ?, ?, ?, 0)`
);
/** Streamflow lock: created `ageSec` ago, unlocking `durSec` after creation. */
const lock = (contract: string, wallet: string, amount: number, ageSec: number, durSec: number) =>
  seed.run(contract, wallet, amount, now - ageSec, now - ageSec, now - ageSec + durSec);

const lastDist = () =>
  db.prepare("SELECT * FROM distributions ORDER BY id DESC LIMIT 1").get() as any;
const payoutsFor = (distId: number) =>
  db.prepare("SELECT * FROM payouts WHERE distribution_id = ?").all(distId) as any[];
const carryFor = (wallet: string) =>
  (db.prepare("SELECT lamports FROM carry WHERE wallet = ?").get(wallet) as any)?.lamports ?? 0;

/* ── 1. no lockers → skipped ─────────────────────────────────── */
await runDistribution();
assert.equal(lastDist().status, "skipped", "empty round should be skipped");
assert.equal(db.prepare("SELECT COUNT(*) c FROM payouts").get()!["c" as never], 0);
console.log("✓ 1. round with no lockers is skipped, nothing paid");

/* ── 2. proportionality + warm-up gate + duration gate ───────── */
lock("ct-a", A, SUPPLY * 0.01, 25 * 3600, 30 * DAY);       // 1.00%, aged, long lock
lock("ct-b", B, SUPPLY * 0.005, 25 * 3600, 30 * DAY);      // 0.50%, aged, long lock
lock("ct-c", C, SUPPLY * 0.0000155, 25 * 3600, 30 * DAY);  // dust-tier, aged
lock("ct-fresh", FRESH, SUPPLY * 0.02, 60, 30 * DAY);      // BIG but 1 minute old
lock("ct-short", SHORTY, SUPPLY * 0.02, 25 * 3600, 3600);  // aged but only a 1h lock

await runDistribution();
const d2 = lastDist();
assert.equal(d2.status, "simulated");
assert.equal(d2.locker_count, 3, "warming-up and too-short locks must not be eligible");
const p2 = payoutsFor(d2.id);
const payA = p2.find((p) => p.wallet === A);
const payB = p2.find((p) => p.wallet === B);
assert.ok(payA && payB, "A and B must both be paid");
assert.equal(p2.find((p) => p.wallet === FRESH), undefined, "1-minute-old lock earns nothing yet");
assert.equal(p2.find((p) => p.wallet === SHORTY), undefined, "a 1h-duration lock never qualifies");
assert.equal(payA.lamports, 2 * payB.lamports, "1% locker must earn exactly 2× the 0.5% locker");
console.log(`✓ 2. proportionality exact (A=${payA.lamports} B=${payB.lamports}); fresh + short locks excluded`);

/* ── 3. dust carry-over ──────────────────────────────────────── */
assert.equal(p2.find((p) => p.wallet === C), undefined, "C's dust share must not be paid yet");
const carry1 = carryFor(C);
assert.ok(carry1 > 0 && carry1 < config.minPayoutLamports, "C's share must sit in carry");

let cPaid: any = null;
for (let round = 0; round < 4 && !cPaid; round++) {
  await runDistribution();
  cPaid = payoutsFor(lastDist().id).find((p) => p.wallet === C);
}
assert.ok(cPaid, "C must eventually clear the dust threshold");
assert.ok(cPaid.lamports >= config.minPayoutLamports, "C's payout must include accumulated carry");
assert.equal(carryFor(C), 0, "carry must reset after paying out");
console.log(`✓ 3. dust carried over then paid: C received ${cPaid.lamports} lamports, carry reset`);

/* ── 4. an expired lock stops earning ────────────────────────── */
db.prepare("UPDATE sf_locks SET end_time = ? WHERE contract = 'ct-b'").run(now - 60);
await runDistribution();
const d4 = lastDist();
const p4 = payoutsFor(d4.id);
assert.equal(p4.find((p) => p.wallet === B), undefined, "expired lock must not be paid");
const payA4 = p4.find((p) => p.wallet === A)!;
assert.ok(payA4.share > payA.share, "remaining lockers' share must grow after an expiry");
console.log(`✓ 4. expiry works: B's lock ended, A's share grew ${(payA.share * 100).toFixed(2)}% → ${(payA4.share * 100).toFixed(2)}%`);

console.log("\nALL CHECKS PASSED");
