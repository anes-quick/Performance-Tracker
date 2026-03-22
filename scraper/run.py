"""
Daily video stats scraper: for each main channel, fetch last 60 days of videos,
parse Source ID from description, lookup source name from Sheets, append rows to videostatsraw.
"""
import re
from datetime import datetime, timezone

from pathlib import Path
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass  # env vars can be set in shell or by platform

from .config import load_config, get_channels
from .sheets import get_sources_lookup, append_video_stats_rows, append_channel_daily_rows
from .youtube_client import (
    resolve_channel_id,
    get_uploads_playlist_id,
    get_all_recent_videos_for_channel,
    get_channel_stats,
)

# Match SRC + digits in description (e.g. Source ID:SRC0010 or [ SRC0010 ])
SOURCE_ID_PATTERN = re.compile(r"SRC\d+", re.IGNORECASE)


def parse_source_id(description: str):
    """Extract first SRCxxxx id from video description. Returns None if not found."""
    if not description:
        return None
    m = SOURCE_ID_PATTERN.search(description)
    if not m:
        return None
    return m.group(0).upper()


def build_row(video: dict, main_channel_id: str, main_channel_name: str, niche: str, source_id, source_channel_name: str, scrape_utc: datetime) -> list:
    """Build one row for videostatsraw in order of VIDEOSTATS_HEADERS."""
    return [
        scrape_utc.isoformat(),
        main_channel_id,
        main_channel_name,
        niche,
        video["video_id"],
        f"https://www.youtube.com/watch?v={video['video_id']}",
        video.get("title", ""),
        video.get("published_at", ""),
        video.get("view_count", 0),
        source_id or "",
        source_channel_name or "",
    ]


def run():
    """Main entry: load config, fetch videos per channel, resolve sources, append to sheet."""
    config = load_config()
    channels = get_channels(config)
    sources_lookup = get_sources_lookup()
    scrape_utc = datetime.now(timezone.utc)
    all_rows = []

    for ch in channels:
        handle = ch.get("handle") or ch.get("name", "")
        name = ch.get("name", handle)
        niche = ch.get("niche", "")

        channel_id = resolve_channel_id(handle)
        if not channel_id:
            print(f"Skip channel (not found): {name} (@{handle})")
            continue

        uploads_playlist_id = get_uploads_playlist_id(channel_id)
        if not uploads_playlist_id:
            print(f"Skip channel (no uploads playlist): {name}")
            continue

        videos = get_all_recent_videos_for_channel(channel_id, uploads_playlist_id)
        print(f"Channel {name}: {len(videos)} videos (last 60 days)")

        for video in videos:
            source_id = parse_source_id(video.get("description", ""))
            source_channel_name = (sources_lookup.get(source_id, "") if source_id else "") or ""
            row = build_row(
                video,
                main_channel_id=channel_id,
                main_channel_name=name,
                niche=niche,
                source_id=source_id or "",
                source_channel_name=source_channel_name,
                scrape_utc=scrape_utc,
            )
            all_rows.append(row)

    if all_rows:
        append_video_stats_rows(all_rows)
        print(f"Appended {len(all_rows)} rows to videostatsraw.")
    else:
        print("No rows to append.")

    # Phase 3: channel daily stats (one row per channel)
    channel_daily_rows = []
    for ch in channels:
        handle = ch.get("handle") or ch.get("name", "")
        name = ch.get("name", handle)
        channel_id = resolve_channel_id(handle)
        if not channel_id:
            continue
        stats = get_channel_stats(channel_id)
        if not stats:
            continue
        channel_daily_rows.append([
            scrape_utc.date().isoformat(),
            channel_id,
            name,
            stats["view_count"],
            stats["subscriber_count"],
            stats["video_count"],
        ])
    if channel_daily_rows:
        append_channel_daily_rows(channel_daily_rows)
        print(f"Appended {len(channel_daily_rows)} rows to channeldaily.")


if __name__ == "__main__":
    run()
