/**
 * One-command project setup — run on the machine that will host the engine:
 *
 *   npm run setup
 *
 * Creates server/.env from .env.example (if missing), generates the vault
 * keypair, and writes the secret key straight into .env so it never has to
 * pass through a chat, clipboard manager, or anything else. Prints ONLY the
 * public address plus your next steps. Safe to re-run: it never overwrites
 * an existing key or mint.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(serverDir, ".env");
const examplePath = path.join(serverDir, ".env.example");

if (!fs.existsSync(envPath)) {
  fs.copyFileSync(examplePath, envPath);
  console.log("• created server/.env from .env.example");
}

let env = fs.readFileSync(envPath, "utf8");
const get = (key: string) => env.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim() ?? "";
const set = (key: string, value: string) => {
  env = env.match(new RegExp(`^${key}=`, "m"))
    ? env.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`)
    : env + `\n${key}=${value}\n`;
};

let vaultPublic: string;
if (get("VAULT_SECRET_KEY")) {
  const raw = get("VAULT_SECRET_KEY");
  const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw);
  vaultPublic = Keypair.fromSecretKey(bytes).publicKey.toBase58();
  console.log("• vault key already present in .env — keeping it");
} else {
  const kp = Keypair.generate();
  set("VAULT_SECRET_KEY", bs58.encode(kp.secretKey));
  vaultPublic = kp.publicKey.toBase58();
  console.log("• generated a fresh vault keypair and wrote it into server/.env");
}

fs.writeFileSync(envPath, env);
try { fs.chmodSync(envPath, 0o600); } catch { /* best effort on non-POSIX */ }

console.log(`
──────────────────────────────────────────────────────────────
  VAULT ADDRESS (public — share freely, this is the lock address):

    ${vaultPublic}

  Next steps:
    1. Send ~0.3 SOL to the address above (tx fees + reserve).
    2. Create the token on pump.fun FROM this wallet (import the
       key from server/.env into a fresh Phantom profile).
    3. Put the mint address in server/.env as TOKEN_MINT.
    4. Set RPC_URL to a paid RPC (e.g. Helius free tier).
    5. Rehearse per RUNBOOK.md step 4, then set DRY_RUN=false.

  The secret key lives ONLY in server/.env (chmod 600).
  Never paste it anywhere — anyone who has it controls all
  locked tokens and the reward pot.
──────────────────────────────────────────────────────────────
`);
