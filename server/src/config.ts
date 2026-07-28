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
   * Vault wallet. Must be the pump.fun *creator* wallet so it can claim
   * creator fees, and it is also the wallet lockers send tokens to.
   */
  vaultKeypair: parseKeypair(process.env.VAULT_SECRET_KEY),

  /** How often rewards are distributed. Thesis says every 2 minutes. */
  distributionIntervalMs: num("DISTRIBUTION_INTERVAL_MS", 120_000),

  /** How often the vault token account is scanned for new locks. */
  lockScanIntervalMs: num("LOCK_SCAN_INTERVAL_MS", 30_000),

  /** Skip a round if the distributable pot is below this (SOL). */
  minDistributionSol: num("MIN_DISTRIBUTION_SOL", 0.01),

  /** SOL kept in the vault for transaction fees / rent. Never distributed. */
  reserveSol: num("RESERVE_SOL", 0.05),

  /** Payouts below this many lamports are carried over to the next round. */
  minPayoutLamports: num("MIN_PAYOUT_LAMPORTS", 100_000),

  /** Minimum time a deposit must stay locked before it can be unlocked. */
  minLockHours: num("MIN_LOCK_HOURS", 24),

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
