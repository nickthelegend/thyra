#!/usr/bin/env bash
set -u
export THYRA_EXTERNAL_GATEWAY=1
export THYRA_AUDIT_DIR="$PWD/audit/xr"
export THYRA_VIDEO_DIR=/tmp/thyra-t5-videos/
run() {
  local stage="$1" log="$2"
  shift 2
  printf '%s' "$stage" > /tmp/thyra-t5-stage
  "$@" > "$log" 2>&1
  local result=$?
  printf '%s %s\n' "$stage" "$result" >> audit/commands.txt
}
run pages audit/app/run.log node e2e/audit-pages.mjs
run gateway audit/gateway/run.log node e2e/audit-gateway.mjs
run minimum audit/xr/minimum.log node e2e/audit-xr.ts minimum
run quest audit/xr/quest.log node e2e/run.ts
run supplement audit/xr/supplement.log node e2e/audit-xr.ts
run edges audit/xr/edges.log node e2e/audit-edges.ts
run rendering audit/xr/render.log node e2e/audit-render.ts
run occlusion audit/xr/occlusion.log node e2e/audit-occlusion.ts
run offline audit/xr/offline.log node e2e/audit-offline.ts
run recording audit/xr/record.log node e2e/record.ts thyra-01-tear-open
run glasses audit/xr/glasses.log node e2e/glasses.ts
run no-depth audit/xr/no-depth.log node e2e/audit-no-depth.ts
run client audit/xr/client.log node e2e/audit-client.ts
