/**
 * Conservation fuzz test: 50 lockers with pseudo-random amounts, 5 full
 * distribution rounds. Asserts the money invariant that makes the whole
 * scheme trustworthy: for every wallet,
 *
 *     total paid + carry still owed  ==  rounds × floor(pot × share)
 *
 * i.e. not a single lamport is ever created, lost, or misassigned, no matter
 * how awkward the amounts are. Run via `npm test`.
 */
import assert from "node:assert/strict";
import { db } from "./db.js";
import { runDistribution } from "./distribute.js";
import { config } from "./config.js";

assert.ok(config.dryRun, "fuzz test must run with DRY_RUN=true");

// Deterministic PRNG so failures are reproducible.
let s = 123456789;
const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// Backdated past the reward-age gate so every fuzz wallet earns immediately.
const agedTs = Math.floor(Date.now() / 1000) - (config.minRewardAgeHours + 1) * 3600;
const seed = db.prepare(
  `INSERT INTO locks (wallet, amount_raw, signature, block_time) VALUES (?, ?, ?, ${agedTs})`
);
const wallets: { wallet: string; amount: number }[] = [];
for (let i = 0; i < 50; i++) {
  // Amounts spanning 6 orders of magnitude, including dust-tier lockers.
  const amount = Math.floor(10 ** (3 + rand() * 6) * (1 + rand()));
  const wallet = `FuzzWallet${String(i).padStart(3, "0")}${"x".repeat(30)}`;
  wallets.push({ wallet, amount });
  seed.run(wallet, amount, `fuzz-${i}`);
}
const totalLocked = wallets.reduce((t, w) => t + w.amount, 0);

const ROUNDS = 5;
for (let r = 0; r < ROUNDS; r++) await runDistribution();

const POT = Math.floor(0.05 * 1e9); // dry-run simulated pot per round
const paidByWallet = db
  .prepare(`SELECT wallet, COALESCE(SUM(lamports),0) AS paid FROM payouts GROUP BY wallet`)
  .all() as { wallet: string; paid: number }[];
const carryByWallet = db.prepare(`SELECT wallet, lamports FROM carry`).all() as {
  wallet: string;
  lamports: number;
}[];
const paid = new Map(paidByWallet.map((p) => [p.wallet, p.paid]));
const carry = new Map(carryByWallet.map((c) => [c.wallet, c.lamports]));

let totalPaid = 0;
for (const w of wallets) {
  const owedPerRound = Math.floor((POT * w.amount) / totalLocked);
  const expected = ROUNDS * owedPerRound;
  const got = (paid.get(w.wallet) ?? 0) + (carry.get(w.wallet) ?? 0);
  assert.equal(
    got,
    expected,
    `${w.wallet.slice(0, 13)}: paid+carry=${got}, expected ${expected} (share ${(w.amount / totalLocked * 100).toFixed(4)}%)`
  );
  totalPaid += got;
}
assert.ok(totalPaid <= POT * ROUNDS, "cannot distribute more than the pots contained");

const dust = wallets.filter((w) => (carry.get(w.wallet) ?? 0) > 0).length;
console.log(
  `✓ conservation holds for all 50 wallets across ${ROUNDS} rounds: ` +
    `${(totalPaid / 1e9).toFixed(4)} of ${(POT * ROUNDS) / 1e9} SOL assigned exactly, ` +
    `${dust} dust wallets carrying correctly`
);
console.log("ALL FUZZ CHECKS PASSED");
