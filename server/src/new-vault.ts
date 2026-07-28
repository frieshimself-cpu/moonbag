/**
 * Generate a fresh vault keypair for launch. Run ON YOUR OWN MACHINE/SERVER:
 *   npm run vault:new
 *
 * Prints the public key (share freely) and the secret key (NEVER share it,
 * never commit it — put it straight into server/.env as VAULT_SECRET_KEY).
 * This wallet must be the one that creates the token on pump.fun, so it can
 * claim creator fees.
 */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const kp = Keypair.generate();
console.log("─".repeat(64));
console.log("VAULT PUBLIC KEY (this is the lock address, safe to publish):");
console.log("  " + kp.publicKey.toBase58());
console.log();
console.log("VAULT SECRET KEY (put in server/.env as VAULT_SECRET_KEY — SECRET):");
console.log("  " + bs58.encode(kp.secretKey));
console.log("─".repeat(64));
console.log("⚠️  Anyone with the secret key controls all locked tokens and the pot.");
console.log("⚠️  Launch the pump.fun token FROM this wallet so it earns creator fees.");
