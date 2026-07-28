import { Router } from "express";
import { PublicKey } from "@solana/web3.js";
import { config } from "./config.js";
import { db, getLockerBalances, getTotals } from "./db.js";
import { nextDistributionAt } from "./distribute.js";
import { vaultTokenAccount, LAMPORTS_PER_SOL } from "./solana.js";

export const api = Router();

const shorten = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

api.get("/stats", (_req, res) => {
  const { locked, paid, lastDist } = getTotals();
  res.json({
    ticker: "$MOONBAG",
    tokenMint: config.tokenMint || null,
    dryRun: config.dryRun,
    intervalMs: config.distributionIntervalMs,
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
  const total = getLockerBalances().reduce((s, l) => s + l.amountRaw, 0);
  res.json(
    lockers.map((l, i) => ({
      rank: i + 1,
      wallet: shorten(l.wallet),
      lockedRaw: l.amountRaw,
      lockedTokens: l.amountRaw / 10 ** config.tokenDecimals,
      supplyPct: (l.amountRaw / config.totalSupplyRaw) * 100,
      shareOfPot: total > 0 ? (l.amountRaw / total) * 100 : 0,
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
    how: "Send $MOONBAG to the vault wallet to lock. Rewards are paid in SOL to the wallet you sent from, every distribution round, proportional to your locked amount.",
  });
});
