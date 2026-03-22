#!/usr/bin/env python3
"""
Reads secrets from your existing local files and prints copy-paste blocks for Vercel + Railway.
Run from repo root:  python3 scripts/print-platform-envs.py

Does not upload anything. Output is only to your terminal.
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Your live site (change if needed)
DEFAULT_VERCEL_URL = "https://performance-tracker-beca.vercel.app"


def parse_dotenv(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
        if not m:
            continue
        k, v = m.group(1), m.group(2).strip()
        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
            v = v[1:-1]
        out[k] = v
    return out


def find_service_account_json_path(env_local: dict, scraper_env: dict) -> Path | None:
    for d in (env_local, scraper_env):
        p = d.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
        if p:
            cand = Path(p).expanduser()
            if cand.is_file():
                return cand
    for g in sorted(ROOT.glob("neon-feat*.json")):
        return g
    return None


def minify_json_file(p: Path) -> str:
    data = json.loads(p.read_text(encoding="utf-8"))
    return json.dumps(data, separators=(",", ":"))


def main() -> int:
    fe = parse_dotenv(ROOT / "frontend" / ".env.local")
    se = parse_dotenv(ROOT / "scraper" / ".env")
    sa_path = find_service_account_json_path(fe, se)
    if not sa_path:
        print("ERROR: No service account JSON found (check GOOGLE_APPLICATION_CREDENTIALS or neon-feat*.json).", file=sys.stderr)
        return 1

    sa_blob = minify_json_file(sa_path)
    sa_b64 = base64.standard_b64encode(sa_blob.encode("utf-8")).decode("ascii")
    vercel_url = os.environ.get("VERCEL_PRODUCTION_URL", DEFAULT_VERCEL_URL).rstrip("/")

    print("=" * 72)
    print("VERCEL — Settings → Environment Variables (Production)")
    print("Paste Name = column A, Value = column B. Multiline OK for JSON.")
    print("=" * 72)
    print()
    rows = [
        ("GOOGLE_SERVICE_ACCOUNT_JSON", sa_blob),
        ("NEXTAUTH_URL", vercel_url),
        ("NEXTAUTH_SECRET", fe.get("NEXTAUTH_SECRET", "")),
        ("ADMIN_USERNAME", fe.get("ADMIN_USERNAME", "admin")),
        ("ADMIN_PASSWORD", fe.get("ADMIN_PASSWORD", "")),
    ]
    print("| Name | Value |")
    print("|------|-------|")
    for name, val in rows:
        esc = val.replace("|", "\\|").replace("\n", " ")
        if len(esc) > 120:
            esc = esc[:117] + "..."
        print(f"| `{name}` | {esc} |")
    print()
    print("--- Raw (copy blocks) ---")
    for name, val in rows:
        print(f"\n{name}=\n{val}\n")

    yt = se.get("YOUTUBE_API_KEY", "").strip()
    if not yt:
        print("WARN: YOUTUBE_API_KEY missing in scraper/.env — add manually for Railway.", file=sys.stderr)

    print()
    print("=" * 72)
    print("RAILWAY — Variables")
    print("(Use GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 if Railway mangles multiline JSON.)")
    print("=" * 72)
    print()
    r_rows = [
        ("GOOGLE_SERVICE_ACCOUNT_JSON", sa_blob),
        ("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64", sa_b64),
        ("YOUTUBE_API_KEY", yt),
    ]
    token_dir = ROOT / "scraper"
    tokens = sorted(token_dir.glob("analytics-token*.json"))
    if tokens:
        # Single-file convenience: primary token JSON for custom start command
        primary = token_dir / "analytics-token.json"
        if primary.is_file():
            tok_raw = primary.read_text(encoding="utf-8")
            r_rows.append(("YT_ANALYTICS_TOKEN_JSON", tok_raw.strip()))
        rels = [p.name for p in tokens]
        r_rows.append(
            (
                "YT_ANALYTICS_TOKEN_PATHS",
                ",".join(rels),
            )
        )
    print("| Name | Value |")
    print("|------|-------|")
    for name, val in r_rows:
        esc = val.replace("|", "\\|").replace("\n", " ")
        if len(esc) > 120:
            esc = esc[:117] + "..."
        print(f"| `{name}` | {esc} |")
    print()
    print("--- Raw (copy blocks) ---")
    for name, val in r_rows:
        print(f"\n{name}=\n{val}\n")

    print()
    print("=" * 72)
    print("RAILWAY — suggested Start Command (writes token then nightly scrape)")
    print("=" * 72)
    if (token_dir / "analytics-token.json").is_file():
        print(
            r"""sh -c 'printf %s "$YT_ANALYTICS_TOKEN_JSON" > /app/scraper/analytics-token.json && bash scripts/nightly-scrape.sh'"""
        )
    else:
        print("(No scraper/analytics-token.json — run OAuth locally first or set paths manually.)")
    print()
    return 0


if __name__ == "__main__":
    os.chdir(ROOT)
    raise SystemExit(main())
