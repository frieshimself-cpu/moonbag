import { Router } from "express";
import { PublicKey } from "@solana/web3.js";
import { config } from "./config.js";
import { db, getAgedLockerBalances, getLockerBalances, getTotals, getWalletLocks } from "./db.js";
import { nextDistributionAt } from "./distribute.js";
import { LAMPORTS_PER_SOL } from "./solana.js";

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
  res.json({
    lockWith: "streamflow",
    lockUrl: "https://app.streamflow.finance/token-lock",
    tokenMint: config.tokenMint || null,
    minLockHours: config.minLockHours,
    minRewardAgeHours: config.minRewardAgeHours,
    how:
      `Lock $MOONBAG on Streamflow (non-custodial — tokens sit in Streamflow's ` +
      `on-chain escrow, we never touch them). Locks with a duration of at least ` +
      `${config.minLockHours}h start earning ${config.minRewardAgeHours}h after creation; ` +
      `SOL is paid to the lock's recipient wallet every round, proportional to the locked amount.`,
  });
});

/** A single wallet's Streamflow lock position and per-contract detail. */
api.get("/locker/:wallet", (req, res) => {
  try {
    new PublicKey(req.params.wallet);
  } catch {
    res.status(400).json({ error: "invalid wallet address" });
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const minDur = config.minLockHours * 3600;
  const warmup = config.minRewardAgeHours * 3600;
  const contracts = getWalletLocks(req.params.wallet).map((c) => {
    const remaining = c.depositedRaw - c.withdrawnRaw;
    const active = c.canceledAt === 0 && remaining > 0 && c.endTime > now;
    const longEnough = c.endTime - c.createdAt >= minDur;
    const warmedUp = now - c.createdAt >= warmup;
    return {
      contract: c.contract,
      lockedTokens: remaining / 10 ** config.tokenDecimals,
      createdAt: c.createdAt,
      unlocksAt: c.endTime,
      status: !active ? "inactive"
        : !longEnough ? `too short (needs ≥${config.minLockHours}h duration)`
        : !warmedUp ? "warming up"
        : "earning",
      startsEarningAt: active && longEnough && !warmedUp ? c.createdAt + warmup : null,
    };
  });
  const earningRaw = getAgedLockerBalances(warmup)
    .find((l) => l.wallet === req.params.wallet)?.amountRaw ?? 0;
  const lockedRaw = getLockerBalances().find((l) => l.wallet === req.params.wallet)?.amountRaw ?? 0;
  res.json({
    wallet: req.params.wallet,
    lockedTokens: lockedRaw / 10 ** config.tokenDecimals,
    earningTokens: earningRaw / 10 ** config.tokenDecimals,
    contracts,
  });
});
