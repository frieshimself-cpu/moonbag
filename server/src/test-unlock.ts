/**
 * Unlock-flow verification: 24h minimum lock, FIFO maturity, real ed25519
 * signature checks, replay protection, and the HTTP endpoint end to end
 * (mounted in-process). Run via `npm test`.
 */
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { db } from "./db.js";
import { config } from "./config.js";
import { getLockStatus, unlockMessage, verifyUnlockSignature } from "./unlock.js";
import { buildApp } from "./app.js";

assert.ok(config.dryRun, "unlock tests must run with DRY_RUN=true");

const HOUR = 3600;
const now = Math.floor(Date.now() / 1000);
const holder = Keypair.generate();
const wallet = holder.publicKey.toBase58();
const seed = db.prepare(
  "INSERT INTO locks (wallet, amount_raw, signature, block_time) VALUES (?, ?, ?, ?)"
);

/* ── 1. FIFO maturity: old deposit unlockable, fresh one is not ─ */
seed.run(wallet, 1_000_000, "dep-old", now - 25 * HOUR);   // matured (25h ago)
seed.run(wallet, 500_000, "dep-new", now - 1 * HOUR);      // still locked (1h ago)

let s = getLockStatus(wallet, now);
assert.equal(s.lockedRaw, 1_500_000);
assert.equal(s.unlockableRaw, 1_000_000, "only the 25h-old deposit may unlock");
assert.equal(s.nextUnlockAt, now - 1 * HOUR + config.minLockHours * HOUR);
console.log("✓ 1. 24h minimum enforced per deposit, FIFO, with correct next-unlock time");

/* ── 2. signature verification ─────────────────────────────────── */
const ts = Date.now();
const sign = (msg: string, kp: Keypair) =>
  bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey));

const goodSig = sign(unlockMessage(wallet, 400_000, ts), holder);
assert.ok(verifyUnlockSignature(wallet, 400_000, ts, goodSig), "valid signature must verify");
assert.ok(!verifyUnlockSignature(wallet, 999_999, ts, goodSig), "tampered amount must fail");
const attacker = Keypair.generate();
const forged = sign(unlockMessage(wallet, 400_000, ts), attacker);
assert.ok(!verifyUnlockSignature(wallet, 400_000, ts, forged), "someone else's key must fail");
console.log("✓ 2. ed25519 signatures verified; tampering and forgery rejected");

/* ── 3. HTTP endpoint end to end ───────────────────────────────── */
const server = buildApp().listen(0);
const port = (server.address() as any).port;
const post = (body: any) =>
  fetch(`http://localhost:${port}/api/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// happy path: unlock 400k of the matured 1M
let res = await post({ wallet, amountRaw: 400_000, timestamp: ts, signature: goodSig });
assert.equal(res.status, 200);
let body = await res.json();
assert.equal(body.simulated, true);
s = getLockStatus(wallet, now);
assert.equal(s.lockedRaw, 1_100_000, "ledger must reflect the unlock");
assert.equal(s.unlockableRaw, 600_000, "unlock must consume the oldest deposit first");
console.log("✓ 3. endpoint unlock works; ledger updated, FIFO consumption correct");

/* ── 4. replay of the same signed request is rejected ──────────── */
res = await post({ wallet, amountRaw: 400_000, timestamp: ts, signature: goodSig });
assert.equal(res.status, 409, "replay must be rejected");
console.log("✓ 4. replayed request rejected (409)");

/* ── 5. over-unlock past the matured amount is rejected ────────── */
const ts2 = Date.now() + 1;
const overSig = sign(unlockMessage(wallet, 700_000, ts2), holder);
res = await post({ wallet, amountRaw: 700_000, timestamp: ts2, signature: overSig });
assert.equal(res.status, 400, "unlocking immature tokens must be rejected");
s = getLockStatus(wallet, now);
assert.equal(s.lockedRaw, 1_100_000, "failed request must not change the ledger");
console.log("✓ 5. cannot unlock more than the matured amount");

/* ── 6. bad signature and stale timestamp are rejected ─────────── */
res = await post({ wallet, amountRaw: 100_000, timestamp: ts2, signature: forged });
assert.equal(res.status, 401);
const staleTs = Date.now() - 11 * 60 * 1000;
const staleSig = sign(unlockMessage(wallet, 100_000, staleTs), holder);
res = await post({ wallet, amountRaw: 100_000, timestamp: staleTs, signature: staleSig });
assert.equal(res.status, 400, "stale timestamp must be rejected");
console.log("✓ 6. forged signature (401) and stale timestamp (400) rejected");

/* ── 7. locker status endpoint ─────────────────────────────────── */
res = await fetch(`http://localhost:${port}/api/locker/${wallet}`);
body = await res.json();
assert.equal(body.lockedRaw, 1_100_000);
assert.equal(res.status, 200);
res = await fetch(`http://localhost:${port}/api/locker/not-a-wallet`);
assert.equal(res.status, 400);
console.log("✓ 7. /api/locker/:wallet reports positions; invalid address rejected");

server.close();
console.log("\nALL UNLOCK CHECKS PASSED");
