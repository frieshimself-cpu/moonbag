import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { config } from "./config.js";
import { db } from "./db.js";
import { connection } from "./solana.js";

/**
 * Streamflow lock scanner.
 *
 * Holders lock $MOONBAG with Streamflow's token-lock product
 * (app.streamflow.finance/token-lock) — non-custodial: tokens sit in
 * Streamflow's escrow under an on-chain contract until the unlock date the
 * holder chose. We never touch them. This scanner reads every Streamflow
 * contract for our mint straight off the chain and mirrors it into sf_locks.
 *
 * Program + layout verified against streamflow-finance/js-sdk:
 *   program  strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m
 *   offsets  created_at 9 · withdrawn 17 · canceled_at 25 · end_time 33
 *            sender 49 · recipient 113 · mint 177 (memcmp filter)
 *            start_time 409 · net_amount_deposited 417
 */
export const STREAMFLOW_PROGRAM = new PublicKey("strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m");
const OFF = { createdAt: 9, withdrawn: 17, canceledAt: 25, endTime: 33, recipient: 113, mint: 177, startTime: 409, deposited: 417 };

function u64(buf: Buffer, off: number): number {
  return Number(buf.readBigUInt64LE(off)); // amounts ≤ 1e15 — safe in a JS number
}
function pubkey(buf: Buffer, off: number): string {
  return bs58.encode(buf.subarray(off, off + 32));
}

export interface SfLock {
  contract: string;
  wallet: string;       // recipient — the wallet that owns the lock and gets paid
  depositedRaw: number;
  withdrawnRaw: number;
  createdAt: number;
  startTime: number;
  endTime: number;
  canceledAt: number;
}

export function decodeStream(contract: string, data: Buffer): SfLock {
  return {
    contract,
    wallet: pubkey(data, OFF.recipient),
    depositedRaw: u64(data, OFF.deposited),
    withdrawnRaw: u64(data, OFF.withdrawn),
    createdAt: u64(data, OFF.createdAt),
    startTime: u64(data, OFF.startTime),
    endTime: u64(data, OFF.endTime),
    canceledAt: u64(data, OFF.canceledAt),
  };
}

const replaceAll = db.transaction((locks: SfLock[]) => {
  db.prepare("DELETE FROM sf_locks").run();
  const ins = db.prepare(
    `INSERT INTO sf_locks (contract, wallet, deposited_raw, withdrawn_raw, created_at, start_time, end_time, canceled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const l of locks) {
    ins.run(l.contract, l.wallet, l.depositedRaw, l.withdrawnRaw, l.createdAt, l.startTime, l.endTime, l.canceledAt);
  }
});

/** Pull every Streamflow contract for our mint and mirror it locally. */
export async function scanStreamflowLocks(): Promise<number> {
  if (!config.tokenMint) return 0;
  const accounts = await connection.getProgramAccounts(STREAMFLOW_PROGRAM, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: OFF.mint, bytes: config.tokenMint } }],
  });
  const locks = accounts.map((a) => decodeStream(a.pubkey.toBase58(), a.account.data as Buffer));
  replaceAll(locks); // atomic swap — only on RPC success, stale data is kept on failure
  return locks.length;
}

let scanning = false;

export function startStreamflowScanner(): void {
  if (!config.tokenMint) {
    console.log("[streamflow] TOKEN_MINT not set — scanner idle");
    return;
  }
  const run = async () => {
    if (scanning) return;
    scanning = true;
    try {
      const n = await scanStreamflowLocks();
      console.log(`[streamflow] mirrored ${n} lock contract(s)`);
    } catch (e: any) {
      console.error("[streamflow] scan failed (keeping last good data):", e.message ?? e);
    } finally {
      scanning = false;
    }
  };
  run();
  setInterval(run, config.lockScanIntervalMs);
}
