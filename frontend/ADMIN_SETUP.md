# Admin area (`/admin`) — simple setup

**Local only (no deploy needed):** put variables in `frontend/.env.local`, run `npm run dev`, open `http://localhost:3000/admin`. Skip Railway/Vercel until you publish.

---

## 1. Add these lines to `frontend/.env.local`

```env
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=any-long-random-string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-password-here
```

- **`NEXTAUTH_SECRET`**: used to sign the login cookie. Generate e.g. with `openssl rand -base64 32`.
- **`NEXTAUTH_URL`**: when you deploy, change to your real URL (e.g. `https://yoursite.vercel.app`).
- **`ADMIN_USERNAME` / `ADMIN_PASSWORD`**: what you type on the `/admin` login form.

Restart `npm run dev` after saving.

## 2. Real revenue (YouTube Analytics API)

Revenue in `/admin` comes from the **`adminfinance`** tab in the same spreadsheet as `channels.config.json`.

1. **OAuth (once, or again if you see 403 on revenue)** — must include **monetary** scope:

   ```bash
   cd "/path/to/Performance Tracker"
   export YT_ANALYTICS_OAUTH_CLIENT_SECRET_PATH="/path/to/client_secret_....json"
   .venv/bin/python -m scraper.youtube_analytics_oauth_console
   ```

   This refreshes `scraper/analytics-token.json` with `yt-analytics.readonly` + `yt-analytics-monetary.readonly`.

2. **Push revenue into the sheet** (uses Google’s **estimatedRevenue** per channel per day — same source as YouTube Studio analytics, not a made-up RPM):

   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
   export YOUTUBE_API_KEY="your-data-api-key"
   .venv/bin/python -m scraper.run_channel_analytics_revenue
   ```

   - Writes rows tagged `[yt-analytics-estimatedRevenue]` in the **Note** column.
   - **Manual** rows (any row without that tag) are kept; costs / adjustments you type by hand stay.
   - Re-running updates the **last 28 days** of auto rows and keeps older auto history outside that window.

   **Several YouTube brands / Google logins:** put one OAuth refresh token per login in `scraper/` as `analytics-token*.json` (e.g. `analytics-token-nunito.json`). The revenue script **merges every matching file**. For each file you must run OAuth once **with monetary scope**, saving into that filename:

   ```bash
   export YT_ANALYTICS_OAUTH_CLIENT_SECRET_PATH="/path/to/client_secret....json"
   export YT_ANALYTICS_TOKEN_OUT=analytics-token-aven.json
   .venv/bin/python -m scraper.youtube_analytics_oauth_console
   ```

   Repeat with the correct Google account for each brand, changing `YT_ANALYTICS_TOKEN_OUT` each time. Optional: `YT_ANALYTICS_TOKEN_PATHS=file1.json,file2.json` to limit which tokens are used.

   **Only one channel in `/admin`?** Run `.venv/bin/python -m scraper.diagnose_revenue_tokens` then follow **`scraper/REAUTH_REVENUE.md`** (each Google login needs its own token file + monetary OAuth).

3. **Tab / permissions**: If `adminfinance` is missing, opening `/admin` creates the header row. The service account needs **Editor** on the spreadsheet.

4. **Currency (important for matching YouTube Studio)**:
   - In **`channels.config.json`**, set **`"youtubeAnalyticsRevenueCurrency": "EUR"`** (or your Studio home currency). The Analytics API **defaults to USD**; Studio usually shows **EUR** for EU AdSense. Without `currency=` on the API request, sheet numbers are in USD and the admin converts them with **ECB** rates — they will **not** match Studio’s euro totals.
   - Each auto row’s Note still includes **`[yt-analytics-estimatedRevenue] USD`** or **`… EUR`** from the API response. The admin **respects that tag** (no double conversion). Override: env **`YT_ANALYTICS_REVENUE_CURRENCY=EUR`**.
   - **Manual rows:** amounts are **USD** unless you add **`[EUR]`** in **Note**. Re-run **`run_channel_analytics_revenue`** after changing currency settings.

5. **Date window (matches Studio, not UTC)**: YouTube Analytics uses **Pacific** (`America/Los_Angeles`) for the `day` dimension. By default the scraper and admin **28d / 7d** range **ends on yesterday** in Pacific (Studio often leaves “today” empty or incomplete until later). To include **today**, set `"youtubeAnalyticsIncludeTodayPacific": true` in `channels.config.json` or `YT_ANALYTICS_INCLUDE_TODAY_PACIFIC=true`. Use **All** in admin for every row in the sheet. **Custom** opens a picker: arbitrary start/end (Pacific calendar, inclusive), **This month (MTD)**, **Last month**, or a month dropdown (current month = 1st through today; past months = full month).

6. **Computed costs on `/admin`**: Optional block **`adminComputedCosts`** in `channels.config.json` adds **editor** ($/video from **`videostatsraw`**, same Pacific date window as revenue). Default is **$3/video**; **`channelEditorUsdPerVideo`** overrides per channel (e.g. **Asenti $4**). **`editorExcludeChannelNames`** skips editor cost entirely for those channels. Also **VA** ($/week) and **subscriptions** ($/month), prorated by **calendar days**. Amounts are **USD**; the page converts with the same FX as revenue when you show **€**.

7. **Partner revenue split**: **`adminChannelRevenueSplits`** maps channel name → **`yourPercent`** (0–100). Example: `"CrazyMomente": { "yourPercent": 75 }` → **Total revenue** shows full gross; the owner’s **25%** is included in **Costs** (with a small “incl. partner” hint per row). **Profit** = total revenue − all costs (ops + partner + computed). Pencil overrides are **gross** revenue.

## 3. Views (`channelanalytics`)

If RPM or per-channel view totals look wrong (e.g. only one channel has revenue), check column **`channel_name`** (C). The API resolves names by: (1) non-empty `channel_name`, (2) any other row with the same **`channel_id`** (B) that has a name, (3) optional **`youtubeChannelId`** on that channel in **`channels.config.json`** (UC… id from YouTube Studio → Settings → Advanced).

Daily views go to **`channelanalytics`** via:

```bash
.venv/bin/python -m scraper.run_channel_analytics_views
```

(same env vars + OAuth token.) These are YouTube Analytics **daily views** and **engaged_views** (past initial seconds) per channel (Pacific “day”, same as Studio). **/admin** RPM prefers **`engaged_views` when it is &gt; 0**; if the API wrote **0** for engaged but **views** is non-zero (common for some channels, e.g. Shorts-heavy), RPM uses **`views`** so totals are not zeroed out.

### Optional: RPM-based **revenue** on `/admin` (engaged views)

Prefer **`adminViewsRpmEur`**: **EUR per 1,000 engaged views**. When enabled (or when you set **manual RPM** on `/admin`), the API recomputes **per-channel revenue**, **totals**, and the **daily chart** as **(monetization views ÷ 1000) × RPM**, using **`channelanalytics`**: **engaged_views if &gt; 0, else views**. **Costs** in the window still come from **`adminfinance`**; editor / VA / subscription are still added from config.

```json
"adminViewsRpmEur": {
  "default": 2.5,
  "byChannel": {
    "CrazyMomente": 3.2,
    "Nunito": 2.1
  }
}
```

- **`byChannel`** keys should match **channel names** in **`channelanalytics`** (column C).
- If **`default`** is `0` and every per-channel RPM is `0`, RPM mode is off unless you use manual RPM.
- **Manual RPM** on the page is **EUR/1k** and is sent as query **`rpmEur`**; it overrides config RPM for that request.
- Legacy **`adminViewsRpmUsd`** (**USD per 1k**) still works if you do not use EUR config; migrate to **`adminViewsRpmEur`** when possible.

## 4. Export for Sheets / LLMs

On `/admin`, **Copy for Sheets / Claude** copies **tab-separated** text (metadata, summary totals, per-channel rows, computed-cost breakdown) reflecting the **current** period, currency, and gross overrides. Paste into **cell A1** in Google Sheets or into a chat.

## 5. VA

There is **no link** to `/admin` in the normal app. Only people who know the URL + password can open it.
