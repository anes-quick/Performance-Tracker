"""
YouTube Analytics API test scraper: daily views per channel.

Writes to a new Google Sheets tab: `channelanalytics`.
Current columns:
  date (YYYY-MM-DD)
  channel_id
  channel_name
  views
  engaged_views  (YouTube Analytics engagedViews; may be 0 while views > 0 on some channels — /admin RPM falls back to views)

This script supports "incremental" runs for multiple OAuth tokens:
- It merges new rows for the selected date range into `channelanalytics`
  instead of wiping the tab completely.

Run:
  .venv/bin/python -m scraper.run_channel_analytics_views

Put ``YOUTUBE_API_KEY`` in ``scraper/.env`` or ``frontend/.env.local`` (loaded automatically),
or ``export YOUTUBE_API_KEY=...`` in the shell.

Sheets auth (first match wins): GOOGLE_SERVICE_ACCOUNT_JSON, _BASE64,
GOOGLE_APPLICATION_CREDENTIALS if the file exists, else a **local** JSON in the
repo root: LOCAL_GOOGLE_APPLICATION_CREDENTIALS, service-account.json,
google-service-account.json, or neon-feat*.json (see scraper/sheets.py).
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Any, Dict, List
from zoneinfo import ZoneInfo

from googleapiclient.discovery import build

from .analytics_oauth import (
    credentials_from_analytics_token_dict,
    discover_youtube_analytics_token_payloads,
)
from .config import load_config
from .youtube_client import resolve_channel_id
from .sheets import _get_sheets_service  # service account sheets client


def _load_local_env() -> None:
    """
    Load env files so YOUTUBE_API_KEY etc. work without exporting in the shell.
    Tries: scraper/.env, frontend/.env.local, repo .env (same idea as scraper/run.py).
    """
    try:
        from pathlib import Path

        from dotenv import load_dotenv

        scraper_dir = Path(__file__).resolve().parent
        root = scraper_dir.parent
        load_dotenv(scraper_dir / ".env")
        load_dotenv(root / "frontend" / ".env.local")
        load_dotenv(root / ".env")
    except ImportError:
        pass


DEFAULT_TAB = "channelanalytics"

# YouTube Analytics "day" dimension is bucketed in Pacific time (PST/PDT), same as Studio.
_YT_ANALYTICS_DAY_TZ = ZoneInfo("America/Los_Angeles")


def _include_today_pacific() -> bool:
    """
    If False (default): date range ends on **yesterday** in Pacific — matches Studio when
    “today” is empty or still filling in (e.g. mid-morning refresh).
    Override: YT_ANALYTICS_INCLUDE_TODAY_PACIFIC=true or channels.config.json
    youtubeAnalyticsIncludeTodayPacific: true
    """
    env = os.environ.get("YT_ANALYTICS_INCLUDE_TODAY_PACIFIC", "").strip().lower()
    if env in ("1", "true", "yes", "on"):
        return True
    if env in ("0", "false", "no", "off"):
        return False
    try:
        cfg = load_config()
        v = cfg.get("youtubeAnalyticsIncludeTodayPacific")
        if isinstance(v, bool):
            return v
    except Exception:
        pass
    return False


def _ensure_tab_exists(sheets, spreadsheet_id: str, tab_name: str) -> None:
    # Check if tab exists by reading spreadsheet properties
    meta = sheets.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    sheets_list = meta.get("sheets", [])
    for s in sheets_list:
        props = s.get("properties", {})
        if props.get("title") == tab_name:
            return

    sheets.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={
            "requests": [
                {"addSheet": {"properties": {"title": tab_name}}}
            ]
        },
    ).execute()


def _clear_tab(sheets, spreadsheet_id: str, tab_name: str) -> None:
    # Clear from A1 through a large range; Sheets will ignore extra beyond sheet size.
    sheets.spreadsheets().values().clear(
        spreadsheetId=spreadsheet_id,
        range=f"'{tab_name}'!A:Z",
    ).execute()


def _read_existing_rows(sheets, spreadsheet_id: str, tab_name: str) -> List[List[Any]]:
    """Read existing values (including header) from the tab."""
    res = sheets.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"'{tab_name}'!A1:E10000",
    ).execute()
    return res.get("values", []) or []


def _normalize_analytics_row(row: List[Any]) -> List[Any]:
    """Ensure 5 data columns: date, channel_id, channel_name, views, engaged_views."""
    date = str(row[0] or "").strip()
    channel_id = str(row[1] or "").strip()
    name = str(row[2] or "").strip()
    try:
        views = int(row[3]) if len(row) > 3 and row[3] is not None and str(row[3]).strip() != "" else 0
    except (TypeError, ValueError):
        views = 0
    try:
        engaged = int(row[4]) if len(row) > 4 and row[4] is not None and str(row[4]).strip() != "" else 0
    except (TypeError, ValueError):
        engaged = 0
    return [date, channel_id, name, views, engaged]


def _parse_existing(existing_values: List[List[Any]]) -> Dict[str, List[Any]]:
    """
    Parse existing rows into a map keyed by f"{date}|{channel_id}".
    Value is the row shape: [date, channel_id, channel_name, views, engaged_views]
    """
    out: Dict[str, List[Any]] = {}
    for row in existing_values[1:]:  # skip header row
        if len(row) < 4:
            continue
        date = str(row[0] or "").strip()
        channel_id = str(row[1] or "").strip()
        if not date or not channel_id:
            continue
        out[f"{date}|{channel_id}"] = _normalize_analytics_row(row)
    return out


def _write_rows(sheets, spreadsheet_id: str, tab_name: str, headers: List[str], rows: List[List[Any]]) -> None:
    all_values = [headers] + rows
    sheets.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"'{tab_name}'!A1",
        valueInputOption="USER_ENTERED",
        body={"values": all_values},
    ).execute()


def _date_range(days: int) -> tuple[str, str]:
    """
    Inclusive [start, end] as YYYY-MM-DD in YouTube's reporting calendar (Pacific).

    By default **end = yesterday** in Pacific (Studio often hides or zeros “today” until
    the day is complete). Set youtubeAnalyticsIncludeTodayPacific / env to include today.
    """
    today_la = datetime.now(_YT_ANALYTICS_DAY_TZ).date()
    if _include_today_pacific():
        end = today_la
    else:
        end = today_la - timedelta(days=1)
    start = end - timedelta(days=days - 1)
    return start.isoformat(), end.isoformat()


def _fetch_daily_views(analytics_service, channel_id: str, start_date: str, end_date: str) -> List[Dict[str, Any]]:
    # dimensions=day => rows like: [day, views]
    request = analytics_service.reports().query(
        ids=f"channel=={channel_id}",
        startDate=start_date,
        endDate=end_date,
        metrics="views",
        dimensions="day",
    )
    response = request.execute()

    headers = response.get("columnHeaders", [])
    rows = response.get("rows", []) or []
    # ColumnHeaders order should match row order: [day, views]
    out: List[Dict[str, Any]] = []
    for row in rows:
        day = row[0]
        views = int(row[1]) if row[1] is not None else 0
        out.append({"date": day, "views": views})
    return out


def _fetch_daily_views_by_channel(analytics_service, start_date: str, end_date: str) -> List[Dict[str, Any]]:
    """
    Fetch daily views + engagedViews per channel (ids=channel==MINE).
    Dimensions: day, channel — metrics: views, engagedViews
    Rows: [day, channelId, views, engagedViews]
    """
    request = analytics_service.reports().query(
        ids="channel==MINE",
        startDate=start_date,
        endDate=end_date,
        metrics="views,engagedViews",
        dimensions="day,channel",
    )
    response = request.execute()
    rows = response.get("rows", []) or []
    out: List[Dict[str, Any]] = []
    for row in rows:
        if len(row) < 3:
            continue
        day = row[0]
        channel_id = row[1]
        views = int(row[2]) if row[2] is not None else 0
        engaged = int(row[3]) if len(row) > 3 and row[3] is not None else 0
        out.append(
            {
                "date": day,
                "channel_id": channel_id,
                "views": views,
                "engaged_views": engaged,
            }
        )
    return out


def run(days: int = 28, tab_name: str = DEFAULT_TAB) -> None:
    _load_local_env()
    config = load_config()
    spreadsheet_id = config["spreadsheetId"]
    channels = config.get("channels", [])

    start_date, end_date = _date_range(days)
    print(f"Scraping YouTube Analytics views: {start_date} → {end_date}")

    token_payloads = discover_youtube_analytics_token_payloads()
    print(f"Discovered {len(token_payloads)} YouTube Analytics OAuth token(s)")

    # Prepare sheet
    sheets = _get_sheets_service()
    _ensure_tab_exists(sheets, spreadsheet_id, tab_name)

    headers = ["date", "channel_id", "channel_name", "views", "engaged_views"]
    existing_values = _read_existing_rows(sheets, spreadsheet_id, tab_name)
    existing_map = _parse_existing(existing_values)
    # Resolve allowed channel IDs from our config, so we only keep those channels
    allowed: Dict[str, str] = {}  # channel_id -> channel_name
    for ch in channels:
        handle = ch.get("handle") or ch.get("name")
        name = ch.get("name") or handle
        cid = resolve_channel_id(handle)
        if cid:
            allowed[cid] = name
        else:
            print(f"Skip analytics (resolve channel id failed): {name} (@{handle})")

    out_rows: List[List[Any]] = []

    total_kept = 0
    for i, payload in enumerate(token_payloads):
        label = f"token#{i + 1}"
        try:
            creds = credentials_from_analytics_token_dict(payload)
            analytics = build("youtubeAnalytics", "v2", credentials=creds)
            daily_by_channel = _fetch_daily_views_by_channel(
                analytics, start_date, end_date
            )
        except Exception as e:
            print(f"[{label}] Skip token (fetch failed): {e}")
            continue

        kept = 0
        channels_seen: set[str] = set()
        for d in daily_by_channel:
            cid = str(d["channel_id"]).strip()
            if allowed and cid not in allowed:
                continue
            kept += 1
            channels_seen.add(cid)
            out_rows.append(
                [
                    d["date"],
                    cid,
                    allowed.get(cid, cid),
                    d["views"],
                    d["engaged_views"],
                ]
            )
        total_kept += kept
        print(
            f"[{label}] Analytics returned {len(daily_by_channel)} rows; kept {kept} rows for {len(channels_seen)} configured channel(s)"
        )

    print(f"Kept {total_kept} total rows for configured channels (all tokens)")

    updated_map = dict(existing_map)
    for row in out_rows:
        date = str(row[0]).strip()
        channel_id = str(row[1]).strip()
        updated_map[f"{date}|{channel_id}"] = _normalize_analytics_row(row)

    merged_rows = list(updated_map.values())
    merged_rows.sort(key=lambda r: (str(r[0]), str(r[1])))

    _write_rows(sheets, spreadsheet_id, tab_name, headers, merged_rows)
    print(
        f"Done. Merged {len(out_rows)} new/updated rows into tab '{tab_name}' (total {len(merged_rows)} rows)."
    )


if __name__ == "__main__":
    run()

