import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { loadConfig } from "@/lib/config";
import { createSheetsGoogleAuth } from "@/lib/googleSheetsAuth";

export const runtime = "nodejs";

type ChannelDailyRow = {
  date: string;
  channel_id: string;
  channel_name: string;
  total_views: number;
  total_subscribers: number;
  total_videos: number;
};

type ChannelSummary = {
  channel_name: string;
  total_views: number;
  total_subscribers: number;
  total_videos: number;
};

type ChannelsApiResponse = {
  rows: ChannelDailyRow[];
  summaries: ChannelSummary[];
};

async function getSheetsClient() {
  const auth = createSheetsGoogleAuth([
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ]);
  return google.sheets({ version: "v4", auth });
}

async function fetchChannelDailyRows() {
  const config = loadConfig();
  const sheets = await getSheetsClient();
  const tab = config.channelDailyTab || "channeldaily";

  const range = `'${tab}'!A2:F10000`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range,
  });

  const rows = res.data.values ?? [];
  return rows;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const channelFilter = searchParams.get("channel"); // channel_name

    const rowsRaw = await fetchChannelDailyRows();

    const rows: ChannelDailyRow[] = [];
    const summariesMap = new Map<string, ChannelSummary>();

    for (const row of rowsRaw) {
      // columns: 0 date, 1 channel_id, 2 channel_name, 3 total_views, 4 total_subscribers, 5 total_videos
      const date = String(row[0] ?? "").trim();
      const channelId = String(row[1] ?? "").trim();
      const channelName = String(row[2] ?? "").trim();
      const totalViews = Number(row[3] ?? 0) || 0;
      const totalSubs = Number(row[4] ?? 0) || 0;
      const totalVideos = Number(row[5] ?? 0) || 0;

      if (!channelName) continue;
      if (channelFilter && channelName !== channelFilter) continue;

      const rowObj: ChannelDailyRow = {
        date,
        channel_id: channelId,
        channel_name: channelName,
        total_views: totalViews,
        total_subscribers: totalSubs,
        total_videos: totalVideos,
      };
      rows.push(rowObj);

      const existing = summariesMap.get(channelName) ?? {
        channel_name: channelName,
        total_views: 0,
        total_subscribers: 0,
        total_videos: 0,
      };
      existing.total_views = Math.max(existing.total_views, totalViews);
      existing.total_subscribers = Math.max(existing.total_subscribers, totalSubs);
      existing.total_videos = Math.max(existing.total_videos, totalVideos);
      summariesMap.set(channelName, existing);
    }

    // sort daily rows by date ascending
    rows.sort((a, b) => a.date.localeCompare(b.date));

    const summaries = Array.from(summariesMap.values()).sort((a, b) =>
      a.channel_name.localeCompare(b.channel_name)
    );

    const payload: ChannelsApiResponse = {
      rows,
      summaries,
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error("Error in /api/channels:", err);
    const message =
      err instanceof Error ? err.message : "Failed to load channel stats";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

