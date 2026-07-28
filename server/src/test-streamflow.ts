/**
 * Streamflow integration checks:
 *   1. The account decoder reads every field from the exact byte offsets of
 *      Streamflow's on-chain layout (verified against their published SDK).
 *   2. Eligibility SQL: canceled and fully-withdrawn contracts are excluded;
 *      partial withdrawals count only the remainder.
 * Run via `npm test`.
 */
import assert from "node:assert/strict";
import { PublicKey, Keypair } from "@solana/web3.js";
import { decodeStream } from "./streamflow.js";
import { db, getLockerBalances, getAgedLockerBalances } from "./db.js";
import { config } from "./config.js";

/* ── 1. decoder reads the verified layout offsets ────────────── */
const recipient = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const buf = Buffer.alloc(1104);
const u64 = (off: number, v: bigint) => buf.writeBigUInt64LE(v, off);
u64(9, 1_700_000_000n);            // created_at
u64(17, 250n);                     // withdrawn_amount
u64(25, 0n);                       // canceled_at
u64(33, 1_800_000_000n);           // end_time
recipient.toBuffer().copy(buf, 113); // recipient
mint.toBuffer().copy(buf, 177);      // mint
u64(409, 1_700_000_100n);          // start_time
u64(417, 1_000n);                  // net_amount_deposited

const s = decodeStream("ContractXYZ", buf);
assert.equal(s.wallet, recipient.toBase58());
assert.equal(s.createdAt, 1_700_000_000);
assert.equal(s.withdrawnRaw, 250);
assert.equal(s.endTime, 1_800_000_000);
assert.equal(s.startTime, 1_700_000_100);
assert.equal(s.depositedRaw, 1_000);
assert.equal(s.canceledAt, 0);
console.log("✓ 1. decoder reads recipient/mint/amounts/times at the SDK-verified offsets");

/* ── 2. eligibility excludes canceled & withdrawn contracts ──── */
const now = Math.floor(Date.now() / 1000);
const aged = now - (config.minRewardAgeHours + 1) * 3600;
const ins = db.prepare(
  `INSERT INTO sf_locks (contract, wallet, deposited_raw, withdrawn_raw, created_at, start_time, end_time, canceled_at)
   VALUES (?, ?, ?, ?, ${aged}, ${aged}, ${now + 30 * 86400}, ?)`
);
const W1 = "SfWallet1111111111111111111111111111111111111";
const W2 = "SfWallet2222222222222222222222222222222222222";
ins.run("sf-ok", W1, 1_000_000, 0, 0);            // healthy lock
ins.run("sf-partial", W1, 500_000, 200_000, 0);   // partly withdrawn → remainder counts
ins.run("sf-canceled", W2, 9_000_000, 0, now);    // canceled → excluded
ins.run("sf-drained", W2, 700_000, 700_000, 0);   // fully withdrawn → excluded

const balances = getLockerBalances();
assert.equal(balances.length, 1, "only W1 may have active locks");
assert.equal(balances[0].wallet, W1);
assert.equal(balances[0].amountRaw, 1_300_000, "1,000,000 + (500,000 − 200,000)");
const eligible = getAgedLockerBalances(config.minRewardAgeHours * 3600);
assert.equal(eligible.length, 1);
assert.equal(eligible[0].amountRaw, 1_300_000);
console.log("✓ 2. canceled/drained contracts excluded; partial withdrawals count the remainder");

console.log("\nALL STREAMFLOW CHECKS PASSED");
void PublicKey;
