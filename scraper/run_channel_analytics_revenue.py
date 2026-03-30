"""
YouTube Analytics API: real estimated revenue per channel (from Google), merged into adminfinance.

Uses metrics=estimatedRevenue with dimensions=day,channel and ids=channel==MINE (same as views).

OAuth must include monetary scope. If your token is old, re-run:
  python -m scraper.youtube_analytics_oauth_console

Manual rows in adminfinance (any row whose Note does NOT contain the tag below) are preserved.
Rows written by this script are replaced on each run for the scraped date window (we drop old
auto rows, re-append fresh API data for the range).

Set channels.config.json "youtubeAnalyticsRevenueCurrency" to match YouTube Studio (e.g. EUR).
The API defaults to USD; without this, admin FX (ECB) will not match Studio’s euro numbers.

Date range uses **America/Los_Angeles** (YouTube’s `day` dimension), same as Studio — not UTC.

Optional: `YT_ANALYTICS_TOKEN_PAUSE_SEC=8` — sleep between each OAuth token file (rate limits / readability).

Run:
  export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
  export YOUTUBE_API_KEY="..."   # only needed to resolve channel handles → ids for filtering
  .venv/bin/python -m scraper.run_channel_analytics_revenue
"""

from __future__ import annotations

import os
import time
from typing import Any, Dict, List

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from .analytics_oauth import (
    credentials_from_analytics_token_dict,
    discover_youtube_analytics_token_payloads,
)
from .config import load_config
from .run_channel_analytics_views import (
    _date_range,
    _ensure_tab_exists,
    _include_today_pacific,
)
from .sheets import _get_sheets_service
from .youtube_client import resolve_channel_id_from_config_entry, resolve_channel_title

# Must match removal filter and stay stable across runs
AUTO_NOTE_TAG = "[yt-analytics-estimatedRevenue]"


def _resolve_revenue_api_currency(config: dict) -> str | None:
    """
    YouTube Analytics `reports().query` optional `currency` parameter.
    Default API behavior is USD; Studio usually shows your AdSense home currency (e.g. EUR).
    Set channels.config.json "youtubeAnalyticsRevenueCurrency": "EUR" or env
    YT_ANALYTICS_REVENUE_CURRENCY=EUR so API numbers match Studio.
    """
    env = os.environ.get("YT_ANALYTICS_REVENUE_CURRENCY", "").strip().upper()
    if env:
        return env if len(env) == 3 else None
    raw = config.get("youtubeAnalyticsRevenueCurrency")
    if raw is None or raw == "":
        return None
    s = str(raw).strip().upper()
    return s if len(s) == 3 else None


def _normalize_api_currency(code: str) -> str:
    """
    Currency code for the sheet Note (admin UI parses USD|EUR after the tag).
    Unknown codes default to USD so amounts aren't mis-read as EUR.
    """
    c = (code or "").strip().upper()
    if c == "EUR" or c == "€":
        return "EUR"
    if c == "USD":
        return "USD"
    return "USD"


def _merge_revenue_for_one_login(
    analytics,
    merged: Dict[tuple[str, str], Dict[str, Any]],
    allowed: Dict[str, str],
    start_date: str,
    end_date: str,
    currency_hint: str,
    api_currency: str | None,
) -> str:
    """Pull MINE + per-channel for one OAuth identity; merge into merged dict."""

    # 1) MINE — all channels this login can see revenue for
    try:
        mine_rows, cur = _fetch_revenue_channel_mine_day_channel(
            analytics, start_date, end_date, api_currency
        )
        currency_hint = cur or currency_hint
        mine_cids = {str(r["channel_id"]).strip() for r in mine_rows}
        print(
            f"  MINE: {len(mine_rows)} row(s), {len(mine_cids)} channel id(s)"
        )
        if allowed:
            missing = mine_cids - set(allowed.keys())
            if missing:
                print(
                    "  ids not in channels.config (using YouTube title): "
                    + ", ".join(sorted(missing)[:6])
                    + (" …" if len(missing) > 6 else "")
                )
            wanted = set(allowed.keys()) - mine_cids
            if wanted:
                print(
                    "  no MINE row this window (other brand login / not monetized / $0): "
                    + ", ".join(f"{allowed[c]}" for c in sorted(wanted)[:8])
                )
        cur_norm = _normalize_api_currency(cur)
        for r in mine_rows:
            cid = str(r["channel_id"]).strip()
            display = allowed.get(cid) or resolve_channel_title(cid) or cid
            merged[(r["date"], cid)] = {
                "date": r["date"],
                "channel_id": cid,
                "revenue": r["revenue"],
                "display_name": display,
                "currency": cur_norm,
            }
    except HttpError as e:
        raise

    # 2) Per-channel overlay when API allows
    for cid, display_name in allowed.items():
        try:
            rows, cur = _fetch_revenue_single_channel(
                analytics, cid, start_date, end_date, api_currency
            )
            currency_hint = cur or currency_hint
            cur_norm = _normalize_api_currency(cur)
            for r in rows:
                key = (r["date"], cid)
                merged[key] = {
                    "date": r["date"],
                    "channel_id": cid,
                    "revenue": r["revenue"],
                    "display_name": display_name,
                    "currency": cur_norm,
                }
            nz = sum(1 for x in rows if float(x["revenue"]) != 0)
            if nz:
                print(
                    f"  {display_name} (per-channel overlay): {nz} day(s) non-zero"
                )
        except HttpError as e:
            if e.resp.status == 401:
                raise
            # 403 typical for channel==UC… — MINE already filled if this login owns it

    return currency_hint


def _sheet_a1(tab: str, a1: str) -> str:
    q = tab.replace("'", "''")
    return f"'{q}'!{a1}"


def _read_admin_finance(
    sheets, spreadsheet_id: str, tab: str
) -> List[List[Any]]:
    res = (
        sheets.spreadsheets()
        .values()
        .get(
            spreadsheetId=spreadsheet_id,
            range=_sheet_a1(tab, "A1:E5000"),
        )
        .execute()
    )
    return res.get("values", []) or []


def _parse_manual_rows(values: List[List[Any]]) -> tuple[List[str], List[List[Any]]]:
    """Return (header, manual_rows). If no header, synthesize default header."""
    default_header = ["Date", "Channel", "Revenue", "Costs", "Note"]
    if not values:
        return default_header, []
    header = [str(c or "").strip() for c in values[0]]
    while len(header) < 5:
        header.append("")
    if not any(header):
        header = default_header[:]
    manual: List[List[Any]] = []
    for row in values[1:]:
        note = str(row[4]).strip() if len(row) > 4 else ""
        if AUTO_NOTE_TAG in note:
            continue
        if not row or all(not str(c or "").strip() for c in row):
            continue
        manual.append(row)
    return header, manual


def _parse_auto_row_map(values: List[List[Any]]) -> Dict[str, List[Any]]:
    """Keyed by date|channel_name for merge (same as written by this script)."""
    out: Dict[str, List[Any]] = {}
    for row in values[1:]:
        note = str(row[4]).strip() if len(row) > 4 else ""
        if AUTO_NOTE_TAG not in note:
            continue
        if len(row) < 2:
            continue
        date = str(row[0] or "").strip()
        ch = str(row[1] or "").strip()
        if not date or not ch:
            continue
        out[f"{date}|{ch}"] = row
    return out


def _currency_from_headers(headers: List[Dict[str, Any]]) -> str:
    currency_hint = "USD"
    for h in headers:
        name = str(h.get("name", "")).lower()
        if name == "estimatedrevenue" and h.get("currency"):
            return str(h["currency"])
        if "revenue" in name and h.get("currency"):
            currency_hint = str(h["currency"])
    return currency_hint


def _fetch_revenue_channel_mine_day_channel(
    analytics_service,
    start_date: str,
    end_date: str,
    api_currency: str | None = None,
) -> tuple[List[Dict[str, Any]], str]:
    """ids=channel==MINE, dimensions=day,channel — may omit some linked channels."""
    q: Dict[str, Any] = {
        "ids": "channel==MINE",
        "startDate": start_date,
        "endDate": end_date,
        "metrics": "estimatedRevenue",
        "dimensions": "day,channel",
    }
    if api_currency:
        q["currency"] = api_currency
    request = analytics_service.reports().query(**q)
    response = request.execute()
    headers = response.get("columnHeaders", []) or []
    currency_hint = _currency_from_headers(headers)
    out: List[Dict[str, Any]] = []
    for row in response.get("rows", []) or []:
        if len(row) < 3:
            continue
        day = str(row[0])
        channel_id = str(row[1]).strip()
        raw_rev = row[2]
        try:
            revenue = float(raw_rev) if raw_rev is not None else 0.0
        except (TypeError, ValueError):
            revenue = 0.0
        out.append({"date": day, "channel_id": channel_id, "revenue": revenue})
    return out, currency_hint


def _fetch_revenue_single_channel(
    analytics_service,
    channel_id: str,
    start_date: str,
    end_date: str,
    api_currency: str | None = None,
) -> tuple[List[Dict[str, Any]], str]:
    """
    Per-channel report: ids=channel==UC..., dimensions=day.
    Same channel IDs as channels.config.json / Data API — fixes missing rows when MINE is incomplete.
    """
    q: Dict[str, Any] = {
        "ids": f"channel=={channel_id}",
        "startDate": start_date,
        "endDate": end_date,
        "metrics": "estimatedRevenue",
        "dimensions": "day",
    }
    if api_currency:
        q["currency"] = api_currency
    request = analytics_service.reports().query(**q)
    response = request.execute()
    headers = response.get("columnHeaders", []) or []
    currency_hint = _currency_from_headers(headers)
    out: List[Dict[str, Any]] = []
    for row in response.get("rows", []) or []:
        if len(row) < 2:
            continue
        day = str(row[0])
        raw_rev = row[1]
        try:
            revenue = float(raw_rev) if raw_rev is not None else 0.0
        except (TypeError, ValueError):
            revenue = 0.0
        out.append({"date": day, "channel_id": channel_id, "revenue": revenue})
    return out, currency_hint


def run(days: int = 28) -> None:
    config = load_config()
    spreadsheet_id = config["spreadsheetId"]
    finance_tab = config.get("adminFinanceTab", "adminfinance")
    channels = config.get("channels", [])

    allowed: Dict[str, str] = {}
    for ch in channels:
        handle = ch.get("handle") or ch.get("name")
        name = ch.get("name") or handle
        cid = resolve_channel_id_from_config_entry(ch)
        if cid:
            allowed[cid] = name
        else:
            print(f"Skip (resolve channel id failed): {name} (@{handle})")

    start_date, end_date = _date_range(days)
    api_currency = _resolve_revenue_api_currency(config)
    print(f"YouTube Analytics estimatedRevenue: {start_date} → {end_date}")
    print(
        f"  Pacific window end: {'today' if _include_today_pacific() else 'yesterday'} "
        "(youtubeAnalyticsIncludeTodayPacific / YT_ANALYTICS_INCLUDE_TODAY_PACIFIC)"
    )
    if api_currency:
        print(f"  API currency parameter: {api_currency} (matches Studio home currency)")
    else:
        print(
            "  API currency: default USD — set youtubeAnalyticsRevenueCurrency in "
            "channels.config.json (e.g. EUR) if Studio shows a different currency."
        )

    token_payloads = discover_youtube_analytics_token_payloads()
    print(f"Merging revenue from {len(token_payloads)} OAuth token(s)")

    merged: Dict[tuple[str, str], Dict[str, Any]] = {}
    currency_hint = "USD"

    pause_raw = os.environ.get("YT_ANALYTICS_TOKEN_PAUSE_SEC", "0").strip() or "0"
    try:
        pause_sec = max(0.0, float(pause_raw))
    except ValueError:
        pause_sec = 0.0
    if pause_sec > 0:
        print(f"Pause between OAuth tokens: {pause_sec}s (YT_ANALYTICS_TOKEN_PAUSE_SEC)")

    for i, payload in enumerate(token_payloads):
        if i > 0 and pause_sec > 0:
            print(f"\n  … waiting {pause_sec}s before next account …\n")
            time.sleep(pause_sec)
        label = f"token {i + 1}/{len(token_payloads)}"
        print(f"\n--- {label} ---")
        try:
            creds = credentials_from_analytics_token_dict(payload)
            analytics = build("youtubeAnalytics", "v2", credentials=creds)
            currency_hint = _merge_revenue_for_one_login(
                analytics,
                merged,
                allowed,
                start_date,
                end_date,
                currency_hint,
                api_currency,
            )
        except HttpError as e:
            if e.resp.status == 401 and len(token_payloads) > 1:
                print(
                    f"  Skip {label}: 401 — re-authorize with monetary scope locally, "
                    f"then update YT_ANALYTICS_TOKEN_JSON / YT_ANALYTICS_TOKENS_JSON on Railway:\n"
                    f"    .venv/bin/python -m scraper.youtube_analytics_oauth_console"
                )
                continue
            if e.resp.status == 401:
                print(
                    "\n*** 401 revenue access *** Re-run locally:\n"
                    "  python -m scraper.youtube_analytics_oauth_console\n"
                    "Then paste refreshed JSON into Railway YT_ANALYTICS_TOKEN_JSON.\n"
                )
            raise

    daily = list(merged.values())
    print(
        f"Total {len(daily)} day×channel revenue rows "
        f"(API currency param: {api_currency or 'default USD'}; "
        f"last column header hint: {currency_hint})"
    )

    sheets = _get_sheets_service()
    _ensure_tab_exists(sheets, spreadsheet_id, finance_tab)

    existing = _read_admin_finance(sheets, spreadsheet_id, finance_tab)
    header, manual_rows = _parse_manual_rows(existing)
    auto_map = _parse_auto_row_map(existing)

    # Replace auto rows only inside this scrape window; keep older auto history
    for key in list(auto_map.keys()):
        date_part = key.split("|", 1)[0]
        if start_date <= date_part <= end_date:
            del auto_map[key]

    kept = 0
    for d in daily:
        ch_name = str(d.get("display_name") or d["channel_id"]).strip()
        rev = float(d["revenue"])
        cur_code = _normalize_api_currency(str(d.get("currency") or currency_hint))
        note = f"{AUTO_NOTE_TAG} {cur_code} · YouTube Analytics"
        key = f"{d['date']}|{ch_name}"
        auto_map[key] = [
            d["date"],
            ch_name,
            round(rev, 4),
            0,
            note,
        ]
        kept += 1

    print(f"Merged {kept} revenue row(s) (window {start_date}…{end_date})")

    auto_rows = sorted(auto_map.values(), key=lambda r: (str(r[0]), str(r[1])))
    out_values = [header] + manual_rows + auto_rows

    sheets.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=_sheet_a1(finance_tab, "A1"),
        valueInputOption="USER_ENTERED",
        body={"values": out_values},
    ).execute()

    print(
        f"Done. Wrote adminfinance tab '{finance_tab}': "
        f"{len(manual_rows)} manual row(s) + {len(auto_rows)} revenue row(s)."
    )


if __name__ == "__main__":
    run()
