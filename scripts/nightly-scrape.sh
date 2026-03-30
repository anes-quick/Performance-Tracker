#!/usr/bin/env bash
# Run from repo root (same layout as local: channels.config.json + scraper/).
# Intended for Railway cron, GitHub Actions, or a VPS at ~00:00 UTC (see channels.config.json scrapeTimeUtc).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PYTHONUNBUFFERED=1

echo "[nightly-scrape] $(date -u +%Y-%m-%dT%H:%M:%SZ) start"

echo "[nightly-scrape] Video stats → videostatsraw + channeldaily"
python -m scraper.run

echo "[nightly-scrape] Channel analytics views → channelanalytics"
python -m scraper.run_channel_analytics_views

# Revenue is estimated on /admin via RPM × (views÷2); adminfinance sheet revenue rows are optional/manual.
# To backfill YouTube estimated revenue locally: python -m scraper.run_channel_analytics_revenue

echo "[nightly-scrape] $(date -u +%Y-%m-%dT%H:%M:%SZ) done"
