#!/usr/bin/env python3
"""
Merge several single-object OAuth JSON files into one JSON array for Railway
variable YT_ALYTICS_TOKENS_JSON.

Usage (after you ran generate_token.py once per Google account):
  python merge_tokens_for_railway.py \\
    out/asenti.json out/aven.json out/mira.json out/nunito.json \\
    out/crazymomente-keep.json

Writes:
  railway-yt-analytics-tokens.json       (pretty, easy to read)
  railway-yt-analytics-tokens.compact.txt (one line, easy paste in Railway UI)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REQUIRED = frozenset({"refresh_token", "token_uri", "client_id", "client_secret"})


def load_one(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError(f"{path}: expected one JSON object, got {type(data).__name__}")
    missing = REQUIRED - data.keys()
    if missing:
        raise ValueError(f"{path}: missing keys: {sorted(missing)}")
    if not str(data.get("refresh_token", "")).strip():
        raise ValueError(f"{path}: empty refresh_token")
    return data


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Merge token JSON files into YT_ANALYTICS_TOKENS_JSON array."
    )
    ap.add_argument(
        "files",
        nargs="+",
        help="Paths to single-token JSON files (include CrazyMomente last if you like)",
    )
    ap.add_argument(
        "--out",
        default="railway-yt-analytics-tokens.json",
        help="Pretty-printed JSON array output path (default: %(default)s)",
    )
    args = ap.parse_args()

    paths = [Path(p).resolve() for p in args.files]
    for p in paths:
        if not p.is_file():
            print(f"error: file not found: {p}", file=sys.stderr)
            sys.exit(1)

    objs = [load_one(p) for p in paths]
    out_path = Path(args.out).resolve()
    pretty = json.dumps(objs, indent=2, ensure_ascii=False) + "\n"
    compact = json.dumps(objs, ensure_ascii=False, separators=(",", ":"))

    out_path.write_text(pretty, encoding="utf-8")
    compact_path = out_path.with_suffix(".compact.txt")
    compact_path.write_text(compact, encoding="utf-8")

    print(f"OK: merged {len(objs)} token(s)")
    print(f"  → {out_path}")
    print(f"  → {compact_path} (single line for Railway)")
    print("Paste the compact file contents into Railway → YT_ALYTICS_TOKENS_JSON")


if __name__ == "__main__":
    main()
