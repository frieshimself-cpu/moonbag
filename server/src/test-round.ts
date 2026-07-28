/**
 * Dev harness: seeds three aged Streamflow locks (1%, 0.5%, 0.25% of
 * supply), runs one dry-run round, and prints what each wallet receives.
 * Usage: DB_PATH=tmp.db npm run test:round
 */
import { db, getLockerBalances } from "./db.js";
import { runDistribution } from "./distribute.js";
import { config } from "./config.js";

const SUPPLY = config.totalSupplyRaw;
const now = Math.floor(Date.now() / 1000);
const aged = now - (config.minRewardAgeHours + 1) * 3600;
const seed = db.prepare(
  `INSERT OR IGNORE INTO sf_locks (contract, wallet, deposited_raw, withdrawn_raw, created_at, start_time, end_time, canceled_at)
   VALUES (?, ?, ?, 0, ${aged}, ${aged}, ${now + 30 * 86400}, 0)`
);
seed.run("ct-a", "WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", SUPPLY * 0.01);
seed.run("ct-b", "WalletBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", SUPPLY * 0.005);
seed.run("ct-c", "WalletCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", SUPPLY * 0.0025);

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

const a = payouts.find((p) => p.wallet.startsWith("WalletA"))!;
const b = payouts.find((p) => p.wallet.startsWith("WalletB"))!;
const ratio = a.lamports / b.lamports;
if (Math.abs(ratio - 2) > 0.01) throw new Error(`proportionality broken: A/B = ${ratio}`);
console.log(`✓ proportionality holds: A/B payout ratio = ${ratio.toFixed(4)}`);
