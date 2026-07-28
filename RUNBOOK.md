# 🚀 $MOONBAG launch runbook

Follow this top to bottom. Steps 1–5 are the dress rehearsal with a throwaway
token — do NOT skip it. Steps 6–8 are the real launch.

## 0. Prerequisites

- A server or VPS with Node 20+ (Railway, Hetzner, DigitalOcean — anything).
- A paid Solana RPC URL (Helius free tier works to start).
- ~0.5 SOL for fees and testing.

## 1. Create the vault wallet

```bash
cd server && npm install && npm run vault:new
```

- Put the printed secret key in `server/.env` as `VAULT_SECRET_KEY`.
- **Never** share the secret key, paste it in chats, or commit it. Anyone who
  has it controls all locked tokens and the reward pot.
- Send ~0.3 SOL to the vault's public key (fees + reserve).

## 2. Configure

In `server/.env`: set `RPC_URL` to your paid RPC, keep `DRY_RUN=true` for now.

## 3. Dress-rehearsal token

- Import the vault secret key into a fresh Phantom profile.
- On pump.fun, create a throwaway token **from the vault wallet** (this is
  what makes the vault the creator, so it earns creator fees).
- Put its mint address in `.env` as `TOKEN_MINT`. Start: `npm run dev`.

## 4. Rehearse the full loop

1. From two OTHER wallets you own, buy a little of the token and send some
   to the vault address → within ~30s both should appear in
   `GET /api/leaderboard` and on the site.
2. Do a few buys/sells to generate creator fees.
3. Set `DRY_RUN=false`, restart, and watch one 5-minute round: the log should
   show a fee claim, then payouts — and both wallets receive SOL in the right
   ratio.
4. Test unlock: it should FAIL (24h minimum). To verify the path end-to-end
   without waiting, temporarily set `MIN_LOCK_HOURS=0`, unlock via the site's
   "your lock" panel, confirm tokens come back, then set it back to `24`.

If all four behave, the machine works with real money. 

## 5. Reset for launch

Stop the server and delete `moonbag.db*` (test-token history must not pollute
the real ledger). Keep the same vault wallet.

## 6. Launch $MOONBAG

- Create the real $MOONBAG on pump.fun **from the vault wallet**.
- Update `TOKEN_MINT` in `.env`, set `DRY_RUN=false`, start the server
  (`npm run build && npm start`, ideally under pm2/systemd so it stays up).

## 7. Point the site at the world

Deploy the server publicly (it serves the site itself). Put the mint address
everywhere; the site picks it up automatically from `/api/stats`.

Two easy options:

**Docker (any host):**
```bash
docker build -t moonbag .
docker run -d --restart unless-stopped -p 3000:3000 \
  -v moonbag-data:/data --env-file server/.env moonbag
```

**Bare Node with pm2 (any VPS):**
```bash
cd server && npm ci && npm run build
npm i -g pm2
pm2 start dist/index.js --name moonbag && pm2 save && pm2 startup
```

Put nginx/Caddy or a Cloudflare tunnel in front for HTTPS and a domain.

## 8. Day-one checklist

- [ ] Vault secret key exists in exactly one place (the server's `.env`).
- [ ] `DRY_RUN=false`, `MIN_LOCK_HOURS=24`, interval 300000.
- [ ] First real locker appears on the leaderboard.
- [ ] First distribution round pays out (check the payout feed + an explorer).
- [ ] Tell holders: lock ONLY from a self-custody wallet, never an exchange.

## Ongoing

- The server must stay running — rounds are skipped while it's down (fees
  keep accruing, nothing is lost; the next round distributes the backlog).
- Watch the vault's SOL reserve; `RESERVE_SOL` is auto-held-back for fees.
- Back up `moonbag.db` periodically (it's the lock ledger).
