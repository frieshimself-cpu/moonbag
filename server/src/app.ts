import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "./api.js";

/** Build the express app (exported separately so tests can mount it). */
export function buildApp() {
  const app = express();
  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web");
  app.use(express.json());
  app.use("/api", api);
  app.use(express.static(webDir));
  return app;
}
