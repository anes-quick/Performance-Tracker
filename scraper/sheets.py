"""Google Sheets: read Sources (source_id -> name), append VideoStatsRaw rows."""
import base64
import binascii
import json
import os
from pathlib import Path
from typing import List, Optional

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from .config import load_config, get_spreadsheet_id, get_sources_tab, get_video_stats_tab, get_channel_daily_tab

# Sources sheet: header row 5, data from row 6. B=Channel, C=Channel ID, D=Tracking ID, E=Link
SOURCES_HEADER_ROW = 5
SOURCES_DATA_START = 6
SOURCES_COLS = "B:E"  # Channel, Channel ID, Tracking ID, Link → indices 0,1,2,3

# VideoStatsRaw: columns we write (order matters for append)
VIDEOSTATS_HEADERS = [
    "scrape_datetime",
    "main_channel_id",
    "main_channel_name",
    "niche",
    "video_id",
    "video_url",
    "title",
    "published_at",
    "views",
    "source_id",
    "source_channel_name",
]


def _project_root() -> Path:
    """Repo root (parent of the `scraper` package)."""
    return Path(__file__).resolve().parent.parent


def _is_service_account_json_file(path: str) -> bool:
    if not os.path.isfile(path):
        return False
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return (
            isinstance(data, dict)
            and data.get("type") == "service_account"
            and "private_key" in data
        )
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return False


def _local_service_account_file_candidates() -> List[str]:
    """
    For local dev when Railway/Vercel-style env vars are not set (or
    GOOGLE_APPLICATION_CREDENTIALS points at a path that only existed on another machine).

    Tries, in order:
    - LOCAL_GOOGLE_APPLICATION_CREDENTIALS (absolute or relative to repo root)
    - service-account.json
    - google-service-account.json
    - neon-feat-489318-r3-18ed3ecc014d.json (legacy name in this project)
    - any neon-feat*.json in repo root (first match by sorted name)
    """
    root = _project_root()
    out: List[str] = []

    local = (os.environ.get("LOCAL_GOOGLE_APPLICATION_CREDENTIALS") or "").strip()
    if local:
        p = Path(local)
        out.append(str(p if p.is_absolute() else (root / local)))

    for name in (
        "service-account.json",
        "google-service-account.json",
        "neon-feat-489318-r3-18ed3ecc014d.json",
    ):
        out.append(str(root / name))

    try:
        for p in sorted(root.glob("neon-feat*.json")):
            s = str(p)
            if s not in out:
                out.append(s)
    except OSError:
        pass

    return out


def _resolve_local_service_account_path() -> Optional[str]:
    for path in _local_service_account_file_candidates():
        if _is_service_account_json_file(path):
            return path
    return None


def _credentials_from_json_blob(json_blob: str, source_label: str):
    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    try:
        info = json.loads(json_blob)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"{source_label} is set but is not valid JSON. "
            "If you pasted on Railway, try GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 instead "
            "(run: base64 -i your-key.json | tr -d '\\n')."
        ) from e
    return service_account.Credentials.from_service_account_info(info, scopes=scopes)


def _get_sheets_service():
    """Build Sheets API v4 service with service account credentials."""
    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    json_blob = (os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON") or "").strip()
    json_b64 = (os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64") or "").strip()
    creds_path = (os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or "").strip() or None

    if json_blob:
        credentials = _credentials_from_json_blob(json_blob, "GOOGLE_SERVICE_ACCOUNT_JSON")
    elif json_b64:
        try:
            raw = base64.b64decode(json_b64, validate=True)
        except binascii.Error as e:
            raise RuntimeError(
                "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not valid base64."
            ) from e
        try:
            decoded = raw.decode("utf-8")
        except UnicodeDecodeError as e:
            raise RuntimeError(
                "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 decodes to non-UTF-8 bytes."
            ) from e
        credentials = _credentials_from_json_blob(
            decoded, "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 (decoded)"
        )
    elif creds_path and os.path.isfile(creds_path):
        credentials = service_account.Credentials.from_service_account_file(
            creds_path, scopes=scopes
        )
    else:
        local_sa = _resolve_local_service_account_path()
        if local_sa:
            credentials = service_account.Credentials.from_service_account_file(
                local_sa, scopes=scopes
            )
        else:
            hints = []
            if creds_path:
                if creds_path.startswith("/Users/") or creds_path.startswith("/home/"):
                    hints.append(
                        f"GOOGLE_APPLICATION_CREDENTIALS points to {creds_path!r} — that path "
                        "exists on your laptop, not inside Railway/Docker. "
                        "Add GOOGLE_SERVICE_ACCOUNT_JSON (full JSON) or "
                        "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 in Railway Variables."
                    )
                elif not os.path.isfile(creds_path):
                    hints.append(
                        f"GOOGLE_APPLICATION_CREDENTIALS is {creds_path!r} but that file is missing. "
                        "For local runs, put a service account JSON in the project root as "
                        "service-account.json or neon-feat*.json, or set LOCAL_GOOGLE_APPLICATION_CREDENTIALS."
                    )
            else:
                hints.append(
                    "No GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 in the environment. "
                    "For local runs, add service-account.json (or neon-feat*.json) in the project root, "
                    "or set LOCAL_GOOGLE_APPLICATION_CREDENTIALS."
                )
            msg = (
                "Google Sheets credentials missing. In Railway: add variable "
                "GOOGLE_SERVICE_ACCOUNT_JSON with the full service account JSON, "
                "or GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 (base64 of that file, one line). "
            )
            if hints:
                msg += " ".join(hints)
            raise RuntimeError(msg)
    return build("sheets", "v4", credentials=credentials)


def get_sources_lookup(spreadsheet_id=None, tab_name=None):
    """
    Read Sources sheet and return a dict: source_id (e.g. SRC0001) -> source_channel_name.
    Uses columns B (Channel name) and D (Tracking ID); header row 5, data from row 6.
    """
    config = load_config()
    spreadsheet_id = spreadsheet_id or config["spreadsheetId"]
    tab_name = tab_name or config.get("sourcesTab", "sheet")
    range_name = f"'{tab_name}'!B{SOURCES_DATA_START}:E1000"

    sheets = _get_sheets_service()
    result = (
        sheets.spreadsheets()
        .values()
        .get(spreadsheetId=spreadsheet_id, range=range_name)
        .execute()
    )
    rows = result.get("values", [])
    lookup = {}
    for row in rows:
        # row: [Channel, Channel ID, Tracking ID, Link] -> indices 0,1,2,3
        if len(row) >= 3 and row[2].strip():
            tracking_id = row[2].strip().upper()
            channel_name = row[0].strip() if len(row) > 0 and row[0] else ""
            lookup[tracking_id] = channel_name
    return lookup


def ensure_videostats_headers(spreadsheet_id=None, tab_name=None):
    """If videostatsraw tab is empty, set the header row (row 1)."""
    config = load_config()
    spreadsheet_id = spreadsheet_id or config["spreadsheetId"]
    tab_name = tab_name or config.get("videoStatsRawTab", "videostatsraw")
    range_name = f"'{tab_name}'!A1:K1"

    sheets = _get_sheets_service()
    result = (
        sheets.spreadsheets()
        .values()
        .get(spreadsheetId=spreadsheet_id, range=range_name)
        .execute()
    )
    values = result.get("values", [])
    if not values or not any(cell for cell in (values[0] if values else [])):
        sheets.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            body={"values": [VIDEOSTATS_HEADERS]},
            valueInputOption="USER_ENTERED",
        ).execute()


def append_video_stats_rows(rows, spreadsheet_id=None, tab_name=None):
    """
    Append one or more rows to the videostatsraw sheet.
    Each row must be a list in the same order as VIDEOSTATS_HEADERS.
    """
    if not rows:
        return
    config = load_config()
    spreadsheet_id = spreadsheet_id or config["spreadsheetId"]
    tab_name = tab_name or config.get("videoStatsRawTab", "videostatsraw")
    range_name = f"'{tab_name}'!A:K"

    ensure_videostats_headers(spreadsheet_id, tab_name)

    sheets = _get_sheets_service()
    sheets.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range=range_name,
        valueInputOption="USER_ENTERED",
        insertDataOption="INSERT_ROWS",
        body={"values": rows},
    ).execute()


# Channel daily: one row per channel per day
CHANNEL_DAILY_HEADERS = [
    "date",
    "channel_id",
    "channel_name",
    "total_views",
    "total_subscribers",
    "total_videos",
]


def ensure_channel_daily_headers(spreadsheet_id=None, tab_name=None):
    """If channeldaily tab has no headers, set row 1."""
    config = load_config()
    spreadsheet_id = spreadsheet_id or config["spreadsheetId"]
    tab_name = tab_name or get_channel_daily_tab(config)
    range_name = f"'{tab_name}'!A1:F1"

    sheets = _get_sheets_service()
    result = (
        sheets.spreadsheets()
        .values()
        .get(spreadsheetId=spreadsheet_id, range=range_name)
        .execute()
    )
    values = result.get("values", [])
    if not values or not any(cell for cell in (values[0] if values else [])):
        sheets.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            body={"values": [CHANNEL_DAILY_HEADERS]},
            valueInputOption="USER_ENTERED",
        ).execute()


def append_channel_daily_rows(rows, spreadsheet_id=None, tab_name=None):
    """Append rows to the channeldaily sheet. Each row: [date, channel_id, channel_name, total_views, total_subscribers, total_videos]."""
    if not rows:
        return
    config = load_config()
    spreadsheet_id = spreadsheet_id or config["spreadsheetId"]
    tab_name = tab_name or get_channel_daily_tab(config)
    range_name = f"'{tab_name}'!A:F"

    ensure_channel_daily_headers(spreadsheet_id, tab_name)

    sheets = _get_sheets_service()
    sheets.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range=range_name,
        valueInputOption="USER_ENTERED",
        insertDataOption="INSERT_ROWS",
        body={"values": rows},
    ).execute()
