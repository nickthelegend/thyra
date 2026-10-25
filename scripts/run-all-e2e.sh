#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
XR_DIR="$ROOT/packages/xr"
HEAVY_SLOT="/Volumes/Extreme SSD/Projects/grokbot/tools/heavy-slot.sh"

cleanup() {
  echo "Cleaning up..."
  (cd "$XR_DIR" && node node_modules/@iwsdk/cli/dist/cli.js dev down 2>/dev/null || true)
  "$HEAVY_SLOT" release thyra 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Acquiring heavy slot..."
"$HEAVY_SLOT" acquire thyra

echo "Stopping any existing dev server..."
(cd "$XR_DIR" && node node_modules/@iwsdk/cli/dist/cli.js dev down 2>/dev/null || true)

echo "Starting dev server in agent mode..."
(cd "$XR_DIR" && node node_modules/@iwsdk/cli/dist/cli.js dev up --ai-mode agent --headless --allow-browser-automation)

echo "Waiting for dev server readiness..."
node -e '
const { execFileSync } = require("node:child_process");
const xrDir = "'"$XR_DIR"'";
for (let i = 0; i < 60; i++) {
  try {
    const st = execFileSync("node", ["node_modules/@iwsdk/cli/dist/cli.js", "dev", "status"], { cwd: xrDir, encoding: "utf8" });
    if (/"browserCommandReady":\s*true/.test(st)) {
      console.log("Dev server ready!");
      process.exit(0);
    }
  } catch (e) {
    // ignore
  }
  execFileSync("sleep", ["2"]);
}
console.error("Timeout waiting for dev server ready");
process.exit(1);
'

echo "=== Running Quest 3 profile e2e ==="
cd "$ROOT"
node e2e/run.ts

echo "=== Running Meta VR Glasses profile e2e ==="
node e2e/glasses.ts

echo "=== Running Landing + 2D Page e2e ==="
node e2e/landing.ts https://localhost:8443/

echo "=== Updating landing schedule.json from newest e2e run ==="
node scripts/landing-data.ts

echo "=== All e2e runs finished successfully! ==="
