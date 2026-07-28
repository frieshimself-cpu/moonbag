import { config } from "./config.js";
import { db, getAgedLockerBalances, getMeta, setMeta } from "./db.js";
import { claimCreatorFees, getVaultSolBalance, sendSolBatch, sweepSolToVault, LAMPORTS_PER_SOL } from "./solana.js";

const insertDistribution = db.prepare(
  `INSERT INTO distributions (started_at, pot_lamports, total_locked_raw, locker_count, status, note)
   VALUES (?, ?, ?, ?, ?, ?)`
);
const insertPayout = db.prepare(
  `INSERT INTO payouts (distribution_id, wallet, lamports, share, signature, status)
   VALUES (?, ?, ?, ?, ?, ?)`
);
const getCarry = db.prepare("SELECT lamports FROM carry WHERE wallet = ?");
const setCarry = db.prepare(
  `INSERT INTO carry (wallet, lamports) VALUES (?, ?)
   ON CONFLICT(wallet) DO UPDATE SET lamports = excluded.lamports`
);

let running = false;

/**
 * One reward round:
 *   1. Claim accrued pump.fun creator fees into the vault (best-effort).
 *   2. Pot = vault SOL balance minus the fee reserve.
 *   3. Split the pot across lockers proportionally to locked amount.
 *   4. Sub-dust payouts carry over; everyone else gets paid in batched txs.
 */
export async function runDistribution(): Promise<void> {
  if (running) return; // never overlap rounds
  running = true;
  try {
    await distributeOnce();
  } catch (e: any) {
    console.error("[distribute] round failed:", e.message ?? e);
    insertDistribution.run(now(), 0, 0, 0, "failed", String(e.message ?? e).slice(0, 300));
  } finally {
    running = false;
  }
}

/** Claim creator fees; if a separate creator wallet is used, sweep to vault. */
async function claimAndSweep(): Promise<void> {
  const claimer = config.creatorKeypair ?? config.vaultKeypair;
  if (!claimer || !config.vaultKeypair) return;
  const sig = await claimCreatorFees(claimer);
  if (sig) console.log(`[claim] creator fees claimed: ${sig}`);
  if (config.creatorKeypair) {
    const sweep = await sweepSolToVault(config.creatorKeypair, config.vaultKeypair.publicKey);
    if (sweep) console.log(`[claim] swept creator wallet → vault: ${sweep}`);
  }
}

async function distributeOnce(): Promise<void> {
  // Only deposits older than the reward-age gate earn a share.
  const lockers = getAgedLockerBalances(config.minRewardAgeHours * 3600);
  const totalLocked = lockers.reduce((s, l) => s + l.amountRaw, 0);

  if (lockers.length === 0) {
    insertDistribution.run(now(), 0, 0, 0, "skipped",
      `no eligible lockers (locks must age ${config.minRewardAgeHours}h)`);
    console.log(`[distribute] skipped — no locks past the ${config.minRewardAgeHours}h age gate yet`);
    return;
  }

  // 1. Claim creator fees. Failure is non-fatal: distribute what's on hand.
  if (!config.dryRun) {
    try {
      await claimAndSweep();
    } catch (e: any) {
      console.warn("[distribute] fee claim failed (continuing):", e.message ?? e);
    }
  }

  // 2. Work out the pot.
  let potLamports: number;
  if (config.vaultKeypair && !config.dryRun) {
    const balance = await getVaultSolBalance(config.vaultKeypair.publicKey);
    potLamports = balance - Math.floor(config.reserveSol * LAMPORTS_PER_SOL);
  } else {
    // Dry-run without a live vault: simulate a small pot so the whole
    // pipeline (shares, carry, records, API) can be exercised end to end.
    potLamports = Math.floor(0.05 * LAMPORTS_PER_SOL);
  }

  if (potLamports < config.minDistributionSol * LAMPORTS_PER_SOL) {
    insertDistribution.run(now(), Math.max(potLamports, 0), totalLocked, lockers.length, "skipped", "pot below minimum");
    console.log(`[distribute] skipped — pot ${(potLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL below minimum`);
    return;
  }

  // 3. Proportional shares + carried-over dust.
  const status = config.dryRun ? "simulated" : "paid";
  const distId = insertDistribution.run(now(), potLamports, totalLocked, lockers.length, status, null)
    .lastInsertRowid as number;

  const due: { wallet: string; lamports: number; share: number }[] = [];
  for (const l of lockers) {
    const share = l.amountRaw / totalLocked;
    const carried = (getCarry.get(l.wallet) as { lamports: number } | undefined)?.lamports ?? 0;
    const owed = Math.floor(potLamports * share) + carried;
    if (owed < config.minPayoutLamports) {
      setCarry.run(l.wallet, owed);
    } else {
      setCarry.run(l.wallet, 0);
      due.push({ wallet: l.wallet, lamports: owed, share });
    }
  }

  // 4. Pay in batches of 8 transfers per transaction.
  for (let i = 0; i < due.length; i += 8) {
    const batch = due.slice(i, i + 8);
    if (config.dryRun || !config.vaultKeypair) {
      for (const p of batch) insertPayout.run(distId, p.wallet, p.lamports, p.share, null, "simulated");
      continue;
    }
    try {
      const sig = await sendSolBatch(config.vaultKeypair, batch.map((p) => ({ to: p.wallet, lamports: p.lamports })));
      for (const p of batch) insertPayout.run(distId, p.wallet, p.lamports, p.share, sig, "paid");
    } catch (e: any) {
      console.error("[distribute] batch send failed, retrying individually:", e.message ?? e);
      // The batch tx is atomic, so one bad recipient fails all 8. Retry each
      // transfer solo so the good ones still get paid; only the genuinely
      // failing ones return to carry (nothing is ever lost).
      for (const p of batch) {
        try {
          const sig = await sendSolBatch(config.vaultKeypair, [{ to: p.wallet, lamports: p.lamports }]);
          insertPayout.run(distId, p.wallet, p.lamports, p.share, sig, "paid");
        } catch (e2: any) {
          console.error(`[distribute] payout to ${p.wallet.slice(0, 8)}… failed:`, e2.message ?? e2);
          insertPayout.run(distId, p.wallet, p.lamports, p.share, null, "failed");
          const carried = (getCarry.get(p.wallet) as { lamports: number } | undefined)?.lamports ?? 0;
          setCarry.run(p.wallet, carried + p.lamports);
        }
      }
    }
  }

  const potSol = (potLamports / LAMPORTS_PER_SOL).toFixed(4);
  console.log(`[distribute] ${status}: ${potSol} SOL → ${due.length}/${lockers.length} lockers (round #${distId})`);
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Anchored schedule: drops land at start_anchor + n × interval, so the
 * countdown starts a full interval at START (or first boot) and stays
 * predictable across page refreshes and server restarts.
 */
export function nextDistributionAt(): number {
  const interval = config.distributionIntervalMs;
  const anchor = Number(getMeta("start_anchor")) || 0;
  return anchor + (Math.floor((Date.now() - anchor) / interval) + 1) * interval;
}

let claiming = false;

/**
 * Claim accrued creator fees on their own fast cadence (default: every
 * minute), so SOL is already sitting in the vault when a round fires.
 * The pre-round claim in distributeOnce stays as a final top-up.
 */
export function startFeeClaimer(): void {
  if (config.dryRun || !config.vaultKeypair || !config.tokenMint) {
    console.log("[claim] dry-run or unconfigured — fee claimer idle");
    return;
  }
  const run = async () => {
    if (claiming) return;
    claiming = true;
    try {
      await claimAndSweep();
    } catch (e: any) {
      // Routine when nothing has accrued yet — log quietly and move on.
      console.warn("[claim] claim attempt failed (will retry):", String(e.message ?? e).slice(0, 160));
    } finally {
      claiming = false;
    }
  };
  setInterval(run, config.claimIntervalMs);
  console.log(`[claim] fee claimer armed — every ${config.claimIntervalMs / 1000}s`);
}

export function startDistributor(): void {
  if (!getMeta("start_anchor")) setMeta("start_anchor", String(Date.now()));
  const tick = () => {
    const delay = nextDistributionAt() - Date.now();
    setTimeout(async () => {
      await runDistribution();
      tick();
    }, delay);
  };
  tick();
  console.log(`[distribute] scheduler armed — every ${config.distributionIntervalMs / 1000}s${config.dryRun ? " (DRY RUN)" : ""}`);
}
