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
  "💰 $MOONBAG", "🔒 LOCKED ON STREAMFLOW", "◎ PAID EVERY 5 MINUTES",
  "🛡 NON-CUSTODIAL", "💎 DIAMOND HANDS ONLY", "📈 CREATOR REWARDS → LOCKERS",
  "🌕 NOBODY HOLDS ANYMORE",
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
    const mint = stats.tokenMint || window.MOONBAG_TOKEN_MINT;
    if (mint) setMint(mint);
    document.getElementById("cd-mode").textContent = stats.dryRun ? "· SIMULATION MODE ·" : "· LIVE ON-CHAIN ·";
  } catch {
    if (!live) {
      renderStats(DEMO.stats);
      renderLeaderboard(DEMO.leaderboard);
      document.getElementById("cd-mode").textContent = "· PREVIEW — LAUNCHING SOON ·";
    }
  }
}
if (window.MOONBAG_TOKEN_MINT) setMint(window.MOONBAG_TOKEN_MINT);
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
    // roll forward from the anchored schedule; server refreshes on next poll
    let rolled = next;
    while (rolled <= Date.now()) rolled += interval;
    state.nextDistributionAt = rolled;
    remain = rolled - Date.now();
    flashDrop();
  }
  const frac = remain / interval;
  cdProgress.style.strokeDashoffset = RING_LEN * (1 - frac);
  positionTip(frac);
  const m = Math.floor(remain / 60000);
  const s = Math.floor((remain % 60000) / 1000);
  cdTime.textContent = `${m}:${String(s).padStart(2, "0")}`;
}
setInterval(tickCountdown, 250);
tickCountdown();

function flashDrop() {
  dropBurst();
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
      <td class="cut">${r.earning === false ? "⏳ warming up" : r.shareOfPot.toFixed(2) + "%"}</td>
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

/* ── position checker (Streamflow locks, read-only) ─────────── */

const walletBtn = document.getElementById("wallet-btn");
const manageBody = document.getElementById("manage-body");
const manageMsg = document.getElementById("manage-msg");
const addressInput = document.getElementById("position-address");

function setMsg(text, cls = "") {
  manageMsg.textContent = text;
  manageMsg.className = "manage-msg " + cls;
}

async function checkPosition(address) {
  if (!address || address.length < 32) {
    setMsg("paste a valid Solana wallet address", "err");
    return;
  }
  try {
    setMsg("reading locks from the chain…");
    const pos = await fetchJSON(`/api/locker/${address}`);
    manageBody.hidden = false;
    document.getElementById("m-locked").textContent = fmtTokens(pos.lockedTokens);
    document.getElementById("m-earning").textContent = fmtTokens(pos.earningTokens);
    document.getElementById("m-contracts").textContent = pos.contracts.length;
    const list = document.getElementById("contract-list");
    if (!pos.contracts.length) {
      list.innerHTML = `<div class="contract-row"><span class="c-date">no Streamflow locks found for this wallet — lock at app.streamflow.finance/token-lock</span></div>`;
    } else {
      list.innerHTML = pos.contracts.map((c) => {
        const cls = c.status === "earning" ? "earning" : c.status === "warming up" ? "warming" : "inactive";
        const label = c.status === "warming up" && c.startsEarningAt
          ? `warming up · earns ${new Date(c.startsEarningAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : c.status;
        return `<div class="contract-row">
          <span class="c-amt">${fmtTokens(c.lockedTokens)} 💰</span>
          <span class="chip ${cls}">${label}</span>
          <span class="c-date">unlocks ${new Date(c.unlocksAt * 1000).toLocaleDateString()}</span>
        </div>`;
      }).join("");
    }
    setMsg("");
  } catch {
    setMsg("backend unreachable — try again once the site is live", "err");
  }
}

document.getElementById("check-btn").addEventListener("click", () => checkPosition(addressInput.value.trim()));
addressInput.addEventListener("keydown", (e) => e.key === "Enter" && checkPosition(addressInput.value.trim()));

walletBtn.addEventListener("click", async () => {
  const provider = window.solana;
  if (!provider || !provider.isPhantom) {
    setMsg("no Solana wallet found — install Phantom, or just paste your address above", "err");
    return;
  }
  try {
    const resp = await provider.connect();
    const wallet = resp.publicKey.toString();
    addressInput.value = wallet;
    walletBtn.textContent = `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
    checkPosition(wallet);
  } catch {
    setMsg("wallet connection cancelled", "err");
  }
});

/* ── high-effort extras: tilt, burst, progress, parallax ────── */

// 3D tilt + pointer glare on cards
const finePointer = matchMedia("(pointer: fine)").matches;
if (finePointer) {
  for (const card of document.querySelectorAll(".tilt")) {
    card.addEventListener("mousemove", (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      card.style.transform =
        `perspective(900px) rotateY(${(px - 0.5) * 8}deg) rotateX(${(0.5 - py) * 8}deg) translateY(-4px)`;
      card.style.setProperty("--gx", `${px * 100}%`);
      card.style.setProperty("--gy", `${py * 100}%`);
    });
    card.addEventListener("mouseleave", () => { card.style.transform = ""; });
  }
}

// nav scroll progress
const navProgress = document.getElementById("nav-progress");
addEventListener("scroll", () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  navProgress.style.width = `${max > 0 ? (scrollY / max) * 100 : 0}%`;
}, { passive: true });

// comet dot riding the countdown ring (looked up lazily — tickCountdown
// runs before this section of the script on first paint)
function positionTip(frac) {
  const el = document.getElementById("cd-tip");
  if (!el) return;
  const angle = -Math.PI / 2 + (1 - frac) * 2 * Math.PI;
  const wrap = el.parentElement.getBoundingClientRect();
  const R = (wrap.width / 200) * 88;
  el.style.left = `${wrap.width / 2 + R * Math.cos(angle) - 7}px`;
  el.style.top = `${wrap.width / 2 + R * Math.sin(angle) - 7}px`;
}

// gold burst when a drop fires
function dropBurst() {
  const burstLayer = document.getElementById("burst");
  if (!burstLayer) return;
  const glyphs = ["◎", "💰", "✦", "◎", "✦"];
  for (let i = 0; i < 26; i++) {
    const s = document.createElement("span");
    const angle = (i / 26) * 2 * Math.PI + Math.random() * 0.4;
    const dist = 90 + Math.random() * 110;
    s.textContent = glyphs[i % glyphs.length];
    s.style.setProperty("--bx", `${Math.cos(angle) * dist}px`);
    s.style.setProperty("--by", `${Math.sin(angle) * dist}px`);
    s.style.setProperty("--br", `${(Math.random() - 0.5) * 240}deg`);
    s.style.color = i % 3 ? "#ffd75e" : "#4ef0a8";
    burstLayer.appendChild(s);
    setTimeout(() => s.remove(), 1200);
  }
}

// gentle parallax on the moon while scrolling the hero
const moonWrap = document.querySelector(".hero-moon-wrap");
addEventListener("scroll", () => {
  if (scrollY < innerHeight && moonWrap) {
    moonWrap.style.transform = `translateY(${scrollY * 0.18}px)`;
  }
}, { passive: true });

document.getElementById("copy-mint").addEventListener("click", () => {
  const text = document.getElementById("mint-address").textContent;
  if (!text || text.startsWith("launching")) return;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("copy-mint");
    btn.textContent = "✓";
    setTimeout(() => (btn.textContent = "⧉"), 1200);
  });
});
