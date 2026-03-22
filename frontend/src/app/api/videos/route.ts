import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { loadConfig } from "@/lib/config";

export const runtime = "nodejs";

type VideoItem = {
  videoId: string;
  videoUrl: string;
  thumbnailUrl: string;
  title: string;
  publishedAt: string;
  views: number;
  mainChannelName: string;
  sourceId: string;
  sourceName: string;
};

function toISODateUTC(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function getSheetsClient() {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialsPath) throw new Error("GOOGLE_APPLICATION_CREDENTIALS is not set.");
  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") ?? "28d";
    const channel = searchParams.get("channel");

    const nowUTC = new Date(`${toISODateUTC(new Date())}T00:00:00.000Z`);
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
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: cfg.spreadsheetId,
      range: `'${cfg.videoStatsRawTab}'!A2:K100000`,
    });
    const rows = res.data.values ?? [];

    const latestByVideo = new Map<string, string[]>();
    for (const row of rows) {
      const videoId = String(row[4] ?? "").trim();
      const scrapeAt = String(row[0] ?? "").trim();
      if (!videoId || !scrapeAt) continue;
      const prev = latestByVideo.get(videoId);
      if (!prev || scrapeAt > String(prev[0] ?? "")) latestByVideo.set(videoId, row);
    }

    const items: VideoItem[] = [];
    for (const row of latestByVideo.values()) {
      const videoId = String(row[4] ?? "").trim();
      const title = String(row[6] ?? "").trim();
      const publishedAt = String(row[7] ?? "").trim();
      const views = Number(row[8] ?? 0) || 0;
      const sourceId = String(row[9] ?? "").trim();
      const sourceName = String(row[10] ?? "").trim();
      const mainChannelName = String(row[2] ?? "").trim();
      if (!videoId || !publishedAt) continue;
      if (channel && channel !== "All channels" && mainChannelName !== channel) continue;
      const pubDate = publishedAt.slice(0, 10);
      if (fromStr && pubDate < fromStr) continue;
      if (toStr && pubDate > toStr) continue;

      items.push({
        videoId,
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        title,
        publishedAt,
        views,
        mainChannelName,
        sourceId,
        sourceName: sourceName || sourceId || "Unknown source",
      });
    }

    items.sort((a, b) => b.views - a.views);
    return NextResponse.json({ period, count: items.length, items });
  } catch (err) {
    console.error("Error in /api/videos:", err);
    return NextResponse.json({ error: "Failed to load videos" }, { status: 500 });
  }
}
