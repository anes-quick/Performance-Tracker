# Performance Tracker – Daily Video Stats Scraper

Runs once per day (e.g. 00:00): pulls video stats for the last 60 days from your main YouTube channels, parses Source ID from descriptions, looks up source names from the Sources sheet, and appends rows to **videostatsraw**.

## Setup

### 1. Python

Use Python 3.10+ (or 3.8+ if you avoid `str | None` elsewhere).

### 2. Install dependencies

```bash
cd scraper
pip install -r requirements.txt
```

### 3. Environment variables

Copy `.env.example` to `.env` and set:

- **GOOGLE_APPLICATION_CREDENTIALS** – Path to a Google **service account** JSON key.
  - Create in [Google Cloud Console](https://console.cloud.google.com/) → IAM → Service Accounts → Create key (JSON).
  - Share your Performance Tracker spreadsheet with the service account email (Editor access).
- **YOUTUBE_API_KEY** – YouTube Data API v3 key.
  - In the same project: APIs & Services → Enable **YouTube Data API v3** → Create credentials → API key.

### 4. Config

Channel list and spreadsheet are read from the project root:

- `../channels.config.json` (relative to `scraper/`). Must contain `spreadsheetId`, `sourcesTab`, `videoStatsRawTab`, and `channels` (handle, name, niche, url).

## Run

From the **project root** (the folder that contains both `scraper/` and `channels.config.json`):

```bash
python -m scraper.run
```

So from your machine you’d do something like:

```bash
cd "/Users/anes/Documents/Vibe Coding stuff/Performance Tracker"
python -m scraper.run
```

## Scheduling (e.g. 00:00 daily)

- **Local:** use `cron` (Linux/macOS) or Task Scheduler (Windows) to run `python -m scraper.run` at 00:00.
- **Railway / cloud:** add a cron job or scheduled task that runs the same command at 00:00 in your chosen timezone.

## What it does

1. Reads **Sources** sheet (tab `sheet`): columns B=Channel name, D=Tracking ID → builds `source_id` → `source_channel_name` lookup.
2. For each channel in `channels.config.json`:
   - Resolves handle to YouTube channel ID (`channels.list` with `forHandle`).
   - Gets uploads playlist, then all video IDs from the last 60 days.
   - Fetches video details in batches of 50 (`videos.list`: snippet + statistics).
   - For each video: parses `SRC\d+` from the description, looks up source name in the Sources sheet.
3. Appends one row per video to **videostatsraw** (tab `videostatsraw`): scrape time, channel, niche, video_id, video_url, title, published_at, views, source_id, source_channel_name.

## Sheet layout (videostatsraw)

Headers (row 1):  
`scrape_datetime`, `main_channel_id`, `main_channel_name`, `niche`, `video_id`, `video_url`, `title`, `published_at`, `views`, `source_id`, `source_channel_name`.

If the tab is empty, the first run writes the header row, then appends data.
