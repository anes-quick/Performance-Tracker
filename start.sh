#!/usr/bin/env bash
# Railpack looks for start.sh; keep in sync with scripts/nightly-scrape.sh
set -euo pipefail
cd "$(dirname "$0")"
exec bash scripts/nightly-scrape.sh
