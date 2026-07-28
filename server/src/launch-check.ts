/**
 * Launch-day go/no-go probe. Run any time with `npm run launch:check`.
 * Read-only — needs no keys. Checks, against the live chain:
 *   1. the $MOONBAG mint exists (i.e. the coin is deployed)
 *   2. Streamflow lock contracts for the mint (count + totals)
 *   3. the fee wallet's SOL balance
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { config } from "./config.js";
import { STREAMFLOW_PROGRAM, decodeStream } from "./streamflow.js";

const conn = new Connection(config.rpcUrl, "confirmed");
const FEE_WALLET = process.env.FEE_WALLET ?? "GHiMYeqqcLZYcD6Q5qGvNJY3YoUn2pQiutTzNgo2kRf8";
const mint = config.tokenMint;
const now = Math.floor(Date.now() / 1000);

console.log(`── $MOONBAG launch check · ${new Date().toISOString()} ──`);
console.log(`   mint: ${mint || "(TOKEN_MINT not set)"}`);

// 1. mint deployed?
let mintLive = false;
if (mint) {
  try {
    const supply = await conn.getTokenSupply(new PublicKey(mint));
    mintLive = true;
    console.log(`✅ 1. coin is LIVE — supply ${Number(supply.value.amount) / 10 ** supply.value.decimals}`);
  } catch {
    console.log("⏳ 1. coin not deployed yet (mint account not found)");
  }
}

// 2. Streamflow locks
if (mint) {
  try {
    const accs = await conn.getProgramAccounts(STREAMFLOW_PROGRAM, {
      commitment: "confirmed",
      filters: [{ memcmp: { offset: 177, bytes: mint } }],
    });
    const locks = accs.map((a) => decodeStream(a.pubkey.toBase58(), a.account.data as Buffer));
    const active = locks.filter((l) => l.canceledAt === 0 && l.depositedRaw > l.withdrawnRaw && l.endTime > now);
    const total = active.reduce((s, l) => s + l.depositedRaw - l.withdrawnRaw, 0);
    console.log(`✅ 2. Streamflow: ${locks.length} contract(s), ${active.length} active, ${(total / 10 ** config.tokenDecimals).toLocaleString()} tokens locked`);
  } catch (e: any) {
    console.log(`❌ 2. Streamflow scan failed: ${String(e.message ?? e).slice(0, 120)}`);
    console.log("      (public RPC throttles getProgramAccounts — use a Helius RPC_URL)");
  }
}

// 3. fee wallet balance
try {
  const bal = await conn.getBalance(new PublicKey(FEE_WALLET), "confirmed");
  console.log(`${bal > 0 ? "✅" : "⏳"} 3. fee wallet ${FEE_WALLET.slice(0, 6)}… balance: ${(bal / 1e9).toFixed(4)} SOL`);
} catch (e: any) {
  console.log(`❌ 3. balance check failed: ${String(e.message ?? e).slice(0, 120)}`);
}

console.log(mintLive ? "── GO ──" : "── waiting for deploy ──");
