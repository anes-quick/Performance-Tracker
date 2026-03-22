"""
YouTube Analytics API test scraper: daily views per channel.

Writes to a new Google Sheets tab: `channelanalytics`.
Current columns:
  date (YYYY-MM-DD)
  channel_id
  channel_name
  views

This script supports "incremental" runs for multiple OAuth tokens:
- It merges new rows for the selected date range into `channelanalytics`
  instead of wiping the tab completely.

Run:
  export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
  export YOUTUBE_API_KEY="..."
  .venv/bin/python -m scraper.run_channel_analytics_views
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Any, Dict, List
from zoneinfo import ZoneInfo

from googleapiclient.discovery import build

from .analytics_oauth import load_oauth_credentials
from .config import load_config
from .youtube_client import resolve_channel_id
from .sheets import _get_sheets_service  # service account sheets client


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
        range=f"'{tab_name}'!A1:D10000",
    ).execute()
    return res.get("values", []) or []


def _parse_existing(existing_values: List[List[Any]]) -> Dict[str, List[Any]]:
    """
    Parse existing rows into a map keyed by f"{date}|{channel_id}".
    Value is the row shape: [date, channel_id, channel_name, views]
    """
    out: Dict[str, List[Any]] = {}
    for row in existing_values[1:]:  # skip header row
        if len(row) < 4:
            continue
        date = str(row[0] or "").strip()
        channel_id = str(row[1] or "").strip()
        if not date or not channel_id:
            continue
        out[f"{date}|{channel_id}"] = row[:4]
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
    Fetch daily views split by channel using ids=channel==MINE.
    Dimensions order we expect: day, channel
    Rows: [day, channelId, views]
    """
    request = analytics_service.reports().query(
        ids="channel==MINE",
        startDate=start_date,
        endDate=end_date,
        metrics="views",
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
        out.append({"date": day, "channel_id": channel_id, "views": views})
    return out


def run(days: int = 28, tab_name: str = DEFAULT_TAB) -> None:
    config = load_config()
    spreadsheet_id = config["spreadsheetId"]
    channels = config.get("channels", [])

    creds = load_oauth_credentials()
    analytics = build("youtubeAnalytics", "v2", credentials=creds)

    start_date, end_date = _date_range(days)
    print(f"Scraping YouTube Analytics views: {start_date} → {end_date}")

    # Prepare sheet
    sheets = _get_sheets_service()
    _ensure_tab_exists(sheets, spreadsheet_id, tab_name)

    headers = ["date", "channel_id", "channel_name", "views"]
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

    daily_by_channel = _fetch_daily_views_by_channel(analytics, start_date, end_date)
    print(f"Analytics returned {len(daily_by_channel)} daily rows (day+channel split)")

    kept = 0
    for d in daily_by_channel:
        cid = str(d["channel_id"]).strip()
        if allowed and cid not in allowed:
            continue
        kept += 1
        out_rows.append([d["date"], cid, allowed.get(cid, cid), d["views"]])

    print(f"Kept {kept} rows for configured channels")

    updated_map = dict(existing_map)
    for row in out_rows:
        date = str(row[0]).strip()
        channel_id = str(row[1]).strip()
        updated_map[f"{date}|{channel_id}"] = row[:4]

    merged_rows = list(updated_map.values())
    merged_rows.sort(key=lambda r: (str(r[0]), str(r[1])))

    _write_rows(sheets, spreadsheet_id, tab_name, headers, merged_rows)
    print(
        f"Done. Merged {len(out_rows)} new/updated rows into tab '{tab_name}' (total {len(merged_rows)} rows)."
    )


if __name__ == "__main__":
    run()

