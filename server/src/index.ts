import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, assertLiveConfig } from "./config.js";
import { api } from "./api.js";
import { startLockScanner } from "./locks.js";
import { startDistributor } from "./distribute.js";

assertLiveConfig();

const app = express();
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web");

app.use("/api", api);
app.use(express.static(webDir));

app.listen(config.port, () => {
  console.log(`
  ██╗   ██╗ $MOONBAG backend
  nobody holds anymore — so we pay the ones who do

  → http://localhost:${config.port}
  → mode: ${config.dryRun ? "DRY RUN (no transactions will be sent)" : "LIVE"}
  → distribution: every ${config.distributionIntervalMs / 1000}s
  `);
  startLockScanner();
  startDistributor();
});
