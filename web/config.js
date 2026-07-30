/**
 * Where the site finds the $MOONBAG backend API.
 *
 * ""  (empty)  → same origin. Correct when the backend serves the site
 *               itself, OR on Vercel once you set your backend URL in
 *               vercel.json's rewrite (the site then proxies /api/*).
 *
 * "https://api.example.com" → call the backend directly cross-origin
 *               (the backend sends CORS headers, so this just works).
 *
 * Until a backend is reachable the site runs in demo/preview mode.
 */
window.MOONBAG_API_BASE = "";

/**
 * The $MOONBAG contract address (token mint). Shown as the CA on the site
 * and used for the pump.fun buy links. When a backend is connected its
 * TOKEN_MINT takes precedence over this value.
 */
window.MOONBAG_TOKEN_MINT = "HwmZZJNLRtKeChQ62TSdNzVxuDiKac56L8rT9wxrpump";
