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

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** Derive the vault's associated token account for the $MOONBAG mint. */
export function vaultTokenAccount(vault: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [vault.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID
  );
  return ata;
}

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
 * Claim pump.fun creator fees into the vault wallet using PumpPortal's
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
