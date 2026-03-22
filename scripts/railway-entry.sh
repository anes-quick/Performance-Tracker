#!/usr/bin/env bash
# Railway container entry: either run nightly scrape once, or stay idle (scrape only via Cron).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# RUN_SCRAPE_ON_START=0 → do not hit YouTube/Sheets on every deploy; use Railway Cron instead.
# RUN_SCRAPE_ON_START=1 or unset → legacy behavior: full scrape when the container starts.
if [[ "${RUN_SCRAPE_ON_START:-1}" == "0" ]]; then
  echo "[railway-entry] RUN_SCRAPE_ON_START=0 — idle (no scrape on boot)."
  echo "[railway-entry] Schedule Cron: bash scripts/nightly-scrape.sh (e.g. 0 0 * * * UTC)"
  exec sleep infinity
fi

exec bash scripts/nightly-scrape.sh
