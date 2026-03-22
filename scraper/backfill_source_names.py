"""Backfill source channel names in the Sources sheet using YouTube channel IDs.

For each row in the `sheet` tab (Sources) where:
- Column B (Channel name) is empty
- Column C (Channel ID) has a value
- Column D (Tracking ID) has a value

we fetch the channel title from YouTube Data API v3 and write it into Column B.

Run once (or occasionally) with:

  .venv/bin/python -m scraper.backfill_source_names
"""

from __future__ import annotations

from typing import List, Tuple

from googleapiclient.errors import HttpError

from .config import load_config
from .sheets import _get_sheets_service  # type: ignore
from .youtube_client import _get_youtube  # type: ignore


def _fetch_missing_sources() -> List[Tuple[int, str, str]]:
    """Return list of (row_index, channel_id, tracking_id) with missing names.

    row_index is the absolute row number in the sheet (1-based).
    """
    config = load_config()
    spreadsheet_id = config["spreadsheetId"]
    tab_name = config.get("sourcesTab", "sheet")

    sheets = _get_sheets_service()
    # B = Channel name, C = Channel ID, D = Tracking ID. Data starts at row 6.
    range_name = f"'{tab_name}'!B6:D1000"
    res = (
        sheets.spreadsheets()
        .values()
        .get(spreadsheetId=spreadsheet_id, range=range_name)
        .execute()
    )
    rows = res.get("values", []) or []

    missing: List[Tuple[int, str, str]] = []
    for idx, row in enumerate(rows):
        # rowIndex in sheet = 6 + idx
        row_number = 6 + idx
        # row: [ChannelName?, ChannelID?, TrackingID?]
        channel_name = row[0].strip() if len(row) > 0 and row[0] else ""
        channel_id = row[1].strip() if len(row) > 1 and row[1] else ""
        tracking_id = row[2].strip() if len(row) > 2 and row[2] else ""
        if channel_name or not channel_id or not tracking_id:
            continue
        missing.append((row_number, channel_id, tracking_id))

    return missing


def _get_channel_title(channel_id: str) -> str | None:
    youtube = _get_youtube()
    request = youtube.channels().list(part="snippet", id=channel_id)
    response = request.execute()
    items = response.get("items", [])
    if not items:
        return None
    return items[0].get("snippet", {}).get("title")


def backfill():
    config = load_config()
    spreadsheet_id = config["spreadsheetId"]
    tab_name = config.get("sourcesTab", "sheet")

    sheets = _get_sheets_service()

    missing = _fetch_missing_sources()
    if not missing:
        print("No missing source names to backfill.")
        return

    print(f"Found {len(missing)} sources without names. Updating...")

    updates = []
    for row_number, channel_id, tracking_id in missing:
        try:
            title = _get_channel_title(channel_id)
        except HttpError as e:
            print(f"Error fetching title for channel {channel_id}: {e}")
            continue
        if not title:
            print(f"No title found for channel {channel_id} (tracking {tracking_id})")
            continue
        updates.append((row_number, title))

    if not updates:
        print("No titles could be resolved.")
        return

    for row_number, title in updates:
        range_name = f"'{tab_name}'!B{row_number}"
        sheets.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueInputOption="USER_ENTERED",
            body={"values": [[title]]},
        ).execute()
        print(f"Updated row {row_number} with name: {title}")

    print("Backfill completed.")


if __name__ == "__main__":
    backfill()

