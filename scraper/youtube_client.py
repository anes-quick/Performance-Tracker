"""
YouTube Data API v3: resolve handle -> channel ID, list uploads, batch fetch video stats.
Uses an API key (public data only).
"""
import os
from datetime import datetime, timedelta, timezone
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# Track videos for 60 days after publish
TRACK_DAYS = 60


def _get_youtube():
    """Build YouTube API client. Requires YOUTUBE_API_KEY env var."""
    api_key = os.environ.get("YOUTUBE_API_KEY")
    if not api_key:
        raise RuntimeError("Set YOUTUBE_API_KEY in the environment.")
    return build("youtube", "v3", developerKey=api_key)


def resolve_channel_title(channel_id: str):
    """Public channel title for a channel ID (Data API v3, API key)."""
    if not channel_id:
        return None
    youtube = _get_youtube()
    request = youtube.channels().list(part="snippet", id=channel_id)
    response = request.execute()
    items = response.get("items", [])
    if not items:
        return None
    t = items[0].get("snippet", {}).get("title", "")
    return t.strip() or None


def resolve_channel_id(handle: str):
    """
    Resolve @handle to YouTube channel ID using channels.list(forHandle=...).
    Returns channel_id or None if not found.
    """
    handle_clean = handle.lstrip("@")
    youtube = _get_youtube()
    request = youtube.channels().list(
        part="id,snippet,contentDetails",
        forHandle=handle_clean,
    )
    response = request.execute()
    items = response.get("items", [])
    if not items:
        return None
    return items[0]["id"]


def get_uploads_playlist_id(channel_id: str):
    """Get the uploads playlist ID for a channel (contentDetails.relatedPlaylists.uploads)."""
    youtube = _get_youtube()
    request = youtube.channels().list(
        part="contentDetails",
        id=channel_id,
    )
    response = request.execute()
    items = response.get("items", [])
    if not items:
        return None
    return items[0].get("contentDetails", {}).get("relatedPlaylists", {}).get("uploads")


def list_recent_video_ids(playlist_id: str, published_after: datetime):
    """
    List all video IDs from the uploads playlist that were published on or after published_after.
    playlistItems.list returns newest first; we paginate until we get too old.
    """
    youtube = _get_youtube()
    video_ids = []
    page_token = None
    cutoff = published_after

    while True:
        request = youtube.playlistItems().list(
            part="snippet",
            playlistId=playlist_id,
            maxResults=50,
            pageToken=page_token or "",
        )
        response = request.execute()
        for item in response.get("items", []):
            published_str = item.get("snippet", {}).get("publishedAt")
            if not published_str:
                continue
            try:
                pub_dt = datetime.fromisoformat(
                    published_str.replace("Z", "+00:00")
                )
            except Exception:
                continue
            if pub_dt < cutoff:
                return video_ids  # rest are older, stop
            vid = item.get("snippet", {}).get("resourceId", {}).get("videoId")
            if vid:
                video_ids.append(vid)
        page_token = response.get("nextPageToken")
        if not page_token:
            break
    return video_ids


def get_video_batch(video_ids: list):
    """
    Fetch snippet + statistics for up to 50 video IDs (videos.list).
    Returns list of dicts: video_id, title, published_at, view_count, description, channel_id, channel_title.
    """
    if not video_ids:
        return []
    youtube = _get_youtube()
    # API allows max 50 IDs per request
    chunk = video_ids[:50]
    request = youtube.videos().list(
        part="snippet,statistics",
        id=",".join(chunk),
    )
    response = request.execute()
    out = []
    for item in response.get("items", []):
        vid = item.get("id")
        sn = item.get("snippet", {})
        stats = item.get("statistics", {})
        out.append({
            "video_id": vid,
            "title": sn.get("title", ""),
            "published_at": sn.get("publishedAt", ""),
            "view_count": int(stats.get("viewCount", 0) or 0),
            "description": sn.get("description", ""),
            "channel_id": sn.get("channelId", ""),
            "channel_title": sn.get("channelTitle", ""),
        })
    return out


def get_channel_stats(channel_id: str):
    """
    Get channel statistics via channels.list(part=statistics,snippet).
    Returns dict: channel_id, channel_title, view_count, subscriber_count, video_count.
    """
    youtube = _get_youtube()
    request = youtube.channels().list(
        part="snippet,statistics",
        id=channel_id,
    )
    response = request.execute()
    items = response.get("items", [])
    if not items:
        return None
    item = items[0]
    stats = item.get("statistics", {})
    return {
        "channel_id": channel_id,
        "channel_title": item.get("snippet", {}).get("title", ""),
        "view_count": int(stats.get("viewCount", 0) or 0),
        "subscriber_count": int(stats.get("subscriberCount", 0) or 0),
        "video_count": int(stats.get("videoCount", 0) or 0),
    }


def get_all_recent_videos_for_channel(channel_id: str, uploads_playlist_id: str):
    """
    Get all videos from the channel published in the last TRACK_DAYS days.
    Returns list of video dicts (video_id, title, published_at, view_count, description, channel_id, channel_title).
    """
    now = datetime.now(timezone.utc)
    published_after = now - timedelta(days=TRACK_DAYS)
    video_ids = list_recent_video_ids(uploads_playlist_id, published_after)
    all_videos = []
    for i in range(0, len(video_ids), 50):
        batch_ids = video_ids[i : i + 50]
        all_videos.extend(get_video_batch(batch_ids))
    return all_videos
