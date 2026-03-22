"""
Check which OAuth token files can read YouTube Analytics *revenue* (estimatedRevenue).

Run from project root:
  .venv/bin/python -m scraper.diagnose_revenue_tokens

For any file that shows 401 or 403, re-run OAuth with monetary scopes and save
into that same filename (see scraper/REAUTH_REVENUE.md).
"""

from __future__ import annotations

from datetime import datetime, timedelta

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from .analytics_oauth import (
    credentials_from_analytics_token_dict,
    discover_youtube_analytics_token_payloads,
)
from .config import load_config
from .run_channel_analytics_revenue import _resolve_revenue_api_currency
from .run_channel_analytics_views import _date_range


def _last_week_range() -> tuple[str, str]:
    """Last 7 days inclusive in YouTube’s Pacific reporting calendar."""
    return _date_range(7)


def main() -> None:
    payloads = discover_youtube_analytics_token_payloads()
    cfg = load_config()
    api_currency = _resolve_revenue_api_currency(cfg)
    start_date, end_date = _last_week_range()
    cur_note = f"currency={api_currency}" if api_currency else "default USD"
    print(
        f"Testing estimatedRevenue (MINE, day+channel): {start_date} → {end_date} ({cur_note})\n"
    )

    for i, payload in enumerate(payloads):
        print(f"── token {i + 1}/{len(payloads)} ──")
        try:
            creds = credentials_from_analytics_token_dict(payload)
            analytics = build("youtubeAnalytics", "v2", credentials=creds)
            q = {
                "ids": "channel==MINE",
                "startDate": start_date,
                "endDate": end_date,
                "metrics": "estimatedRevenue",
                "dimensions": "day,channel",
            }
            if api_currency:
                q["currency"] = api_currency
            req = analytics.reports().query(**q)
            resp = req.execute()
            rows = resp.get("rows", []) or []
            cids: set[str] = set()
            for row in rows:
                if len(row) >= 2:
                    cids.add(str(row[1]).strip())
            total = sum(
                float(r[2] or 0)
                for r in rows
                if len(r) >= 3
            )
            print(f"  OK — {len(rows)} row(s), {len(cids)} channel id(s), ~{total:.2f} in window")
            if cids:
                for cid in sorted(cids):
                    print(f"      • {cid}")
        except HttpError as e:
            status = e.resp.status
            if status == 401:
                print("  FAIL 401 — token invalid or missing monetary scope.")
                print("          Fix: REAUTH_REVENUE.md → OAuth for this file.")
            elif status == 403:
                print("  FAIL 403 — Google blocked this revenue report for this login.")
            else:
                print(f"  FAIL HTTP {status}")
        except FileNotFoundError as e:
            print(f"  {e}")
        except Exception as e:
            print(f"  ERROR: {e}")
        print()

    print("Next: fix any FAIL lines, then run:")
    print("  .venv/bin/python -m scraper.run_channel_analytics_revenue")


if __name__ == "__main__":
    main()
