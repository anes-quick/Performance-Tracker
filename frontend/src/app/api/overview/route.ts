import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { loadConfig } from "@/lib/config";

export const runtime = "nodejs";

type OverviewPoint = {
  date: string;
  views: number;
};

type OverviewResponse = {
  totalViews: number;
  uploads: number;
  avgViews: number;
  outliers: number;
  chart: OverviewPoint[];
  channels: string[];
  coverage: { minDate: string; maxDate: string; days: number } | null;
};

function toISODateUTC(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function getSheetsClient() {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialsPath) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS is not set.");
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") ?? "28d"; // all | 7d | 28d
    const channel = searchParams.get("channel"); // main_channel_name

    const now = new Date();
    const nowUTC = new Date(`${toISODateUTC(now)}T00:00:00.000Z`);
    const toStr = toISODateUTC(nowUTC);
    let fromStr: string | null = null;
    if (period === "7d") {
      const d = new Date(nowUTC);
      d.setUTCDate(d.getUTCDate() - 6);
      fromStr = toISODateUTC(d);
    } else if (period === "28d") {
      const d = new Date(nowUTC);
      d.setUTCDate(d.getUTCDate() - 27);
      fromStr = toISODateUTC(d);
    }

    const cfg = loadConfig();
    const sheets = await getSheetsClient();

    const [videoStatsRes, channelAnalyticsRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: cfg.spreadsheetId,
        range: `'${cfg.videoStatsRawTab}'!A2:K100000`,
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: cfg.spreadsheetId,
        range: "'channelanalytics'!A2:D100000",
      }),
    ]);

    const videoRows = videoStatsRes.data.values ?? [];
    const analyticsRows = channelAnalyticsRes.data.values ?? [];

    // Deduplicate videostatsraw by video_id using latest scrape_datetime.
    // row: 0 scrape_datetime, 4 video_id, 7 published_at, 8 views
    const latestByVideo = new Map<string, string[]>();
    for (const row of videoRows) {
      const scrape = String(row[0] ?? "");
      const videoId = String(row[4] ?? "").trim();
      if (!videoId || !scrape) continue;
      const existing = latestByVideo.get(videoId);
      if (!existing) {
        latestByVideo.set(videoId, row);
        continue;
      }
      const prevScrape = String(existing[0] ?? "");
      if (scrape > prevScrape) latestByVideo.set(videoId, row);
    }

    let totalViews = 0;
    let uploads = 0;
    let outliers = 0;
    const channelSet = new Set<string>();

    for (const row of latestByVideo.values()) {
      const publishedRaw = String(row[7] ?? "").trim();
      const mainChannelName = String(row[2] ?? "").trim();
      if (mainChannelName) channelSet.add(mainChannelName);
      if (!publishedRaw) continue;
      const pubDate = publishedRaw.slice(0, 10); // YYYY-MM-DD
      if (fromStr && pubDate < fromStr) continue;
      if (toStr && pubDate > toStr) continue;
      if (channel && channel !== "All channels" && mainChannelName !== channel) {
        continue;
      }

      const views = Number(row[8] ?? 0) || 0;
      uploads += 1;
      totalViews += views;
      if (views >= 100_000) outliers += 1;
    }

    const avgViews = uploads > 0 ? Math.round(totalViews / uploads) : 0;

    // Build chart from channelanalytics: sum views per day across channels
    const byDate = new Map<string, number>();
    for (const row of analyticsRows) {
      const date = String(row[0] ?? "").trim();
      const channelName = String(row[2] ?? "").trim();
      const views = Number(row[3] ?? 0) || 0;
      if (!date) continue;
      if (fromStr && date < fromStr) continue;
      if (toStr && date > toStr) continue;
      if (channel && channel !== "All channels" && channelName !== channel) continue;
      byDate.set(date, (byDate.get(date) ?? 0) + views);
    }

    const chart = Array.from(byDate.entries())
      .map(([date, views]) => ({ date, views }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const coverage =
      chart.length > 0
        ? {
            minDate: chart[0].date,
            maxDate: chart[chart.length - 1].date,
            days: chart.length,
          }
        : null;

    const payload: OverviewResponse = {
      totalViews,
      uploads,
      avgViews,
      outliers,
      chart,
      channels: Array.from(channelSet).sort(),
      coverage,
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error("Error in /api/overview:", err);
    return NextResponse.json(
      { error: "Failed to load overview" },
      { status: 500 }
    );
  }
}

