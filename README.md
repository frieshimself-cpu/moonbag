# 💰 $MOONBAG

> **nobody holds anymore. so we pay the ones who do.**

$MOONBAG is a pump.fun token with one mechanic: **100% of pump.fun creator
rewards are redistributed to holders who lock supply — every 5 minutes,
proportional to how much they locked.** Lock 1% of supply and you earn twice
as much per drop as someone who locked 0.5%.

This repo contains the full stack:

| Directory | What it is |
| --- | --- |
| `web/` | The animated marketing + live-stats site (vanilla HTML/CSS/JS, zero build step, Vercel-ready via `vercel.json`) |
| `server/` | TypeScript backend: lock tracking, creator-fee claiming, and the 5-minute distribution engine |

---

## How the mechanic works

1. **Lock** — holders lock $MOONBAG with
   [Streamflow's token-lock](https://app.streamflow.finance/token-lock):
   **non-custodial**, tokens sit in Streamflow's audited on-chain escrow and
   unlock automatically on the date the holder chose. The scanner mirrors
   every Streamflow contract for the mint (decoded against Streamflow's
   published account layout) every ~30 seconds. To qualify, a lock needs a
   duration of at least `MIN_LOCK_HOURS` (24h), and it starts **earning 23
   hours after creation** (`MIN_REWARD_AGE_HOURS`) — so locking right before
   a drop earns nothing. Expired or canceled locks stop earning instantly.
2. **Accrue** — pump.fun pays the token creator a fee on every trade. Fees are
   auto-claimed **every minute** via PumpPortal's local-signing API (keys never
   leave the server); with a split creator/vault setup they're swept to the
   reward wallet each cycle.
3. **Distribute** — every 5 minutes the engine takes the reward wallet's SOL
   (minus a small fee reserve), splits it pro-rata by eligible locked amount,
   and sends SOL straight to each locker's wallet in batched transactions.
   Payouts below the dust threshold carry over until they're worth sending —
   nothing is lost.

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

Run the test suites with `npm test` (engine math + unlock security, 11 checks).
Generate a vault wallet with `npm run vault:new`. **See [RUNBOOK.md](RUNBOOK.md)
for the full launch procedure, including the mandatory dress rehearsal.**

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
| `GET /api/lock-info` | how to lock (Streamflow) + qualifying rules |
| `GET /api/locker/:wallet` | one wallet's Streamflow locks: amounts, status (earning / warming up / too short / inactive), unlock dates |

### Key config (`server/.env`)

| Var | Default | Meaning |
| --- | --- | --- |
| `DISTRIBUTION_INTERVAL_MS` | `300000` | reward cadence (5 min) |
| `MIN_LOCK_HOURS` | `24` | minimum lock per deposit before it can be unlocked |
| `MIN_REWARD_AGE_HOURS` | `23` | a deposit must be locked this long before it starts earning |
| `CLAIM_INTERVAL_MS` | `60000` | creator fees auto-claimed every minute |
| `CREATOR_SECRET_KEY` | – | optional separate creator wallet; fees are swept to the vault each cycle |
| `MIN_DISTRIBUTION_SOL` | `0.01` | skip a round below this pot |
| `RESERVE_SOL` | `0.05` | SOL held back for tx fees |
| `MIN_PAYOUT_LAMPORTS` | `100000` | dust threshold — smaller payouts roll over |
| `DRY_RUN` | `true` | safety switch — nothing is sent while true |

## Honest limitations (read this)

- **Locking is non-custodial** (Streamflow escrow) — the project never holds
  locked tokens. The wallet that IS trusted is the reward wallet: it claims
  creator fees and holds the pot between 5-minute drops. Guard its key.
- Payouts are SOL system transfers batched 8 per transaction; a failed batch
  retries individually and anything still failing returns to the carry
  ledger, so no one's share is lost.
- This is a memecoin experiment, not an investment product. Rewards depend
  entirely on trading volume and may be zero.
