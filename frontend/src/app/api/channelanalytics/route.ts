import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { loadConfig } from "@/lib/config";
import { createSheetsGoogleAuth } from "@/lib/googleSheetsAuth";

export const runtime = "nodejs";

type ChannelAnalyticsRow = {
  date: string; // YYYY-MM-DD
  channel_id: string;
  channel_name: string;
  views: number;
  /** YouTube Analytics engagedViews when column E is present */
  engaged_views?: number;
};

type ChannelAnalyticsResponse = {
  channels: string[];
  series: ChannelAnalyticsRow[];
  totalViews: number;
  uploads: number;
  avgViews: number;
  outliers: number;
};

async function getSheetsClient() {
  const auth = createSheetsGoogleAuth([
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ]);
  return google.sheets({ version: "v4", auth });
}

function toISODateUTC(d: Date) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const channel = searchParams.get("channel"); // channel_name
    const period = searchParams.get("period"); // all | 7d | 28d

    const cfg = loadConfig();
    const tab = "channelanalytics";
    const sheets = await getSheetsClient();

    const [analyticsRes, videoStatsRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: cfg.spreadsheetId,
        range: `'${tab}'!A2:E10000`,
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: cfg.spreadsheetId,
        range: `'${cfg.videoStatsRawTab}'!A2:K100000`,
      }),
    ]);
    const rowsRaw = analyticsRes.data.values ?? [];
    const videoRowsRaw = videoStatsRes.data.values ?? [];

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

    const series: ChannelAnalyticsRow[] = [];
    const channelsSet = new Set<string>();

    for (const row of rowsRaw) {
      // A=date, B=channel_id, C=channel_name, D=views, E=engaged_views
      const date = String(row[0] ?? "").trim();
      const channel_id = String(row[1] ?? "").trim();
      const channel_name = String(row[2] ?? "").trim();
      const views = Number(row[3] ?? 0) || 0;
      const engagedRaw =
        row.length >= 5 ? Number(row[4] ?? "") : Number.NaN;
      const engaged_views =
        Number.isFinite(engagedRaw) && engagedRaw >= 0
          ? engagedRaw
          : undefined;
      if (!date || !channel_id || !channel_name) continue;
      if (fromStr && date < fromStr) continue;
      if (toStr && date > toStr) continue;
      if (channel && channel !== "All channels" && channel_name !== channel) continue;

      channelsSet.add(channel_name);
      series.push({
        date,
        channel_id,
        channel_name,
        views,
        ...(engaged_views !== undefined ? { engaged_views } : {}),
      });
    }

    series.sort((a, b) => a.date.localeCompare(b.date));
    const totalViews = series.reduce((s, r) => s + r.views, 0);

    // Build consistent KPI metrics from deduped videostatsraw.
    const latestByVideo = new Map<string, string[]>();
    for (const row of videoRowsRaw) {
      const videoId = String(row[4] ?? "").trim();
      const scrapeAt = String(row[0] ?? "").trim();
      if (!videoId || !scrapeAt) continue;
      const prev = latestByVideo.get(videoId);
      if (!prev || scrapeAt > String(prev[0] ?? "")) latestByVideo.set(videoId, row);
    }

    let uploads = 0;
    let viewsForAvg = 0;
    let outliers = 0;
    for (const row of latestByVideo.values()) {
      const mainChannelName = String(row[2] ?? "").trim();
      const publishedAt = String(row[7] ?? "").trim();
      const views = Number(row[8] ?? 0) || 0;
      if (!publishedAt) continue;
      const pubDate = publishedAt.slice(0, 10);
      if (fromStr && pubDate < fromStr) continue;
      if (toStr && pubDate > toStr) continue;
      if (channel && channel !== "All channels" && mainChannelName !== channel) continue;
      uploads += 1;
      viewsForAvg += views;
      if (views >= 100_000) outliers += 1;
    }
    const avgViews = uploads > 0 ? Math.round(viewsForAvg / uploads) : 0;

    return NextResponse.json({
      channels: Array.from(channelsSet).sort(),
      series,
      totalViews,
      uploads,
      avgViews,
      outliers,
    } satisfies ChannelAnalyticsResponse);
  } catch (err) {
    console.error("Error in /api/channelanalytics:", err);
    return NextResponse.json(
      { error: "Failed to load channel analytics views" },
      { status: 500 }
    );
  }
}

