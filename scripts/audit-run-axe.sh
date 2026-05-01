#!/usr/bin/env bash
# audit-run-axe.sh <route> <output-dir>
# Runs @axe-core/cli against a production build of @switchboard/dashboard.
# Writes axe.json + meta.txt to <output-dir>.
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <route-path> <output-dir>" >&2
  exit 2
fi

ROUTE="$1"
OUT_DIR="$2"
PORT="${PORT:-3002}"
URL="http://localhost:${PORT}${ROUTE}"
SHA="$(git rev-parse HEAD)"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$OUT_DIR"

if [[ -z "${SKIP_BUILD:-}" ]]; then
  echo "Building dashboard..."
  pnpm --filter @switchboard/dashboard build
fi

echo "Starting dashboard on port ${PORT}..."
pnpm --filter @switchboard/dashboard start --port "${PORT}" &
SERVER_PID=$!
trap "kill ${SERVER_PID} 2>/dev/null || true" EXIT

for i in {1..30}; do
  if curl -sf "http://localhost:${PORT}" > /dev/null; then break; fi
  sleep 1
done

echo "Running axe-core/cli..."
pnpm dlx @axe-core/cli "$URL" \
  --save "${OUT_DIR}/axe.json" \
  --chrome-options="--headless"

cat > "${OUT_DIR}/axe-meta.txt" <<EOF
command:    audit-run-axe.sh ${ROUTE} ${OUT_DIR}
url:        ${URL}
build_sha:  ${SHA}
started_at: ${STARTED_AT}
finished_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
os:         $(uname -a)
EOF

echo "Done. Artifacts in ${OUT_DIR}"
