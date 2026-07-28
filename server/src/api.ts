import { Router } from "express";
import { PublicKey } from "@solana/web3.js";
import { config } from "./config.js";
import { db, getAgedLockerBalances, getLockerBalances, getTotals } from "./db.js";
import { nextDistributionAt } from "./distribute.js";
import { vaultTokenAccount, LAMPORTS_PER_SOL } from "./solana.js";
import { getLockStatus, requestUnlock } from "./unlock.js";

export const api = Router();

const shorten = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

api.get("/stats", (_req, res) => {
  const { locked, paid, lastDist } = getTotals();
  const eligible = getAgedLockerBalances(config.minRewardAgeHours * 3600);
  const eligibleRaw = eligible.reduce((s, l) => s + l.amountRaw, 0);
  res.json({
    ticker: "$MOONBAG",
    tokenMint: config.tokenMint || null,
    dryRun: config.dryRun,
    intervalMs: config.distributionIntervalMs,
    minLockHours: config.minLockHours,
    minRewardAgeHours: config.minRewardAgeHours,
    eligibleLockedRaw: eligibleRaw,
    eligibleLockedPct: (eligibleRaw / config.totalSupplyRaw) * 100,
    nextDistributionAt: nextDistributionAt(),
    totalLockedRaw: locked.total,
    totalLockedPct: (locked.total / config.totalSupplyRaw) * 100,
    lockers: locked.lockers,
    totalDistributedSol: paid.lamports / LAMPORTS_PER_SOL,
    totalPayouts: paid.count,
    lastDistribution: lastDist
      ? {
          at: lastDist.started_at,
          potSol: lastDist.pot_lamports / LAMPORTS_PER_SOL,
          lockers: lastDist.locker_count,
          status: lastDist.status,
        }
      : null,
  });
});

api.get("/leaderboard", (_req, res) => {
  const lockers = getLockerBalances().slice(0, 25);
  // Pot shares come from AGED balances only — fresh locks show 0% ("warming
  // up") until they clear the reward-age gate.
  const aged = new Map(
    getAgedLockerBalances(config.minRewardAgeHours * 3600).map((l) => [l.wallet, l.amountRaw])
  );
  const totalAged = [...aged.values()].reduce((s, v) => s + v, 0);
  res.json(
    lockers.map((l, i) => ({
      rank: i + 1,
      wallet: shorten(l.wallet),
      lockedRaw: l.amountRaw,
      lockedTokens: l.amountRaw / 10 ** config.tokenDecimals,
      supplyPct: (l.amountRaw / config.totalSupplyRaw) * 100,
      shareOfPot: totalAged > 0 ? ((aged.get(l.wallet) ?? 0) / totalAged) * 100 : 0,
      earning: (aged.get(l.wallet) ?? 0) > 0,
    }))
  );
});

api.get("/payouts", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT wallet, lamports, share, signature, status, created_at
       FROM payouts ORDER BY id DESC LIMIT 30`
    )
    .all() as { wallet: string; lamports: number; share: number; signature: string | null; status: string; created_at: number }[];
  res.json(
    rows.map((r) => ({
      wallet: shorten(r.wallet),
      sol: r.lamports / LAMPORTS_PER_SOL,
      sharePct: r.share * 100,
      signature: r.signature,
      status: r.status,
      at: r.created_at,
    }))
  );
});

api.get("/lock-info", (_req, res) => {
  let vault: string | null = null;
  let vaultAta: string | null = null;
  if (config.vaultKeypair && config.tokenMint) {
    vault = config.vaultKeypair.publicKey.toBase58();
    vaultAta = vaultTokenAccount(config.vaultKeypair.publicKey, new PublicKey(config.tokenMint)).toBase58();
  }
  res.json({
    vaultWallet: vault,
    vaultTokenAccount: vaultAta,
    tokenMint: config.tokenMint || null,
    minLockHours: config.minLockHours,
    how: `Send $MOONBAG to the vault wallet to lock. Rewards are paid in SOL to the wallet you sent from, every distribution round, proportional to your locked amount. Each deposit can be unlocked ${config.minLockHours}h after it lands.`,
  });
});

/** A single wallet's lock position: total locked, unlockable now, next maturity. */
api.get("/locker/:wallet", (req, res) => {
  try {
    new PublicKey(req.params.wallet);
  } catch {
    res.status(400).json({ error: "invalid wallet address" });
    return;
  }
  const s = getLockStatus(req.params.wallet);
  res.json({
    wallet: req.params.wallet,
    lockedRaw: s.lockedRaw,
    lockedTokens: s.lockedRaw / 10 ** config.tokenDecimals,
    unlockableRaw: s.unlockableRaw,
    unlockableTokens: s.unlockableRaw / 10 ** config.tokenDecimals,
    nextUnlockAt: s.nextUnlockAt,
    minLockHours: config.minLockHours,
  });
});

/**
 * Self-serve unlock. The holder signs `MOONBAG_UNLOCK:<wallet>:<amountRaw>:<ts>`
 * with their wallet key; the signature proves ownership, the 24h FIFO rule
 * caps the amount, and a nonce table blocks replays.
 */
api.post("/unlock", async (req, res) => {
  const { wallet, amountRaw, timestamp, signature } = req.body ?? {};
  if (typeof wallet !== "string" || typeof signature !== "string" ||
      typeof amountRaw !== "number" || typeof timestamp !== "number") {
    res.status(400).json({ error: "required: wallet, amountRaw, timestamp, signature" });
    return;
  }
  const result = await requestUnlock(wallet, amountRaw, timestamp, signature);
  if (!result.ok) {
    res.status(result.code).json({ error: result.error });
    return;
  }
  res.json({ ok: true, simulated: result.simulated, txSignature: result.txSignature });
});
