# Looker Studio setup – Performance Tracker

Use this guide to build a dashboard from your Performance Tracker Google Sheet. You don’t have real source-tagged data yet; once the “copy Source ID into YouTube description” workflow is live and the scraper has run a few times, the charts will fill in. You can set everything up now and check results by end of week.

---

## 1. Open Looker Studio and create a report

1. Go to **https://lookerstudio.google.com/**
2. Sign in with the same Google account that owns the Performance Tracker spreadsheet.
3. Click **Create** → **Report**.
4. When asked “Add data to report”, choose **Google Sheets**.

---

## 2. Connect your spreadsheet (first data source: Video Stats)

1. In the “Select a spreadsheet” dialog, find your Performance Tracker sheet, or paste this URL and pick the file:
   - **Spreadsheet URL:**  
     `https://docs.google.com/spreadsheets/d/1nZaolnDQb9rO17tqLCALYniCvzujFI0wKKrrUt9TAlY/edit`
2. Under **Select a sheet from the spreadsheet**, choose the tab **videostatsraw**.
3. Click **Add**.  
   - If you see a screen about “Adding the data source to the report”, you can click **Add to report** (the data source is then used by the report).
4. Name this data source something like **Video Stats Raw** (optional, in the panel on the right under “Data source name”).

**Fields you’ll see (for building charts):**

| Field               | Use in Looker Studio                          |
|---------------------|------------------------------------------------|
| scrape_datetime     | Date/time of scrape; filter or group by date   |
| main_channel_id     | Channel ID (for filters)                       |
| main_channel_name   | Channel name (labels, filters)                 |
| niche               | Commentary / scary / dance (filters)           |
| video_id            | Unique video (count, detail)                  |
| video_url           | Link (optional in tables)                      |
| title               | Video title (tables)                          |
| published_at        | Publish date (time charts)                    |
| views               | Metric: SUM or AVG                             |
| source_id           | SRC0001, etc. (source rankings)                |
| source_channel_name | Source name (labels when you have data)       |

**Note:** Until you paste Source ID into YouTube descriptions, `source_id` and `source_channel_name` will often be empty. Source-based charts will stay empty or sparse until then; channel and view charts will work as soon as the scraper has run.

---

## 3. Add the second data source (Channel Daily)

1. In the report, go to **Resource** → **Manage added data sources** (or click “Add data” in the panel).
2. Click **Add data**.
3. Choose **Google Sheets** again and select the **same** spreadsheet.
4. This time select the tab **channeldaily**.
5. Add it and name it e.g. **Channel Daily**.

**Fields:**

| Field             | Use in Looker Studio                    |
|-------------------|-----------------------------------------|
| date              | Day (time series)                        |
| channel_id        | Filter by channel                       |
| channel_name      | Labels, filters                         |
| total_views       | Metric: line chart over time            |
| total_subscribers | Metric: growth over time                |
| total_videos      | Metric: count over time                 |

---

## 4. Suggested charts (build these so they’re ready when data arrives)

### Page 1: Overview

- **Scorecard (Channel Daily):** Total views across all channels  
  - Data source: Channel Daily  
  - Metric: Sum of **total_views**  
  - Optional filter: Date range (e.g. last 7 days).

- **Scorecard (Channel Daily):** Total subscribers  
  - Metric: Sum of **total_subscribers** (or “latest” per channel if you prefer).

- **Time series – Views per day (Channel Daily):**  
  - Dimension: **date**  
  - Metric: **total_views** (or Sum if you use a blend)  
  - Break down by **channel_name** if you want one line per channel.

### Page 2: By channel

- **Table (Video Stats Raw):** Recent videos with views  
  - Dimensions: **main_channel_name**, **title**, **published_at**, **views**, **source_id**, **source_channel_name**  
  - Metric: e.g. **views**  
  - Filter: **main_channel_name** = one channel (or use a filter control).  
  - Will be useful once you have data; source columns will fill in when IDs are in descriptions.

- **Bar chart – Views by channel (Video Stats Raw):**  
  - Dimension: **main_channel_name**  
  - Metric: Sum of **views** (or average views per video).  
  - Works as soon as videostatsraw has rows.

### Page 3: Source performance (once Source ID is in descriptions)

- **Table – Top sources by total views (Video Stats Raw):**  
  - Dimension: **source_channel_name** (or **source_id**)  
  - Metric: Sum of **views**  
  - Sort descending.  
  - Filter: **source_id** not blank (so you only see tagged videos).

- **Table – Top sources by average views per video:**  
  - Dimension: **source_channel_name**  
  - Metrics: Avg of **views**, Count of **video_id**  
  - Filter: **source_id** not blank.  
  - In Looker Studio you do “Avg(views)” as a metric; if you need “total views / count of videos”, you can add a calculated field later.

- **Filter control:** Add a **Date range** control and, if you want, a **main_channel_name** filter so you can limit to one channel or “all”.

---

## 5. Optional: same spreadsheet, different tabs

You can also add the **sheet** tab (Sources: channel + Channel ID + Tracking ID) as a third data source if you want a simple table of “which source_id = which channel” inside the report. Not required for the charts above.

---

## 6. Refreshing data

Looker Studio refreshes when you open or reload the report; it reads from the live Google Sheet. So:

- Keep the **daily scraper** running (e.g. 00:00).
- Once you **paste Source ID** into new Shorts’ descriptions, the next scrape will fill **source_id** and **source_channel_name** in videostatsraw.
- Open the dashboard by end of week to see views, channel totals, and (as they appear) source rankings.

---

## Quick reference

| Item        | Value                                                                 |
|------------|-----------------------------------------------------------------------|
| Spreadsheet| `https://docs.google.com/spreadsheets/d/1nZaolnDQb9rO17tqLCALYniCvzujFI0wKKrrUt9TAlY/edit` |
| Tabs       | **videostatsraw** (per-video, per scrape), **channeldaily** (per channel per day) |
| Data flow  | Scraper runs daily → writes to Sheet → Looker Studio reads Sheet when you open the report |

You’re not testing with real source tags yet; the setup is ready so that once the workflow is live, you can check results in Looker Studio without changing anything.
