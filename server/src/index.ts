import { config, assertLiveConfig } from "./config.js";
import { buildApp } from "./app.js";
import { startLockScanner } from "./locks.js";
import { startDistributor } from "./distribute.js";

assertLiveConfig();

buildApp().listen(config.port, () => {
  console.log(`
  ██╗   ██╗ $MOONBAG backend
  nobody holds anymore — so we pay the ones who do

  → http://localhost:${config.port}
  → mode: ${config.dryRun ? "DRY RUN (no transactions will be sent)" : "LIVE"}
  → distribution: every ${config.distributionIntervalMs / 1000}s
  → minimum lock: ${config.minLockHours}h
  `);
  startLockScanner();
  startDistributor();
});
