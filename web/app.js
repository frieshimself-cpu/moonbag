/* ═══════════════════════════════════════════════════════════════
   $MOONBAG frontend — starfield, countdown, live data
   ═══════════════════════════════════════════════════════════════ */

"use strict";

/* ── starfield ──────────────────────────────────────────────── */

const canvas = document.getElementById("stars");
const ctx = canvas.getContext("2d");
let stars = [];
let shooters = [];
let mouseX = 0.5, mouseY = 0.5;
const DPR = Math.min(window.devicePixelRatio || 1, 2);

function initStars() {
  canvas.width = innerWidth * DPR;
  canvas.height = innerHeight * DPR;
  const count = Math.min(360, Math.floor((innerWidth * innerHeight) / 4200));
  stars = Array.from({ length: count }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    layer: 1 + Math.floor(Math.random() * 3),          // 1 far … 3 near
    r: 0.4 + Math.random() * 1.5,
    tw: Math.random() * Math.PI * 2,                    // twinkle phase
    tws: 0.4 + Math.random() * 1.6,                     // twinkle speed
    hue: Math.random() < 0.08 ? 45 : Math.random() < 0.05 ? 265 : 0,
  }));
}

function spawnShooter() {
  if (document.hidden || shooters.length > 2) return;
  const fromLeft = Math.random() < 0.5;
  shooters.push({
    x: fromLeft ? -60 : Math.random() * canvas.width,
    y: Math.random() * canvas.height * 0.45,
    vx: (5 + Math.random() * 7) * DPR,
    vy: (2 + Math.random() * 3) * DPR,
    life: 1,
  });
}
setInterval(() => Math.random() < 0.4 && spawnShooter(), 3000);

let t0 = performance.now();
function drawStars(now) {
  const dt = Math.min((now - t0) / 1000, 0.05);
  t0 = now;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const offsetX = (mouseX - 0.5) * 30 * DPR;
  const offsetY = (mouseY - 0.5) * 30 * DPR;

  for (const s of stars) {
    s.tw += s.tws * dt;
    const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(s.tw));
    const px = s.x + offsetX * (s.layer / 3);
    const py = s.y + offsetY * (s.layer / 3);
    ctx.beginPath();
    ctx.arc(px, py, s.r * DPR * (s.layer / 2.2), 0, Math.PI * 2);
    ctx.fillStyle = s.hue
      ? `hsla(${s.hue}, 90%, 75%, ${a})`
      : `rgba(255,255,255,${a})`;
    ctx.fill();
  }

  shooters = shooters.filter((sh) => sh.life > 0);
  for (const sh of shooters) {
    sh.x += sh.vx; sh.y += sh.vy; sh.life -= dt * 0.9;
    const grad = ctx.createLinearGradient(sh.x - sh.vx * 9, sh.y - sh.vy * 9, sh.x, sh.y);
    grad.addColorStop(0, "rgba(255,215,94,0)");
    grad.addColorStop(1, `rgba(255,235,180,${Math.max(sh.life, 0)})`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2 * DPR;
    ctx.beginPath();
    ctx.moveTo(sh.x - sh.vx * 9, sh.y - sh.vy * 9);
    ctx.lineTo(sh.x, sh.y);
    ctx.stroke();
  }
  requestAnimationFrame(drawStars);
}
initStars();
requestAnimationFrame(drawStars);
addEventListener("resize", initStars);
addEventListener("mousemove", (e) => {
  mouseX = e.clientX / innerWidth;
  mouseY = e.clientY / innerHeight;
});

/* ── ticker band ────────────────────────────────────────────── */

const phrases = [
  "💰 $MOONBAG", "🔒 LOCK YOUR BAG", "◎ PAID EVERY 5 MINUTES",
  "💎 DIAMOND HANDS ONLY", "📈 CREATOR REWARDS → LOCKERS", "🌕 NOBODY HOLDS ANYMORE",
];
const track = document.getElementById("ticker-track");
track.innerHTML = [...phrases, ...phrases, ...phrases, ...phrases]
  .map((p) => `<span>${p}</span>`).join("");

/* ── scroll reveals ─────────────────────────────────────────── */

const io = new IntersectionObserver(
  (entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }),
  { threshold: 0.15 }
);
document.querySelectorAll(".reveal").forEach((el, i) => {
  el.style.transitionDelay = `${(i % 4) * 90}ms`;
  io.observe(el);
});

/* ── data layer: live API with demo fallback ────────────────── */

const DEMO = {
  stats: {
    intervalMs: 300000,
    nextDistributionAt: null,                 // computed locally
    totalLockedPct: 23.7,
    lockers: 142,
    totalDistributedSol: 87.4,
    totalPayouts: 9210,
    dryRun: true,
    tokenMint: null,
  },
  leaderboard: Array.from({ length: 10 }, (_, i) => {
    const locked = [31.2, 22.8, 14.1, 9.6, 7.4, 5.2, 3.9, 2.7, 1.9, 1.2][i];
    return {
      rank: i + 1,
      wallet: randWallet(),
      lockedTokens: locked * 1e6,
      supplyPct: locked / 10,
      shareOfPot: locked,
    };
  }),
};

function randWallet() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789";
  const pick = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${pick(4)}…${pick(4)}`;
}

let live = false;
let state = { ...DEMO.stats };

// API base: "" = same origin (backend serves the site, or Vercel rewrite);
// a full URL = direct cross-origin calls to the backend. See config.js.
const API_BASE = (window.MOONBAG_API_BASE || "").replace(/\/+$/, "");

async function fetchJSON(path) {
  const res = await fetch(API_BASE + path, { cache: "no-store" });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

async function refresh() {
  try {
    const stats = await fetchJSON("/api/stats");
    live = true;
    state = stats;
    renderStats(stats);
    renderLeaderboard(await fetchJSON("/api/leaderboard"));
    renderFeed(await fetchJSON("/api/payouts"));
    if (stats.tokenMint) setMint(stats.tokenMint);
    document.getElementById("cd-mode").textContent = stats.dryRun ? "· SIMULATION MODE ·" : "· LIVE ON-CHAIN ·";
  } catch {
    if (!live) {
      renderStats(DEMO.stats);
      renderLeaderboard(DEMO.leaderboard);
      document.getElementById("cd-mode").textContent = "· PREVIEW — LAUNCHING SOON ·";
    }
  }
}
refresh();
setInterval(refresh, 10000);

/* ── countdown ring ─────────────────────────────────────────── */

const RING_LEN = 2 * Math.PI * 88;
const cdProgress = document.getElementById("cd-progress");
const cdTime = document.getElementById("cd-time");
cdProgress.style.strokeDasharray = RING_LEN;

function tickCountdown() {
  const interval = state.intervalMs || 300000;
  const next = state.nextDistributionAt || Math.ceil(Date.now() / interval) * interval;
  let remain = next - Date.now();
  if (remain <= 0) {
    // roll to the next epoch; server value refreshes on next poll
    state.nextDistributionAt = Math.ceil((Date.now() + 1000) / interval) * interval;
    remain = state.nextDistributionAt - Date.now();
    flashDrop();
  }
  const frac = remain / interval;
  cdProgress.style.strokeDashoffset = RING_LEN * (1 - frac);
  const m = Math.floor(remain / 60000);
  const s = Math.floor((remain % 60000) / 1000);
  cdTime.textContent = `${m}:${String(s).padStart(2, "0")}`;
}
setInterval(tickCountdown, 250);
tickCountdown();

function flashDrop() {
  cdTime.style.transition = "none";
  cdTime.style.transform = "scale(1.25)";
  cdTime.style.color = "#4ef0a8";
  setTimeout(() => {
    cdTime.style.transition = "transform 0.6s, color 0.6s";
    cdTime.style.transform = "scale(1)";
    cdTime.style.color = "";
  }, 120);
  if (!live) pushDemoPayouts();
}

/* ── animated counters ──────────────────────────────────────── */

const shown = {};
function tween(id, target, decimals = 0) {
  const el = document.getElementById(id);
  if (!el) return;
  const from = shown[id] ?? 0;
  if (Math.abs(from - target) < 1e-9) return;
  const start = performance.now();
  const dur = 1200;
  function frame(now) {
    const p = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = from + (target - from) * eased;
    el.textContent = val.toLocaleString("en-US", {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    });
    if (p < 1) requestAnimationFrame(frame);
    else shown[id] = target;
  }
  requestAnimationFrame(frame);
}

function renderStats(s) {
  tween("stat-locked", s.totalLockedPct ?? 0, 1);
  tween("stat-lockers", s.lockers ?? 0);
  tween("stat-sol", s.totalDistributedSol ?? 0, 1);
  tween("stat-payouts", s.totalPayouts ?? 0);
  document.getElementById("locked-bar").style.width = `${Math.min(s.totalLockedPct ?? 0, 100)}%`;
}

/* ── leaderboard ────────────────────────────────────────────── */

function renderLeaderboard(rows) {
  const body = document.getElementById("board-body");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--ink-dim);padding:30px">no lockers yet — be the first 🔒</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((r) => `
    <tr class="rank-${r.rank}">
      <td>${r.rank}</td>
      <td>${r.wallet}</td>
      <td>${fmtTokens(r.lockedTokens)}</td>
      <td class="pct">${r.supplyPct.toFixed(2)}%</td>
      <td class="cut">${r.shareOfPot.toFixed(2)}%</td>
    </tr>`).join("");
}

function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

/* ── payout feed ────────────────────────────────────────────── */

const feed = document.getElementById("feed");
const feedItems = [];

function renderFeed(payouts) {
  if (!payouts.length) {
    feed.innerHTML = `<div class="feed-item"><span class="fw">waiting for the first drop…</span><span class="fa">🌕</span></div>`;
    return;
  }
  feed.innerHTML = payouts.map((p) => feedRow(p.wallet, p.sol, p.at * 1000, p.status)).join("");
}

function feedRow(wallet, sol, atMs, status) {
  const ago = timeAgo(atMs);
  const tag = status === "simulated" ? " (sim)" : "";
  return `<div class="feed-item">
    <span class="fw">${wallet}</span>
    <span class="fa">+${sol.toFixed(4)} ◎${tag}</span>
    <span class="ft">${ago}</span>
  </div>`;
}

function pushDemoPayouts() {
  const n = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    feedItems.unshift({ wallet: randWallet(), sol: 0.002 + Math.random() * 0.08, at: Date.now() });
  }
  feedItems.length = Math.min(feedItems.length, 30);
  feed.innerHTML = feedItems.map((p) => feedRow(p.wallet, p.sol, p.at, "demo")).join("");
}
if (feed) pushDemoPayouts();

function timeAgo(ms) {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/* ── cut calculator ─────────────────────────────────────────── */

const youSlider = document.getElementById("calc-slider");
const othersSlider = document.getElementById("calc-others-slider");

function updateCalc() {
  const you = youSlider.value / 100;               // % of supply you lock
  const others = Number(othersSlider.value);       // % of supply others lock
  const share = you / (you + others);
  document.getElementById("calc-you").textContent = you.toFixed(2) + "%";
  document.getElementById("calc-others").textContent = others + "%";
  document.getElementById("calc-share").textContent = (share * 100).toFixed(2) + "%";
  document.getElementById("calc-sol").textContent = share.toFixed(4) + " ◎";
}
youSlider.addEventListener("input", updateCalc);
othersSlider.addEventListener("input", updateCalc);
updateCalc();

/* ── mint address / copy ────────────────────────────────────── */

function setMint(mint) {
  document.getElementById("mint-address").textContent = mint;
  const url = `https://pump.fun/coin/${mint}`;
  for (const id of ["nav-buy", "hero-buy", "footer-buy"]) {
    document.getElementById(id).href = url;
  }
}

/* ── wallet connect + self-serve unlock ─────────────────────── */

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(bytes) {
  let digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      const x = digits[i] * 256 + carry;
      digits[i] = x % 58;
      carry = Math.floor(x / 58);
    }
    while (carry) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  let out = "";
  for (const byte of bytes) { if (byte === 0) out += "1"; else break; }
  for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]];
  return out;
}

const walletBtn = document.getElementById("wallet-btn");
const manageBody = document.getElementById("manage-body");
const manageMsg = document.getElementById("manage-msg");
let connectedWallet = null;

function setMsg(text, cls = "") {
  manageMsg.textContent = text;
  manageMsg.className = "manage-msg " + cls;
}

async function refreshPosition() {
  if (!connectedWallet) return;
  try {
    const pos = await fetchJSON(`/api/locker/${connectedWallet}`);
    document.getElementById("m-locked").textContent = fmtTokens(pos.lockedTokens);
    document.getElementById("m-unlockable").textContent = fmtTokens(pos.unlockableTokens);
    document.getElementById("m-next").textContent = pos.nextUnlockAt
      ? new Date(pos.nextUnlockAt * 1000).toLocaleString()
      : pos.lockedRaw > 0 ? "all matured" : "—";
  } catch {
    setMsg("backend unreachable — position unavailable in preview", "err");
  }
}

walletBtn.addEventListener("click", async () => {
  const provider = window.solana;
  if (!provider || !provider.isPhantom) {
    setMsg("no Solana wallet found — install Phantom to manage your lock", "err");
    manageBody.hidden = false;
    return;
  }
  try {
    const resp = await provider.connect();
    connectedWallet = resp.publicKey.toString();
    walletBtn.textContent = `${connectedWallet.slice(0, 4)}…${connectedWallet.slice(-4)}`;
    manageBody.hidden = false;
    setMsg("");
    refreshPosition();
    setInterval(refreshPosition, 15000);
  } catch {
    setMsg("wallet connection cancelled", "err");
  }
});

document.getElementById("unlock-btn").addEventListener("click", async () => {
  if (!connectedWallet) { setMsg("connect your wallet first", "err"); return; }
  const tokens = parseFloat(document.getElementById("unlock-amount").value);
  if (!tokens || tokens <= 0) { setMsg("enter an amount to unlock", "err"); return; }
  const amountRaw = Math.round(tokens * 1e6); // pump.fun tokens have 6 decimals
  const timestamp = Date.now();
  const message = `MOONBAG_UNLOCK:${connectedWallet}:${amountRaw}:${timestamp}`;
  try {
    setMsg("sign the message in your wallet… (free — it's not a transaction)");
    const signed = await window.solana.signMessage(new TextEncoder().encode(message), "utf8");
    const signature = base58Encode(signed.signature);
    const res = await fetch(API_BASE + "/api/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: connectedWallet, amountRaw, timestamp, signature }),
    });
    const body = await res.json();
    if (!res.ok) { setMsg(body.error || "unlock failed", "err"); return; }
    setMsg(body.simulated
      ? "unlock accepted (simulation mode — no tokens moved)"
      : `unlocked! tx: ${body.txSignature.slice(0, 16)}…`, "ok");
    refreshPosition();
  } catch (e) {
    setMsg("signing cancelled or failed", "err");
  }
});

document.getElementById("copy-mint").addEventListener("click", () => {
  const text = document.getElementById("mint-address").textContent;
  if (!text || text.startsWith("launching")) return;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("copy-mint");
    btn.textContent = "✓";
    setTimeout(() => (btn.textContent = "⧉"), 1200);
  });
});
