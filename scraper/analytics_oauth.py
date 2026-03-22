"""Shared OAuth refresh for YouTube Analytics API (views + monetary metrics)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

TOKEN_PATH_DEFAULT = Path(__file__).resolve().parent / "analytics-token.json"
TOKEN_PATH_ENV = "YT_ANALYTICS_TOKEN_PATH"


def load_oauth_credentials(token_path: Optional[Path] = None) -> Credentials:
    """
    Load refresh token from JSON. If token_path is None, uses YT_ANALYTICS_TOKEN_PATH
    env var or scraper/analytics-token.json.
    """
    if token_path is None:
        token_path_str = os.environ.get(TOKEN_PATH_ENV)
        token_path = Path(token_path_str) if token_path_str else TOKEN_PATH_DEFAULT

    if not token_path.exists():
        raise FileNotFoundError(
            f"Missing OAuth token file: {token_path}. "
            "Run: python -m scraper.youtube_analytics_oauth_console"
        )
    data = json.loads(token_path.read_text(encoding="utf-8"))
    scopes = data.get("scopes") or [
        "https://www.googleapis.com/auth/yt-analytics.readonly",
        "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
    ]

    creds = Credentials(
        token=None,
        refresh_token=data["refresh_token"],
        token_uri=data["token_uri"],
        client_id=data["client_id"],
        client_secret=data["client_secret"],
        scopes=scopes,
    )
    creds.refresh(Request())
    return creds
