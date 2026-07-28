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
