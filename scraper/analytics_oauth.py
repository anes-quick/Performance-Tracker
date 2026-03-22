"""Shared OAuth refresh for YouTube Analytics API (views + monetary metrics)."""

from __future__ import annotations

import base64
import binascii
import json
import os
from pathlib import Path
from typing import List, Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

TOKEN_PATH_DEFAULT = Path(__file__).resolve().parent / "analytics-token.json"
TOKEN_PATH_ENV = "YT_ANALYTICS_TOKEN_PATH"

_SCOPES_DEFAULT = [
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
]


def credentials_from_analytics_token_dict(data: dict) -> Credentials:
    """Build refreshed Credentials from one analytics-token.json-shaped dict."""
    scopes = data.get("scopes") or list(_SCOPES_DEFAULT)
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


def _parse_token_json_blob(blob: str) -> List[dict]:
    data = json.loads(blob)
    if isinstance(data, dict):
        return [data]
    if isinstance(data, list):
        out = [x for x in data if isinstance(x, dict) and x.get("refresh_token")]
        if not out:
            raise ValueError(
                "JSON array must contain objects with refresh_token, client_id, client_secret, token_uri"
            )
        return out
    raise ValueError("OAuth token JSON must be an object or array of objects")


def _maybe_b64_decode(value: str, *, is_b64: bool) -> str:
    if not is_b64:
        return value
    try:
        return base64.b64decode(value, validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError) as e:
        raise ValueError("Invalid YT_ANALYTICS_*_BASE64 value") from e


def discover_youtube_analytics_token_payloads() -> List[dict]:
    """
    All YouTube Analytics OAuth identities to use (views + revenue).

    Order:
    1. YT_ANALYTICS_TOKENS_JSON or YT_ANALYTICS_TOKENS_JSON_BASE64 (JSON array or single object)
    2. YT_ANALYTICS_TOKEN_JSON or YT_ANALYTICS_TOKEN_JSON_BASE64 (same; Railway-friendly)
    3. YT_ANALYTICS_TOKEN_PATH (single file)
    4. YT_ANALYTICS_TOKEN_PATHS (comma-separated files under scraper/ or absolute)
    5. scraper/analytics-token*.json glob, else analytics-token.json

    Paste the contents of local scraper/analytics-token.json (or JSON array of those objects)
    into Railway — no file needed in the container.
    """
    scraper_dir = Path(__file__).resolve().parent

    env_pairs: list[tuple[str, bool]] = [
        ("YT_ANALYTICS_TOKENS_JSON", False),
        ("YT_ANALYTICS_TOKENS_JSON_BASE64", True),
        ("YT_ANALYTICS_TOKEN_JSON", False),
        ("YT_ANALYTICS_TOKEN_JSON_BASE64", True),
    ]
    for key, is_b64 in env_pairs:
        raw = (os.environ.get(key) or "").strip()
        if not raw:
            continue
        try:
            blob = _maybe_b64_decode(raw, is_b64=is_b64)
            return _parse_token_json_blob(blob)
        except (json.JSONDecodeError, ValueError) as e:
            raise RuntimeError(
                f"{key} is set but invalid: {e}. "
                "Paste valid JSON from scraper/analytics-token.json (or a JSON array of them)."
            ) from e

    path_str = (os.environ.get(TOKEN_PATH_ENV) or "").strip()
    if path_str:
        p = Path(path_str).expanduser()
        if not p.is_absolute():
            p = scraper_dir / p
        if p.is_file():
            return _parse_token_json_blob(p.read_text(encoding="utf-8"))

    env_csv = (os.environ.get("YT_ANALYTICS_TOKEN_PATHS") or "").strip()
    if env_csv:
        out: List[dict] = []
        for part in env_csv.split(","):
            p = Path(part.strip()).expanduser()
            if not p.is_absolute():
                p = scraper_dir / p
            if p.is_file():
                out.extend(_parse_token_json_blob(p.read_text(encoding="utf-8")))
        if out:
            return out
        print("  YT_ANALYTICS_TOKEN_PATHS set but no files found; falling back to glob")

    paths = sorted(scraper_dir.glob("analytics-token*.json"))
    if paths:
        merged: List[dict] = []
        for p in paths:
            merged.extend(_parse_token_json_blob(p.read_text(encoding="utf-8")))
        return merged

    default = scraper_dir / "analytics-token.json"
    if default.is_file():
        return _parse_token_json_blob(default.read_text(encoding="utf-8"))

    raise FileNotFoundError(
        "No YouTube Analytics OAuth token. Options:\n"
        "  • Railway: set YT_ANALYTICS_TOKEN_JSON to the full JSON from scraper/analytics-token.json "
        "(or YT_ANALYTICS_TOKENS_JSON as a JSON array for multiple Google accounts).\n"
        "  • Local: run: python -m scraper.youtube_analytics_oauth_console"
    )


def load_oauth_credentials(token_path: Optional[Path] = None) -> Credentials:
    """
    Load one OAuth identity. If token_path is set, read that file only.
    Otherwise use discover_youtube_analytics_token_payloads() and take the first payload.
    """
    if token_path is not None:
        if not token_path.exists():
            raise FileNotFoundError(
                f"Missing OAuth token file: {token_path}. "
                "Run: python -m scraper.youtube_analytics_oauth_console"
            )
        data = json.loads(token_path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError(f"Expected a single JSON object in {token_path}")
        return credentials_from_analytics_token_dict(data)

    payloads = discover_youtube_analytics_token_payloads()
    return credentials_from_analytics_token_dict(payloads[0])
