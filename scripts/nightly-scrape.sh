#!/usr/bin/env bash
# Run from repo root (same layout as local: channels.config.json + scraper/).
# Intended for Railway cron, GitHub Actions, or a VPS at ~00:00 UTC (see channels.config.json scrapeTimeUtc).
#
# Master switch (Railway / cron / local): set SCRAPE_ENABLED=0 to skip all scrapes (no YouTube/Sheets writes).
# Values that turn scraping OFF: 0, false, no, off (case-insensitive). Unset or anything else = ON.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PYTHONUNBUFFERED=1

_scrape_enabled_raw="${SCRAPE_ENABLED:-1}"
_scrape_enabled_lower="$(echo "${_scrape_enabled_raw}" | tr '[:upper:]' '[:lower:]')"
if [[ "${_scrape_enabled_lower}" == "0" || "${_scrape_enabled_lower}" == "false" || "${_scrape_enabled_lower}" == "no" || "${_scrape_enabled_lower}" == "off" ]]; then
  echo "[nightly-scrape] $(date -u +%Y-%m-%dT%H:%M:%SZ) SCRAPE_ENABLED=off — skipping (no API/scrape work)."
  exit 0
fi

echo "[nightly-scrape] $(date -u +%Y-%m-%dT%H:%M:%SZ) start"

echo "[nightly-scrape] Video stats → videostatsraw + channeldaily"
python -m scraper.run

echo "[nightly-scrape] Channel analytics views → channelanalytics"
python -m scraper.run_channel_analytics_views

# Revenue is estimated on /admin via RPM × (views÷2); adminfinance sheet revenue rows are optional/manual.
# To backfill YouTube estimated revenue locally: python -m scraper.run_channel_analytics_revenue

echo "[nightly-scrape] $(date -u +%Y-%m-%dT%H:%M:%SZ) done"
