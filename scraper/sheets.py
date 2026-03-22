"""Google Sheets: read Sources (source_id -> name), append VideoStatsRaw rows."""
import json
import os
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


def _get_sheets_service():
    """Build Sheets API v4 service with service account credentials."""
    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    json_blob = (os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON") or "").strip()
    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")

    if json_blob:
        try:
            info = json.loads(json_blob)
        except json.JSONDecodeError as e:
            raise RuntimeError(
                "GOOGLE_SERVICE_ACCOUNT_JSON is set but is not valid JSON."
            ) from e
        credentials = service_account.Credentials.from_service_account_info(
            info, scopes=scopes
        )
    elif creds_path and os.path.isfile(creds_path):
        credentials = service_account.Credentials.from_service_account_file(
            creds_path, scopes=scopes
        )
    else:
        raise RuntimeError(
            "Set GOOGLE_APPLICATION_CREDENTIALS to the path of your service account JSON, "
            "or set GOOGLE_SERVICE_ACCOUNT_JSON to the full JSON (e.g. on Railway)."
        )
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
