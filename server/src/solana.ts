import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { config } from "./config.js";

export const connection = new Connection(config.rpcUrl, "confirmed");

export async function getVaultSolBalance(vault: PublicKey): Promise<number> {
  return connection.getBalance(vault, "confirmed");
}

/**
 * Send a batch of SOL transfers from the vault. Returns the signature.
 * Batches are kept small (<= 8 transfers) to stay under the tx size limit.
 */
export async function sendSolBatch(
  vault: Keypair,
  transfers: { to: string; lamports: number }[]
): Promise<string> {
  const tx = new Transaction();
  for (const t of transfers) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: vault.publicKey,
        toPubkey: new PublicKey(t.to),
        lamports: t.lamports,
      })
    );
  }
  return sendAndConfirmTransaction(connection, tx, [vault], {
    commitment: "confirmed",
    maxRetries: 3,
  });
}

/**
 * Sweep a wallet's SOL to the vault, keeping a small buffer for future
 * claim-transaction fees. Used when the pump.fun creator wallet is separate
 * from the vault: claimed fees move to the vault within the same cycle.
 */
export async function sweepSolToVault(from: Keypair, vault: PublicKey): Promise<string | null> {
  const balance = await connection.getBalance(from.publicKey, "confirmed");
  const keep = 5_000_000; // 0.005 SOL stays behind for claim tx fees
  const amount = balance - keep;
  if (amount < 1_000_000) return null; // nothing meaningful to sweep
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: vault, lamports: amount })
  );
  return sendAndConfirmTransaction(connection, tx, [from], {
    commitment: "confirmed",
    maxRetries: 3,
  });
}

/**
 * Claim pump.fun creator fees into the claiming wallet using PumpPortal's
 * local-signing API: the transaction is built remotely but signed locally,
 * so the secret key never leaves this server.
 */
export async function claimCreatorFees(vault: Keypair): Promise<string | null> {
  const res = await fetch(config.pumpPortalUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: vault.publicKey.toBase58(),
      action: "collectCreatorFee",
      priorityFee: config.priorityFeeSol,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PumpPortal ${res.status}: ${body.slice(0, 200)}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const tx = VersionedTransaction.deserialize(bytes);
  tx.sign([vault]);
  const sig = await connection.sendTransaction(tx, { maxRetries: 3 });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

export { LAMPORTS_PER_SOL, PublicKey };
