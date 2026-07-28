import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { config } from "./config.js";
import { db } from "./db.js";
import { sendTokens } from "./solana.js";

/**
 * 24-hour minimum lock, enforced FIFO per deposit:
 * each deposit matures MIN_LOCK_HOURS after it landed, and unlocks always
 * consume the OLDEST deposits first. So topping up your lock never resets
 * the clock on tokens you locked earlier — only the new tokens wait.
 */

export interface LockStatus {
  lockedRaw: number;      // total still locked (net of unlocks)
  unlockableRaw: number;  // portion past the 24h minimum, withdrawable now
  nextUnlockAt: number | null; // unix seconds when the next deposit matures
}

export function getLockStatus(wallet: string, nowSec = Math.floor(Date.now() / 1000)): LockStatus {
  const rows = db
    .prepare(
      `SELECT amount_raw AS amount, COALESCE(block_time, created_at) AS t
       FROM locks WHERE wallet = ? ORDER BY t ASC, id ASC`
    )
    .all(wallet) as { amount: number; t: number }[];

  // Unlocked total consumes deposits oldest-first.
  let unlockedPool = rows.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0);
  const deposits: { remaining: number; t: number }[] = [];
  for (const r of rows) {
    if (r.amount <= 0) continue;
    const consumed = Math.min(r.amount, unlockedPool);
    unlockedPool -= consumed;
    if (r.amount - consumed > 0) deposits.push({ remaining: r.amount - consumed, t: r.t });
  }

  const matureBefore = nowSec - config.minLockHours * 3600;
  let lockedRaw = 0;
  let unlockableRaw = 0;
  let nextUnlockAt: number | null = null;
  for (const d of deposits) {
    lockedRaw += d.remaining;
    if (d.t <= matureBefore) {
      unlockableRaw += d.remaining;
    } else {
      const maturesAt = d.t + config.minLockHours * 3600;
      if (nextUnlockAt === null || maturesAt < nextUnlockAt) nextUnlockAt = maturesAt;
    }
  }
  return { lockedRaw, unlockableRaw, nextUnlockAt };
}

/** Canonical message a holder signs to authorize an unlock. */
export function unlockMessage(wallet: string, amountRaw: number, timestampMs: number): string {
  return `MOONBAG_UNLOCK:${wallet}:${amountRaw}:${timestampMs}`;
}

export function verifyUnlockSignature(
  wallet: string,
  amountRaw: number,
  timestampMs: number,
  signatureB58: string
): boolean {
  try {
    const msg = new TextEncoder().encode(unlockMessage(wallet, amountRaw, timestampMs));
    const sig = bs58.decode(signatureB58);
    const pub = new PublicKey(wallet).toBytes();
    return nacl.sign.detached.verify(msg, sig, pub);
  } catch {
    return false;
  }
}

const insertNonce = db.prepare("INSERT INTO unlock_nonces (nonce) VALUES (?)");
const insertLock = db.prepare(
  "INSERT OR IGNORE INTO locks (wallet, amount_raw, signature, block_time) VALUES (?, ?, ?, ?)"
);
const inFlight = new Set<string>();

export type UnlockResult =
  | { ok: true; simulated: boolean; txSignature: string | null }
  | { ok: false; code: number; error: string };

export async function requestUnlock(
  wallet: string,
  amountRaw: number,
  timestampMs: number,
  signatureB58: string
): Promise<UnlockResult> {
  if (!Number.isInteger(amountRaw) || amountRaw <= 0)
    return { ok: false, code: 400, error: "amountRaw must be a positive integer" };
  if (Math.abs(Date.now() - timestampMs) > 10 * 60 * 1000)
    return { ok: false, code: 400, error: "timestamp outside the 10-minute window" };
  if (!verifyUnlockSignature(wallet, amountRaw, timestampMs, signatureB58))
    return { ok: false, code: 401, error: "signature verification failed" };

  if (inFlight.has(wallet)) return { ok: false, code: 429, error: "unlock already in progress" };
  inFlight.add(wallet);
  try {
    try {
      insertNonce.run(`${wallet}:${timestampMs}`);
    } catch {
      return { ok: false, code: 409, error: "duplicate request (replay rejected)" };
    }

    const status = getLockStatus(wallet);
    if (amountRaw > status.unlockableRaw)
      return {
        ok: false,
        code: 400,
        error: `only ${status.unlockableRaw} base units are past the ${config.minLockHours}h minimum lock`,
      };

    const now = Math.floor(Date.now() / 1000);
    if (config.dryRun || !config.vaultKeypair || !config.tokenMint) {
      insertLock.run(wallet, -amountRaw, `sim-unlock:${wallet}:${timestampMs}`, now);
      return { ok: true, simulated: true, txSignature: null };
    }

    const { signature, destAta } = await sendTokens(config.vaultKeypair, config.tokenMint, wallet, amountRaw);
    // Same dedupe key the on-chain scanner uses for this transfer → when the
    // scanner later sees the tx, INSERT OR IGNORE skips it. No double count.
    insertLock.run(wallet, -amountRaw, `${signature}:${destAta}`, now);
    return { ok: true, simulated: false, txSignature: signature };
  } catch (e: any) {
    return { ok: false, code: 500, error: String(e.message ?? e).slice(0, 200) };
  } finally {
    inFlight.delete(wallet);
  }
}
