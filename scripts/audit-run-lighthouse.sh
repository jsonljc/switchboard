#!/usr/bin/env bash
# audit-run-lighthouse.sh <route> <output-dir>
# Runs Lighthouse against a production build of @switchboard/dashboard.
# Writes lighthouse-desktop.json, lighthouse-mobile.json, meta.txt to <output-dir>.
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <route-path> <output-dir>" >&2
  echo "Example: $0 /console docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core" >&2
  exit 2
fi

ROUTE="$1"
OUT_DIR="$2"
PORT="${PORT:-3002}"
URL="http://localhost:${PORT}${ROUTE}"
SHA="$(git rev-parse HEAD)"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$OUT_DIR"

echo "Building dashboard (production)..."
pnpm --filter @switchboard/dashboard build

echo "Starting dashboard on port ${PORT}..."
pnpm --filter @switchboard/dashboard start --port "${PORT}" &
SERVER_PID=$!
trap "kill ${SERVER_PID} 2>/dev/null || true" EXIT

# Wait for server to come up.
for i in {1..30}; do
  if curl -sf "http://localhost:${PORT}" > /dev/null; then break; fi
  sleep 1
done

echo "Running Lighthouse desktop..."
pnpm dlx lighthouse "$URL" \
  --preset=desktop \
  --output=json \
  --output-path="${OUT_DIR}/lighthouse-desktop.json" \
  --chrome-flags="--headless"

echo "Running Lighthouse mobile..."
pnpm dlx lighthouse "$URL" \
  --output=json \
  --output-path="${OUT_DIR}/lighthouse-mobile.json" \
  --chrome-flags="--headless"

cat > "${OUT_DIR}/meta.txt" <<EOF
command:    audit-run-lighthouse.sh ${ROUTE} ${OUT_DIR}
url:        ${URL}
build_sha:  ${SHA}
started_at: ${STARTED_AT}
finished_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
os:         $(uname -a)
EOF

echo "Done. Artifacts in ${OUT_DIR}"
