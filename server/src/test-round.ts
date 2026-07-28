/**
 * Dev harness: seeds three lockers (1%, 0.5%, 0.25% of supply), runs one
 * dry-run distribution round, and prints what each wallet would receive.
 * Usage: npm run test:round   (uses a throwaway DB via DB_PATH)
 */
import { db, getLockerBalances } from "./db.js";
import { runDistribution } from "./distribute.js";
import { config } from "./config.js";

const SUPPLY = config.totalSupplyRaw;
const seed = db.prepare(
  "INSERT OR IGNORE INTO locks (wallet, amount_raw, signature) VALUES (?, ?, ?)"
);
seed.run("WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", SUPPLY * 0.01, "sig-a");
seed.run("WalletBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", SUPPLY * 0.005, "sig-b");
seed.run("WalletCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", SUPPLY * 0.0025, "sig-c");

console.log("lockers:", getLockerBalances().map((l) => ({
  wallet: l.wallet.slice(0, 7),
  pctOfSupply: ((l.amountRaw / SUPPLY) * 100).toFixed(2) + "%",
})));

await runDistribution();

const payouts = db
  .prepare("SELECT wallet, lamports, share, status FROM payouts ORDER BY id DESC LIMIT 10")
  .all() as { wallet: string; lamports: number; share: number; status: string }[];

console.log("payouts:", payouts.map((p) => ({
  wallet: p.wallet.slice(0, 7),
  sol: (p.lamports / 1e9).toFixed(6),
  share: (p.share * 100).toFixed(2) + "%",
  status: p.status,
})));

// Sanity: A locked 2× B, so A must be paid 2× B.
const a = payouts.find((p) => p.wallet.startsWith("WalletA"))!;
const b = payouts.find((p) => p.wallet.startsWith("WalletB"))!;
const ratio = a.lamports / b.lamports;
if (Math.abs(ratio - 2) > 0.01) throw new Error(`proportionality broken: A/B = ${ratio}`);
console.log(`✓ proportionality holds: A/B payout ratio = ${ratio.toFixed(4)}`);
