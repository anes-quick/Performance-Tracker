# Environment variables — Vercel vs Railway

Use **your real values** everywhere. Do not commit secrets to Git.

**Generate copy-paste tables from your existing local files** (reads `frontend/.env.local`, `scraper/.env`, service account JSON, `scraper/analytics-token*.json`):

```bash
cd "/path/to/Performance Tracker"
python3 scripts/print-platform-envs.py
```

Optional: `VERCEL_PRODUCTION_URL=https://your-app.vercel.app python3 scripts/print-platform-envs.py` if not using the default URL in the script.

---

## Vercel (Next.js app + `/api/*`)

| Variable | What to put |
|----------|-------------|
| **`NEXTAUTH_SECRET`** | Long random string (e.g. run `openssl rand -base64 32` on your Mac). |
| **`NEXTAUTH_URL`** | Your live site URL, e.g. `https://your-project.vercel.app` — set after first deploy, then **redeploy**. |
| **`ADMIN_USERNAME`** | Login for `/admin` (default locally is `admin` if unset). |
| **`ADMIN_PASSWORD`** | Password for `/admin` (required or admin login is disabled). |
| **`GOOGLE_SERVICE_ACCOUNT_JSON`** | **Recommended on Vercel:** paste the **entire** Google service account JSON (one variable, multiline OK). Same JSON file you use for Sheets locally. Share your spreadsheet with the service account email. |
| **`GOOGLE_APPLICATION_CREDENTIALS`** | **Optional / local-style:** absolute path to the JSON file — only works where that path exists (usually **not** on Vercel). If `GOOGLE_SERVICE_ACCOUNT_JSON` is set, it wins. |

### Optional (Vercel)

| Variable | What to put |
|----------|-------------|
| **`FALLBACK_USD_EUR_RATE`** | e.g. `0.92` if the FX API fails (admin finance). |
| **`YT_ANALYTICS_INCLUDE_TODAY_PACIFIC`** | `true` or `1` to match rolling windows that include “today” Pacific (admin API hint only). |

---

## Railway (Python scrapers / `nightly-scrape.sh`)

| Variable | What to put |
|----------|-------------|
| **`GOOGLE_SERVICE_ACCOUNT_JSON`** | Paste the **same** full service account JSON as on Vercel (minified one line is safest). |
| **`GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`** | **If JSON var breaks on Railway:** one-line base64 of that file: `base64 -i key.json \| tr -d '\n'` (macOS). The scraper decodes this automatically. |
| **`GOOGLE_APPLICATION_CREDENTIALS`** | **Do not** set this to a **Mac path** (`/Users/...`) — that file is **not** in the container. Only use if the JSON exists **inside** the image (e.g. `/app/sa.json` from a custom step). |
| **`YOUTUBE_API_KEY`** | YouTube Data API v3 key (same as local `scraper/.env`). |

### Optional (Railway)

| Variable | What to put |
|----------|-------------|
| **`YT_ANALYTICS_INCLUDE_TODAY_PACIFIC`** | `true` / `false` — views scraper date window. |
| **`YT_ANALYTICS_REVENUE_CURRENCY`** | e.g. `EUR` — revenue scraper currency override. |
| **`YT_ANALYTICS_TOKEN_PATHS`** | Comma-separated paths to OAuth token JSON files if you use multiple (see `scraper/REAUTH_REVENUE.md`). |
| **`YT_ANALYTICS_TOKEN_PAUSE_SEC`** | Seconds between Analytics calls (default `0`). |

### YouTube Analytics OAuth (revenue / views scrapers)

The scripts need **refresh token JSON** files (from `python -m scraper.youtube_analytics_oauth_console` locally). On Railway you must **provide those files** (e.g. volume, or encode and write in a startup script). See **`scraper/REAUTH_REVENUE.md`**. Until that’s set up, `scraper.run` can still work with only **`GOOGLE_SERVICE_ACCOUNT_JSON`** + **`YOUTUBE_API_KEY`**; Analytics steps may fail until tokens exist.

---

## Same Google account?

You can use the **same service account JSON** for **`GOOGLE_SERVICE_ACCOUNT_JSON`** on **both** Vercel and Railway — paste it in **each** platform’s env UI (two separate places).
