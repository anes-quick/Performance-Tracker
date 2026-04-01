import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { loadConfig } from "@/lib/config";
import { createSheetsGoogleAuth } from "@/lib/googleSheetsAuth";

export const runtime = "nodejs";

type SourceMetrics = {
  source_id: string;
  source_channel_name?: string;
  videos: number;
  total_views: number;
  avg_views: number;
  outlier_count: number;
  outlier_ratio: number;
  /** From Sources sheet column F (comma-separated), e.g. commentary, scary, dance */
  niche_tags: string[];
  /** Main channels that uploaded videos from this source (current filters / period) */
  used_on_channels: string[];
};

type SourcesApiResponse = {
  metrics: SourceMetrics[];
  channels: string[];
  /** Distinct niche values from config for filter UI */
  nicheOptions: string[];
};

async function getSheetsClient() {
  const auth = createSheetsGoogleAuth([
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ]);
  return google.sheets({ version: "v4", auth });
}

async function fetchVideoStatsRows() {
  const config = loadConfig();
  const sheets = await getSheetsClient();

  const range = `'${config.videoStatsRawTab}'!A2:K100000`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range,
  });

  const rows = res.data.values ?? [];
  return rows;
}

/** B=source name, C=channel id, D=tracking id, E=link, F=niche tags (optional) */
async function fetchSourcesMeta() {
  const config = loadConfig();
  const sheets = await getSheetsClient();

  const range = `'${config.sourcesTab}'!B6:F1000`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range,
  });
  const rows = res.data.values ?? [];

  const lookupNames = new Map<string, string>();
  const nicheTagsById = new Map<string, string[]>();
  for (const row of rows) {
    if (row.length < 3) continue;
    const trackingId = String(row[2] ?? "").trim().toUpperCase();
    if (!trackingId) continue;
    const channelName = String(row[0] ?? "").trim();
    if (channelName) lookupNames.set(trackingId, channelName);
    const tagsRaw = String(row[4] ?? "").trim();
    if (tagsRaw) {
      const tags = tagsRaw
        .split(/[,;]+/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      if (tags.length) nicheTagsById.set(trackingId, tags);
    }
  }
  return { lookupNames, nicheTagsById };
}

function buildChannelNicheMap(): Map<string, string> {
  const cfg = loadConfig();
  const map = new Map<string, string>();
  for (const ch of cfg.channels) {
    map.set(ch.name, (ch.niche ?? "commentary").toLowerCase());
  }
  return map;
}

function sourceMatchesNicheFilter(
  s: SourceMetrics,
  nicheFilter: string,
  channelNicheByName: Map<string, string>
): boolean {
  if (!nicheFilter || nicheFilter === "all") return true;
  const tags = s.niche_tags ?? [];
  if (tags.includes(nicheFilter)) return true;
  for (const chName of s.used_on_channels ?? []) {
    if (channelNicheByName.get(chName) === nicheFilter) return true;
  }
  return false;
}

export async function GET(request: NextRequest) {
  try {
    const cfg = loadConfig();
    const { searchParams } = new URL(request.url);
    const channelFilter = searchParams.get("channel"); // main_channel_name
    const period = searchParams.get("period") ?? "28d"; // all | 7d | 28d
    const nicheFilter = (searchParams.get("niche") ?? "all").toLowerCase();

    const [rows, sourcesMeta] = await Promise.all([
      fetchVideoStatsRows(),
      fetchSourcesMeta(),
    ]);
    const { lookupNames: sourcesLookup, nicheTagsById } = sourcesMeta;
    const channelNicheByName = buildChannelNicheMap();
    const nicheOptions = Array.from(
      new Set(cfg.channels.map((c) => (c.niche ?? "commentary").toLowerCase()))
    ).sort();

    const bySource = new Map<string, SourceMetrics>();
    const usedOnBySource = new Map<string, Set<string>>();
    const channelNames = new Set<string>();

    const now = new Date();
    const toStr = now.toISOString().slice(0, 10);
    let fromStr: string | null = null;
    if (period === "7d") {
      const d = new Date(now);
      d.setDate(now.getDate() - 6);
      fromStr = d.toISOString().slice(0, 10);
    } else if (period === "28d") {
      const d = new Date(now);
      d.setDate(now.getDate() - 27);
      fromStr = d.toISOString().slice(0, 10);
    }

    // Dedupe to latest row per video_id so we don't count the same video across many scrapes.
    const latestByVideo = new Map<string, string[]>();
    for (const row of rows) {
      const videoId = String(row[4] ?? "").trim();
      const scrapeAt = String(row[0] ?? "").trim();
      if (!videoId || !scrapeAt) continue;
      const prev = latestByVideo.get(videoId);
      if (!prev || scrapeAt > String(prev[0] ?? "")) {
        latestByVideo.set(videoId, row);
      }
    }

    for (const row of latestByVideo.values()) {
      // Columns (0-based): 0 scrape_datetime, 1 main_channel_id, 2 main_channel_name,
      // 3 niche, 4 video_id, 5 video_url, 6 title, 7 published_at, 8 views, 9 source_id, 10 source_channel_name
      const mainChannelNameRaw = row[2];
      const mainChannelName = String(mainChannelNameRaw ?? "").trim();
      if (mainChannelName) {
        channelNames.add(mainChannelName);
      }

      if (channelFilter && mainChannelName && mainChannelName !== channelFilter) {
        continue;
      }

      // Filter by published_at date based on period.
      const publishedRaw = row[7];
      if (!publishedRaw) continue;
      const pubDate = String(publishedRaw).slice(0, 10);
      if (fromStr && pubDate < fromStr) continue;
      if (toStr && pubDate > toStr) continue;

      const viewsRaw = row[8];
      const sourceIdRaw = row[9];
      const sourceIdParsed = String(sourceIdRaw ?? "").toUpperCase().trim();
      const sourceId = sourceIdParsed || "UNKNOWN";

      const views = Number(viewsRaw ?? 0) || 0;

      const nameFromVideoRow = String(row[10] ?? "").trim();
      const nameFromSourcesSheet = sourcesLookup.get(sourceId) ?? "";
      const fallbackLabel =
        sourceId === "UNKNOWN"
          ? "Unknown source"
          : nameFromVideoRow || nameFromSourcesSheet || sourceId;

      const existing = bySource.get(sourceId) ?? {
        source_id: sourceId,
        source_channel_name: fallbackLabel,
        videos: 0,
        total_views: 0,
        avg_views: 0,
        outlier_count: 0,
        outlier_ratio: 0,
        niche_tags:
          sourceId === "UNKNOWN"
            ? []
            : (nicheTagsById.get(sourceId) ?? []),
        used_on_channels: [],
      };

      if (nameFromVideoRow) {
        existing.source_channel_name = nameFromVideoRow;
      }

      existing.videos += 1;
      existing.total_views += views;
      if (views >= 100_000) {
        existing.outlier_count += 1;
      }

      if (mainChannelName) {
        let set = usedOnBySource.get(sourceId);
        if (!set) {
          set = new Set();
          usedOnBySource.set(sourceId, set);
        }
        set.add(mainChannelName);
      }

      bySource.set(sourceId, existing);
    }

    let result: SourceMetrics[] = Array.from(bySource.values()).map((s) => {
      const used = usedOnBySource.get(s.source_id);
      const avg = s.videos > 0 ? s.total_views / s.videos : 0;
      const ratio = s.videos > 0 ? s.outlier_count / s.videos : 0;
      return {
        ...s,
        used_on_channels: used ? Array.from(used).sort() : [],
        avg_views: Math.round(avg),
        outlier_ratio: Number(ratio.toFixed(3)),
      };
    });

    if (nicheFilter !== "all") {
      result = result.filter((s) =>
        sourceMatchesNicheFilter(s, nicheFilter, channelNicheByName)
      );
    }

    // Sort by avg views desc by default
    result.sort((a, b) => b.avg_views - a.avg_views);

    const payload: SourcesApiResponse = {
      metrics: result,
      channels: Array.from(channelNames).sort(),
      nicheOptions,
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error("Error in /api/sources:", err);
    const message =
      err instanceof Error ? err.message : "Failed to load source metrics";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

