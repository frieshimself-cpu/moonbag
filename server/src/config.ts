import "dotenv/config";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${name}: ${v}`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

/** Parse a secret key given as base58 or a JSON byte array. */
function parseKeypair(raw: string | undefined): Keypair | null {
  if (!raw) return null;
  try {
    const bytes = raw.trim().startsWith("[")
      ? Uint8Array.from(JSON.parse(raw))
      : bs58.decode(raw.trim());
    return Keypair.fromSecretKey(bytes);
  } catch (e) {
    throw new Error(`VAULT_SECRET_KEY could not be parsed (expected base58 string or JSON byte array): ${e}`);
  }
}

export const config = {
  port: num("PORT", 3000),
  rpcUrl: process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com",

  /** $MOONBAG mint address (set after the pump.fun launch). */
  tokenMint: process.env.TOKEN_MINT ?? "",

  /**
   * Vault wallet: where holders send tokens to lock, and where payouts are
   * sent from. If CREATOR_SECRET_KEY is unset, this must also be the
   * pump.fun creator wallet (it then claims creator fees itself).
   */
  vaultKeypair: parseKeypair(process.env.VAULT_SECRET_KEY),

  /**
   * Optional separate pump.fun creator wallet. Set this when the token was
   * created from a different wallet than the vault — e.g. when the creator
   * key was ever exposed and must not hold the locked tokens. Fees are
   * claimed with this key and immediately swept to the vault each cycle,
   * so the exposed wallet never holds more than ~1 minute of fees.
   */
  creatorKeypair: parseKeypair(process.env.CREATOR_SECRET_KEY),

  /** How often rewards are distributed. Every 5 minutes. */
  distributionIntervalMs: num("DISTRIBUTION_INTERVAL_MS", 300_000),

  /** How often the vault token account is scanned for new locks. */
  lockScanIntervalMs: num("LOCK_SCAN_INTERVAL_MS", 30_000),

  /**
   * How often accrued creator fees are claimed into the vault (independent
   * of the distribution cadence). Each claim is an on-chain tx (~0.000005
   * SOL + priority fee), so don't set this below ~30s.
   */
  claimIntervalMs: num("CLAIM_INTERVAL_MS", 60_000),

  /** Skip a round if the distributable pot is below this (SOL). */
  minDistributionSol: num("MIN_DISTRIBUTION_SOL", 0.01),

  /** SOL kept in the vault for transaction fees / rent. Never distributed. */
  reserveSol: num("RESERVE_SOL", 0.05),

  /** Payouts below this many lamports are carried over to the next round. */
  minPayoutLamports: num("MIN_PAYOUT_LAMPORTS", 100_000),

  /** Minimum time a deposit must stay locked before it can be unlocked. */
  minLockHours: num("MIN_LOCK_HOURS", 24),

  /**
   * A deposit must be locked this long before it starts EARNING rewards.
   * Stops lock-right-before-the-drop gaming: fresh locks sit out until aged.
   */
  minRewardAgeHours: num("MIN_REWARD_AGE_HOURS", 23),

  /** Total token supply — pump.fun mints 1B with 6 decimals. */
  totalSupplyRaw: num("TOTAL_SUPPLY_RAW", 1_000_000_000 * 1e6),
  tokenDecimals: num("TOKEN_DECIMALS", 6),

  /**
   * DRY_RUN (default: true) runs the full engine — scanning, accounting,
   * scheduling — but signs/sends nothing. Flip to false only when the
   * mint + vault key are configured and you have verified everything.
   */
  dryRun: bool("DRY_RUN", true),

  /** PumpPortal local-signing endpoint used to build the fee-claim tx. */
  pumpPortalUrl: process.env.PUMPPORTAL_URL ?? "https://pumpportal.fun/api/trade-local",
  priorityFeeSol: num("PRIORITY_FEE_SOL", 0.0001),

  dbPath: process.env.DB_PATH ?? "moonbag.db",
};

export function assertLiveConfig(): void {
  if (config.dryRun) return;
  if (!config.tokenMint) throw new Error("DRY_RUN=false requires TOKEN_MINT");
  if (!config.vaultKeypair) throw new Error("DRY_RUN=false requires VAULT_SECRET_KEY");
}
