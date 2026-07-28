import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "./api.js";

/** Build the express app (exported separately so tests can mount it). */
export function buildApp() {
  const app = express();
  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web");
  app.use(express.json());
  // CORS: the site may be hosted elsewhere (e.g. Vercel) and call this API
  // cross-origin. Everything here is public data or signature-authenticated,
  // so an open origin is safe.
  app.use("/api", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use("/api", api);
  app.use(express.static(webDir));
  return app;
}
