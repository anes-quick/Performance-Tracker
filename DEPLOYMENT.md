# Deploying Performance Tracker + Admin

## Railway **and** Vercel — do you use both?

**Usually you don’t run the same Next.js app on both at once.** Pick **one** host for the **website**:

| Piece | Typical host | Why |
|--------|----------------|-----|
| **Next.js dashboard** (`frontend/`) | **Vercel** | Best DX for Next.js, previews, edge. |
| **Python scrapers** (cron) | **Railway** or **GitHub Actions** | Long jobs, secrets, OAuth token files — not a fit for Vercel serverless. |

So it’s **not** “Vercel **or** Railway” for the app — it’s **Vercel (web) + Railway (scheduled scrapers)** as a **pair**. You can also put **everything on Railway** (web + worker) if you want a single bill and fewer vendors.

**Order:** Deploy the **frontend first** (Vercel), set production env vars, smoke-test `/` and `/admin`. Then wire **nightly scraping** (Railway cron or Actions) so data keeps updating.

---

## 1. Vercel (dashboard)

1. Connect the Git repo — **leave defaults** (no Root Directory in the UI). Repo root has `vercel.json` + `package.json`; install/build run in `frontend/` automatically.
2. **Environment variables** (production), at minimum:
   - `NEXTAUTH_SECRET`, `NEXTAUTH_URL` (your real URL, e.g. `https://your-app.vercel.app`)
   - `ADMIN_USERNAME`, `ADMIN_PASSWORD`
   - Google / Sheets-related vars your API routes already expect (same names as local `frontend/.env.local`).
4. Redeploy after changing env.

`channels.config.json` is **copied into `frontend/` during `npm run build`** (`prebuild` script) so serverless routes bundle it. Local `next dev` still reads the file from the repo root via `../channels.config.json`.

---

## 2. Nightly scraping (00:00)

Your `channels.config.json` has `"scrapeTimeUtc": "00:00"` — treat that as **00:00 UTC** unless you change it. Cron on most hosts is **UTC**.

### What to run (one job, in order)

Use the repo script:

```bash
chmod +x scripts/nightly-scrape.sh
./scripts/nightly-scrape.sh
```

It runs:

1. `python -m scraper.run` — video stats → `videostatsraw` (+ channel daily).
2. `python -m scraper.run_channel_analytics_views` — views → `channelanalytics`.
3. `python -m scraper.run_channel_analytics_revenue` — revenue → `adminfinance`.

**Admin** and **main** dashboards both read the **same** Google Sheet; one nightly pass updates everything.

### Secrets on the runner

Same as local `scraper/.env`:

- `GOOGLE_APPLICATION_CREDENTIALS` (path) **or** JSON injected and path set in the start command.
- `YOUTUBE_API_KEY`
- For **Analytics revenue**, OAuth token files as documented in `scraper/REAUTH_REVENUE.md` — they must exist on the **cron** machine (Railway volume, or upload as secrets and write to disk before running).

### Railway (cron)

1. New **empty** service (or **Docker** image) with this repo.
2. **Build:** install Python deps from `scraper/requirements.txt`.
3. **Start / Cron:** schedule **daily** at `0 0 * * *` (midnight UTC) with command:
   ```bash
   bash scripts/nightly-scrape.sh
   ```
4. Set all env vars / mounted files for Google + YouTube + OAuth.

#### Deploy vs scrape (important)

The Docker image **`CMD`** runs `scripts/railway-entry.sh`. By default **`RUN_SCRAPE_ON_START` is unset (= `1`)**, so **every new container** (deploy, restart, crash recovery) runs the **full** nightly scrape once — that’s a lot of YouTube API calls if you push often.

**Recommended:** In Railway → Variables set **`RUN_SCRAPE_ON_START=0`**. The container then **idles** (`sleep infinity`) on boot and **does not** scrape. Add a **Cron** (same service or Railway Cron) that runs only:

```bash
bash scripts/nightly-scrape.sh
```

on your chosen schedule (e.g. once per day). Then **code deploys don’t** trigger a full scrape; only the cron does.

### GitHub Actions (alternative)

Schedule `cron: '0 0 * * *'`, checkout repo, setup Python, add secrets for service account JSON and API key, run `bash scripts/nightly-scrape.sh`. You still need a strategy for **OAuth token files** (e.g. base64 secret → write to `scraper/` before running).

### “Night” in your timezone

If you want **local midnight** (e.g. Europe/Vienna), convert to UTC in the cron expression, or run at **22:00–23:00 UTC** if that’s your night — adjust to taste.

---

## 3. Summary

| Question | Answer |
|----------|--------|
| Both Railway and Vercel? | **Vercel for the Next app** + **Railway (or Actions) for cron** is a good combo — not two copies of the same site. |
| Same time or one after the other? | **Deploy the site first**, then add **one** nightly job that runs **all** scrapers in sequence (script above). |
| One job for main + admin? | **Yes** — same sheet; `nightly-scrape.sh` covers both. |
