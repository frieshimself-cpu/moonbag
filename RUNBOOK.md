# 🚀 $MOONBAG launch runbook

Follow this top to bottom. Steps 1–5 are the dress rehearsal with a throwaway
token — do NOT skip it. Steps 6–8 are the real launch.

## 0. Prerequisites

- A server or VPS with Node 20+ (Railway, Hetzner, DigitalOcean — anything).
- A paid Solana RPC URL (Helius free tier works to start).
- ~0.5 SOL for fees and testing.

## 1. Create the vault wallet

```bash
cd server && npm install && npm run setup
```

This creates `server/.env`, generates the vault keypair, and writes the
secret key directly into it — the key never appears on screen or leaves the
machine. It prints the vault's PUBLIC address and your next steps.

- **Never** share the secret key, paste it in chats, or commit it. Anyone who
  has it controls all locked tokens and the reward pot. Even a "throwaway"
  wallet stops being throwaway the moment other people's tokens are locked
  in it.
- Send ~0.3 SOL to the printed vault address (fees + reserve).

## 2. Configure

In `server/.env`: set `RPC_URL` to your paid RPC, keep `DRY_RUN=true` for now.
(`npm run vault:new` still exists if you prefer generating a keypair manually.)

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
3. For the rehearsal ONLY, set `MIN_REWARD_AGE_HOURS=0` (otherwise you'd
   wait 23h for your test locks to start earning). Set `DRY_RUN=false`,
   restart, and watch one 5-minute round: the log should show a fee claim,
   then payouts — and both wallets receive SOL in the right ratio.
4. Test unlock: with `MIN_LOCK_HOURS=24` it should FAIL. To verify the path
   end-to-end without waiting, temporarily set `MIN_LOCK_HOURS=0`, unlock via
   the site's "your lock" panel, and confirm tokens come back.
5. Restore `MIN_REWARD_AGE_HOURS=23` and `MIN_LOCK_HOURS=24` afterwards.

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

**Website on Vercel (optional, recommended):**

The engine cannot run on Vercel (serverless platforms can't run a 24/7
payout loop), but the website can — Vercel gives you free hosting, HTTPS,
and a domain, while the engine runs on your server/Docker host.

1. Import this repo into Vercel (it auto-detects `vercel.json`; the site is
   the `web/` folder, no build step).
2. Deploy your backend somewhere with a public URL (step above).
3. In `vercel.json`, replace `YOUR-BACKEND-URL-HERE` with that URL and
   redeploy — the site proxies `/api/*` to your engine. (Alternative: set
   the URL in `web/config.js` instead; the backend already sends CORS
   headers, both routes work.)
4. Until the backend URL is set, the Vercel site runs in demo/preview
   mode — safe to deploy early for the marketing page.

## 8. Day-one checklist

- [ ] Vault secret key exists in exactly one place (the server's `.env`).
- [ ] `DRY_RUN=false`, `MIN_LOCK_HOURS=24`, `MIN_REWARD_AGE_HOURS=23`,
      interval 300000. NOTE: the first drops happen ~23h after the first
      locks — that's the age gate working, tell your community up front.
- [ ] If the creator wallet's key was EVER exposed (pasted in a chat,
      screenshotted, etc.): put it in `CREATOR_SECRET_KEY`, generate a clean
      `VAULT_SECRET_KEY` with `npm run setup`, and publish the CLEAN vault
      address as the lock address. Fees sweep to the vault automatically;
      the exposed wallet never holds locks.
- [ ] First real locker appears on the leaderboard.
- [ ] First distribution round pays out (check the payout feed + an explorer).
- [ ] Tell holders: lock ONLY from a self-custody wallet, never an exchange.

## Ongoing

- The server must stay running — rounds are skipped while it's down (fees
  keep accruing, nothing is lost; the next round distributes the backlog).
- Watch the vault's SOL reserve; `RESERVE_SOL` is auto-held-back for fees.
- Back up `moonbag.db` periodically (it's the lock ledger).
