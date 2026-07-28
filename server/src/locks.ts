import { PublicKey, type ParsedInstruction, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { config } from "./config.js";
import { db, getMeta, setMeta } from "./db.js";
import { connection, vaultTokenAccount } from "./solana.js";

const insertLock = db.prepare(
  `INSERT OR IGNORE INTO locks (wallet, amount_raw, signature, slot, block_time)
   VALUES (?, ?, ?, ?, ?)`
);

/**
 * Locking model (v1, no custom program):
 *   - A holder locks by sending $MOONBAG to the vault's token account.
 *   - The sender's wallet (the transfer authority) is credited with the amount.
 *   - Tokens sent FROM the vault back to a holder are recorded as an unlock.
 *
 * The scanner walks the vault token account's signature history, newest to
 * oldest, stopping at the last signature it has already processed.
 */
export async function scanLocks(): Promise<number> {
  if (!config.tokenMint || !config.vaultKeypair) return 0;

  const vault = config.vaultKeypair.publicKey;
  const mint = new PublicKey(config.tokenMint);
  const ata = vaultTokenAccount(vault, mint);
  const lastSeen = getMeta("last_lock_signature");

  // Collect EVERY signature newer than lastSeen, paginating backwards so a
  // burst of >1000 deposits between scans can never be silently skipped.
  const sigs: Awaited<ReturnType<typeof connection.getSignaturesForAddress>> = [];
  let before: string | undefined;
  for (;;) {
    const page = await connection.getSignaturesForAddress(
      ata,
      { until: lastSeen ?? undefined, before, limit: 1000 },
      "confirmed"
    );
    sigs.push(...page);
    if (page.length < 1000 || sigs.length >= 20_000) break;
    before = page[page.length - 1].signature;
  }
  if (sigs.length === 0) return 0;

  // Process oldest-first so a crash mid-scan never skips transactions.
  let recorded = 0;
  for (const sigInfo of [...sigs].reverse()) {
    if (!sigInfo.err) {
      const tx = await connection.getParsedTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      if (tx) recorded += recordTransfersFromTx(tx, sigInfo.signature, ata, vault);
    }
    setMeta("last_lock_signature", sigInfo.signature);
  }
  return recorded;
}

function recordTransfersFromTx(
  tx: ParsedTransactionWithMeta,
  signature: string,
  vaultAta: PublicKey,
  vault: PublicKey
): number {
  const instructions = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions),
  ];

  let recorded = 0;
  const seen = new Map<string, number>(); // occurrence counter per (sig, source)
  for (const ix of instructions) {
    const parsed = (ix as ParsedInstruction).parsed;
    if (!parsed || (ix as ParsedInstruction).program !== "spl-token") continue;
    if (parsed.type !== "transfer" && parsed.type !== "transferChecked") continue;

    const info = parsed.info;
    const amountRaw = Number(info.tokenAmount?.amount ?? info.amount ?? 0);
    if (!Number.isFinite(amountRaw) || amountRaw <= 0) continue;
    if (parsed.type === "transferChecked" && info.mint && info.mint !== config.tokenMint) continue;

    const authority: string | undefined = info.authority ?? info.multisigAuthority;

    if (info.destination === vaultAta.toBase58() && authority && authority !== vault.toBase58()) {
      // Deposit into the vault → lock credited to the sender. The occurrence
      // suffix keeps two same-source transfers in one tx from colliding,
      // while first occurrences keep the plain key (stable across rescans).
      const base = `${signature}:${info.source}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      insertLock.run(authority, amountRaw, n === 0 ? base : `${base}#${n}`, tx.slot, tx.blockTime ?? null);
      recorded++;
    } else if (info.source === vaultAta.toBase58() && authority === vault.toBase58()) {
      // Vault sending tokens back → unlock. Attribute to destination owner
      // when resolvable from token balance metadata.
      const owner = resolveOwner(tx, info.destination);
      if (owner) {
        insertLock.run(owner, -amountRaw, `${signature}:${info.destination}`, tx.slot, tx.blockTime ?? null);
        recorded++;
      }
    }
  }
  return recorded;
}

function resolveOwner(tx: ParsedTransactionWithMeta, tokenAccount: string): string | null {
  const keys = tx.transaction.message.accountKeys;
  const index = keys.findIndex((k) => k.pubkey.toBase58() === tokenAccount);
  if (index === -1) return null;
  const balances = [...(tx.meta?.postTokenBalances ?? []), ...(tx.meta?.preTokenBalances ?? [])];
  return balances.find((b) => b.accountIndex === index)?.owner ?? null;
}

let scanning = false;

export function startLockScanner(): void {
  if (!config.tokenMint || !config.vaultKeypair) {
    console.log("[locks] TOKEN_MINT/VAULT_SECRET_KEY not set — lock scanner idle");
    return;
  }
  const run = async () => {
    if (scanning) return; // a slow RPC must not cause overlapping scans
    scanning = true;
    try {
      const n = await scanLocks();
      if (n > 0) console.log(`[locks] recorded ${n} lock event(s)`);
    } catch (e: any) {
      console.error("[locks] scan failed:", e.message ?? e);
    } finally {
      scanning = false;
    }
  };
  run();
  setInterval(run, config.lockScanIntervalMs);
}
