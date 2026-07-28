# 💰 $MOONBAG

> **nobody holds anymore. so we pay the ones who do.**

$MOONBAG is a pump.fun token with one mechanic: **100% of pump.fun creator
rewards are redistributed to holders who lock supply — every 2 minutes,
proportional to how much they locked.** Lock 1% of supply and you earn twice
as much per drop as someone who locked 0.5%.

This repo contains the full stack:

| Directory | What it is |
| --- | --- |
| `web/` | The animated marketing + live-stats site (vanilla HTML/CSS/JS, zero build step) |
| `server/` | TypeScript backend: lock tracking, creator-fee claiming, and the 2-minute distribution engine |

---

## How the mechanic works

1. **Lock** — a holder sends $MOONBAG to the vault wallet. The scanner watches
   the vault's token account on-chain and credits the *sending* wallet with the
   locked amount within ~30 seconds. Sending more later adds to the position.
   Tokens the vault sends back are recorded as unlocks.
2. **Accrue** — pump.fun pays the token creator a fee on every trade. The vault
   wallet *is* the creator wallet, so before each round it claims accrued
   creator fees (via PumpPortal's local-signing API — the key never leaves the
   server).
3. **Distribute** — every 2 minutes the engine takes the vault's SOL balance
   (minus a small fee reserve), splits it pro-rata by locked amount, and sends
   SOL straight to each locker's wallet in batched transactions. Payouts below
   the dust threshold carry over until they're worth sending — nothing is lost.

```
your locked bag ÷ all locked bags = your cut of every drop
```

## Running it

```bash
cd server
npm install
cp .env.example .env   # fill in after launch — runs fine empty
npm run dev            # http://localhost:3000  (site + API)
```

Out of the box the server runs in **DRY_RUN** mode: the full engine runs
(scheduling, accounting, API) but no transactions are signed or sent, and the
site shows simulated data. To go live:

1. Launch the token on pump.fun **from the vault wallet** (it must be the
   creator wallet to claim creator fees).
2. Set `TOKEN_MINT` and `VAULT_SECRET_KEY` in `server/.env`.
3. Use a paid RPC (`RPC_URL`) — the lock scanner parses transactions and will
   rate-limit on the public endpoint.
4. Set `DRY_RUN=false` and restart.

### API

| Endpoint | Returns |
| --- | --- |
| `GET /api/stats` | totals, next-drop timestamp, mode |
| `GET /api/leaderboard` | top 25 lockers with supply % and pot share |
| `GET /api/payouts` | 30 most recent payouts |
| `GET /api/lock-info` | vault address + how to lock |

### Key config (`server/.env`)

| Var | Default | Meaning |
| --- | --- | --- |
| `DISTRIBUTION_INTERVAL_MS` | `120000` | reward cadence (2 min) |
| `MIN_DISTRIBUTION_SOL` | `0.01` | skip a round below this pot |
| `RESERVE_SOL` | `0.05` | SOL held back for tx fees |
| `MIN_PAYOUT_LAMPORTS` | `100000` | dust threshold — smaller payouts roll over |
| `DRY_RUN` | `true` | safety switch — nothing is sent while true |

## Honest limitations (read this)

- **v1 locking is custodial.** Locked tokens sit in the vault wallet, so
  lockers are trusting whoever holds the vault key. The trust-minimized
  upgrade path is an on-chain escrow program (Anchor) where locks are
  non-custodial PDAs — the accounting in this backend maps 1:1 onto that.
- Payouts are SOL system transfers batched 8 per transaction; a failed batch
  is automatically returned to the carry ledger so no one's share is lost.
- This is a memecoin experiment, not an investment product. Rewards depend
  entirely on trading volume and may be zero.
