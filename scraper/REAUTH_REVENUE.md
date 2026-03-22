# Why only one channel shows in `/admin` finance

YouTube **estimated revenue** is returned per **Google login**.  
`analytics-token.json` is usually **one** account → you only see channels that account owns in Analytics.

To see **Nunito, Aven, Mira, …** you need a **valid OAuth token file per Google account** that owns those channels, each authorized with **monetary** Analytics scope.

---

## 1) See what’s broken (30 seconds)

From the **Performance Tracker** project root:

```bash
.venv/bin/python -m scraper.diagnose_revenue_tokens
```

- **OK** = that file can read revenue; note which channel id(s) appear.
- **401** = re-run OAuth below for **that filename** (wrong/expired scope).
- **403** = wrong Google account or channel not eligible for revenue in API.

---

## 2) Re-authorize one token file (repeat per brand / login)

Use your real paths. **Log in with the Google account that owns that YouTube channel** when the browser opens.

```bash
cd "/Users/anes/Documents/Vibe Coding stuff/Performance Tracker"

export YT_ANALYTICS_OAUTH_CLIENT_SECRET_PATH="/full/path/to/client_secret_....apps.googleusercontent.com.json"

# Aven’s Google account → save into this file:
export YT_ANALYTICS_TOKEN_OUT=analytics-token-aven.json
.venv/bin/python -m scraper.youtube_analytics_oauth_console

# Nunito’s Google account:
export YT_ANALYTICS_TOKEN_OUT=analytics-token-nunito.json
.venv/bin/python -m scraper.youtube_analytics_oauth_console

# If Asenti uses a different login than the default analytics-token.json:
export YT_ANALYTICS_TOKEN_OUT=analytics-token-asenti.json
.venv/bin/python -m scraper.youtube_analytics_oauth_console
```

**Mira** has no token file yet — create one:

```bash
export YT_ANALYTICS_TOKEN_OUT=analytics-token-mira.json
.venv/bin/python -m scraper.youtube_analytics_oauth_console
```

(sign in with **Mira’s** channel owner account)

---

## 3) Push revenue into the sheet again

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
export YOUTUBE_API_KEY="your-key"
.venv/bin/python -m scraper.run_channel_analytics_revenue
```

The script merges **every** `scraper/analytics-token*.json` that works.

---

## 4) CrazyMomente

When you’re ready, add OAuth for that brand the same way (`analytics-token-crazymomente.json`) and keep it in `channels.config.json`.

---

## Optional: only some token files

```bash
export YT_ANALYTICS_TOKEN_PATHS="analytics-token.json,analytics-token-aven.json"
.venv/bin/python -m scraper.run_channel_analytics_revenue
```
