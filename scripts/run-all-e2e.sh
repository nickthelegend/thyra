#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
XR_DIR="$ROOT/packages/xr"
HEAVY_SLOT="/Volumes/Extreme SSD/Projects/grokbot/tools/heavy-slot.sh"
SLOT_ACQUIRED=0
SERVER_STARTED=0

cleanup() {
  local exit_code=$?
  trap - EXIT
  trap '' INT TERM
  echo "Cleaning up..."
  if (( SERVER_STARTED )); then
    (cd "$XR_DIR" && node node_modules/@iwsdk/cli/dist/cli.js dev down 2>/dev/null) || true
  fi
  if (( SLOT_ACQUIRED )); then
    "$HEAVY_SLOT" release thyra 2>/dev/null || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Acquiring heavy slot..."
"$HEAVY_SLOT" acquire thyra
SLOT_ACQUIRED=1

echo "Checking for an existing dev server..."
node - "$XR_DIR" <<'NODE'
const { execFileSync } = require('node:child_process');
const status = JSON.parse(execFileSync('node', ['node_modules/@iwsdk/cli/dist/cli.js', 'dev', 'status'], {
  cwd: process.argv[2], encoding: 'utf8', timeout: 10_000,
}));
if (!status.ok || status.data?.state?.running !== false || status.data?.state?.starting !== false) {
  console.error('Cannot start: a dev server already exists or its status is unknown. Stop it from its owning session first.');
  process.exit(1);
}
NODE

echo "Starting dev server in agent mode..."
# dev up detaches and returns after startup unless --foreground is passed.
# Claim cleanup before startup so a partially failed launch is stopped too.
SERVER_STARTED=1
(cd "$XR_DIR" && node node_modules/@iwsdk/cli/dist/cli.js dev up --ai-mode agent --headless --allow-browser-automation)

echo "Waiting for dev server readiness..."
node - "$XR_DIR" <<'NODE'
const { execFileSync } = require("node:child_process");
const xrDir = process.argv[2];
const deadline = Date.now() + 120_000;
const sleeper = new Int32Array(new SharedArrayBuffer(4));
while (Date.now() < deadline) {
  try {
    const st = JSON.parse(execFileSync("node", ["node_modules/@iwsdk/cli/dist/cli.js", "dev", "status"], {
      cwd: xrDir, encoding: "utf8", timeout: Math.min(10_000, deadline - Date.now()),
    }));
    if (st.ok && st.data?.state?.browserCommandReady === true) {
      console.log("Dev server ready!");
      process.exit(0);
    }
  } catch {
    // A transient status failure is retried within the readiness deadline.
  }
  Atomics.wait(sleeper, 0, 0, Math.max(0, Math.min(2_000, deadline - Date.now())));
}
console.error("Timeout waiting for dev server ready");
process.exit(1);
NODE

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
