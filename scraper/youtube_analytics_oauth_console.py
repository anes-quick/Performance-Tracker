"""
OAuth "login once" flow for YouTube Analytics API (read-only).

This script runs the Desktop OAuth flow using your OAuth client JSON and
starts a local redirect server. You approve access in your browser, and the
script stores `analytics-token.json` (refresh_token) for later scrapes.

Run:
  export YT_ANALYTICS_OAUTH_CLIENT_SECRET_PATH="/path/to/client_secret_....json"
  .venv/bin/python -m scraper.youtube_analytics_oauth_console
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request


def main() -> None:
    project_root = Path(__file__).resolve().parent.parent
    client_secret_default = project_root / "client_secret.json"

    client_secret_path = os.environ.get(
        "YT_ANALYTICS_OAUTH_CLIENT_SECRET_PATH", str(client_secret_default)
    )

    client_secret_file = Path(client_secret_path)
    if not client_secret_file.exists():
        raise FileNotFoundError(
            f"OAuth client secret JSON not found: {client_secret_file}"
        )

    # Monetary scope required for estimatedRevenue / ad revenue in Analytics API
    scopes = [
        "https://www.googleapis.com/auth/yt-analytics.readonly",
        "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
    ]

    flow = InstalledAppFlow.from_client_secrets_file(
        client_secret_file.as_posix(), scopes=scopes
    )

    # Starts a local server and opens a browser for you to approve.
    # This is the simplest way to get a refresh_token.
    creds = flow.run_local_server(
        port=0,
        authorization_prompt_message="Approve YouTube Analytics access",
        prompt="consent",
        access_type="offline",
    )
    if not creds.refresh_token:
        # Some flows might not return refresh_token depending on parameters and consent state.
        # In that case, re-run with prompt=consent and ensure you are using the intended test user.
        raise RuntimeError(
            "No refresh_token returned. Re-run and ensure you're approving the same OAuth app/user."
        )

    out_name = os.environ.get("YT_ANALYTICS_TOKEN_OUT", "analytics-token.json")
    out_path = Path(__file__).resolve().parent / out_name
    out = {
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": creds.scopes,
    }

    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\nSaved refresh token to: {out_path.as_posix()}\n")

    # Quick sanity check: ensure token can be refreshed
    creds.refresh(Request())
    print("Token refresh check: OK\n")


if __name__ == "__main__":
    main()

