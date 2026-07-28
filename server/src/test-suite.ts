/**
 * Engine verification suite. Runs the real distribution code (dry-run) against
 * a throwaway DB and asserts the mechanics the whole project depends on:
 *
 *   1. No lockers            → round is skipped, nothing paid
 *   2. Proportionality       → 1% locker earns exactly 2× a 0.5% locker
 *   3. Dust carry-over       → sub-threshold payouts accumulate, then pay out
 *   4. Unlocks               → a fully-unlocked wallet stops earning
 *
 * Usage: npm run test   (DB_PATH must point at a throwaway file)
 */
import assert from "node:assert/strict";
import { db, getLockerBalances } from "./db.js";
import { runDistribution } from "./distribute.js";
import { config } from "./config.js";

assert.ok(config.dryRun, "test suite must run with DRY_RUN=true");

const SUPPLY = config.totalSupplyRaw;
const A = "WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "WalletBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const C = "WalletCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

const seed = db.prepare("INSERT INTO locks (wallet, amount_raw, signature) VALUES (?, ?, ?)");
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

/* ── 2. proportionality ──────────────────────────────────────── */
seed.run(A, SUPPLY * 0.01, "sig-a");      // locks 1.00% of supply
seed.run(B, SUPPLY * 0.005, "sig-b");     // locks 0.50% of supply
seed.run(C, SUPPLY * 0.0000155, "sig-c"); // tiny locker → dust territory

await runDistribution();
const d2 = lastDist();
assert.equal(d2.status, "simulated");
const p2 = payoutsFor(d2.id);
const payA = p2.find((p) => p.wallet === A);
const payB = p2.find((p) => p.wallet === B);
assert.ok(payA && payB, "A and B must both be paid");
assert.equal(payA.lamports, 2 * payB.lamports, "1% locker must earn exactly 2× the 0.5% locker");
console.log(`✓ 2. proportionality exact: A=${payA.lamports} B=${payB.lamports} lamports`);

/* ── 3. dust carry-over ──────────────────────────────────────── */
assert.equal(p2.find((p) => p.wallet === C), undefined, "C's dust share must not be paid yet");
const carry1 = carryFor(C);
assert.ok(carry1 > 0 && carry1 < config.minPayoutLamports, "C's share must sit in carry");

let cPaid: any = null;
let expectedAccrual = carry1;
for (let round = 0; round < 4 && !cPaid; round++) {
  await runDistribution();
  const d = lastDist();
  cPaid = payoutsFor(d.id).find((p) => p.wallet === C);
  if (!cPaid) expectedAccrual = carryFor(C);
  else expectedAccrual += Math.floor(d.pot_lamports * (cPaid.share));
}
assert.ok(cPaid, "C must eventually clear the dust threshold");
assert.ok(cPaid.lamports >= config.minPayoutLamports, "C's payout must include accumulated carry");
assert.equal(carryFor(C), 0, "carry must reset after paying out");
console.log(`✓ 3. dust carried over then paid: C received ${cPaid.lamports} lamports, carry reset`);

/* ── 4. unlock removes a wallet from the split ───────────────── */
seed.run(B, -(SUPPLY * 0.005), "sig-b-unlock"); // B unlocks everything
const balances = getLockerBalances();
assert.equal(balances.find((l) => l.wallet === B), undefined, "net-zero wallet must be excluded");

await runDistribution();
const d4 = lastDist();
const p4 = payoutsFor(d4.id);
assert.equal(p4.find((p) => p.wallet === B), undefined, "unlocked wallet must not be paid");
const payA4 = p4.find((p) => p.wallet === A)!;
assert.ok(payA4.share > payA.share, "remaining lockers' share must grow after an unlock");
console.log(`✓ 4. unlock works: B removed, A's share grew ${(payA.share * 100).toFixed(2)}% → ${(payA4.share * 100).toFixed(2)}%`);

console.log("\nALL CHECKS PASSED");
