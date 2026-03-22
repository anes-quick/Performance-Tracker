import type { AppConfig } from "@/lib/config";

/** Inputs are USD; proration uses calendar-day counts. */
export type AdminComputedCostsConfig = {
  editorUsdPerVideo?: number;
  /** Channel display names (normalized match) with no per-video editor cost */
  editorExcludeChannelNames?: string[];
  /**
   * Per-channel $/video (upload counts from videostatsraw). Overrides default
   * `editorUsdPerVideo` for that channel. Default includes Asenti → $4.
   */
  channelEditorUsdPerVideo?: Record<string, number>;
  vaUsdPerWeek?: number;
  subscriptionUsdPerMonth?: number;
};

export type ResolvedAdminComputedCosts = {
  editorUsdPerVideo: number;
  editorExcludeChannelNames: string[];
  channelEditorUsdPerVideo: Record<string, number>;
  vaUsdPerWeek: number;
  subscriptionUsdPerMonth: number;
};

/** Built-in default: Asenti uses $4/video (not the $3 default). */
const DEFAULT_CHANNEL_EDITOR_USD_PER_VIDEO: Record<string, number> = {
  Asenti: 4,
};

const DEFAULTS: ResolvedAdminComputedCosts = {
  editorUsdPerVideo: 3,
  editorExcludeChannelNames: [],
  channelEditorUsdPerVideo: { ...DEFAULT_CHANNEL_EDITOR_USD_PER_VIDEO },
  vaUsdPerWeek: 126,
  subscriptionUsdPerMonth: 160,
};

function mergeChannelEditorRates(
  raw: AdminComputedCostsConfig | undefined
): Record<string, number> {
  const out: Record<string, number> = {
    ...DEFAULT_CHANNEL_EDITOR_USD_PER_VIDEO,
  };
  const fromCfg = raw?.channelEditorUsdPerVideo;
  if (!fromCfg || typeof fromCfg !== "object") return out;
  for (const [k, v] of Object.entries(fromCfg)) {
    const key = String(k).trim();
    if (!key) continue;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      out[key] = v;
    }
  }
  return out;
}

export function resolveAdminComputedCosts(cfg: AppConfig): ResolvedAdminComputedCosts {
  const raw = cfg.adminComputedCosts as AdminComputedCostsConfig | undefined;
  if (!raw) return { ...DEFAULTS };
  return {
    editorUsdPerVideo:
      typeof raw.editorUsdPerVideo === "number" && raw.editorUsdPerVideo >= 0
        ? raw.editorUsdPerVideo
        : DEFAULTS.editorUsdPerVideo,
    editorExcludeChannelNames: Array.isArray(raw.editorExcludeChannelNames)
      ? raw.editorExcludeChannelNames.map((s) => String(s).trim()).filter(Boolean)
      : [...DEFAULTS.editorExcludeChannelNames],
    channelEditorUsdPerVideo: mergeChannelEditorRates(raw),
    vaUsdPerWeek:
      typeof raw.vaUsdPerWeek === "number" && raw.vaUsdPerWeek >= 0
        ? raw.vaUsdPerWeek
        : DEFAULTS.vaUsdPerWeek,
    subscriptionUsdPerMonth:
      typeof raw.subscriptionUsdPerMonth === "number" &&
      raw.subscriptionUsdPerMonth >= 0
        ? raw.subscriptionUsdPerMonth
        : DEFAULTS.subscriptionUsdPerMonth,
  };
}

export const YOUTUBE_ANALYTICS_DAY_TZ = "America/Los_Angeles";

export function publishedPacificIso(publishedAtRaw: string): string | null {
  const t = Date.parse(publishedAtRaw);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString("en-CA", {
    timeZone: YOUTUBE_ANALYTICS_DAY_TZ,
  });
}

export function inclusiveDayCount(startIso: string, endIso: string): number {
  const s = new Date(`${startIso}T12:00:00.000Z`).getTime();
  const e = new Date(`${endIso}T12:00:00.000Z`).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
  return Math.round((e - s) / 86400000) + 1;
}

/** Average Gregorian month length (365.25/12) for subscription proration */
export const AVG_DAYS_PER_MONTH = 30.437;

export type VideoUploadAgg = {
  uploadCounts: Record<string, number>;
  /** Only for "all" window: span of Pacific publish dates in deduped data */
  allTimeDateSpan: { minIso: string; maxIso: string } | null;
};

/**
 * Dedupe videostatsraw by video_id (latest scrape row), then count uploads per main channel.
 * `windowBounds` null = include all videos; otherwise Pacific publish date must fall in range.
 */
export function aggregateVideoUploadsFromSheetRows(
  rows: string[][],
  normalizeChannelName: (s: string) => string,
  windowBounds: { startIso: string; endIso: string } | null
): VideoUploadAgg {
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

  let minIso: string | null = null;
  let maxIso: string | null = null;
  const uploadCounts: Record<string, number> = {};

  for (const row of latestByVideo.values()) {
    const publishedAt = String(row[7] ?? "").trim();
    const mainChannelName = normalizeChannelName(String(row[2] ?? ""));
    if (!publishedAt || !mainChannelName) continue;

    const pacific = publishedPacificIso(publishedAt);
    if (!pacific) continue;

    if (windowBounds) {
      if (pacific < windowBounds.startIso || pacific > windowBounds.endIso) {
        continue;
      }
    } else {
      if (!minIso || pacific < minIso) minIso = pacific;
      if (!maxIso || pacific > maxIso) maxIso = pacific;
    }

    uploadCounts[mainChannelName] =
      (uploadCounts[mainChannelName] ?? 0) + 1;
  }

  const allTimeDateSpan =
    !windowBounds && minIso && maxIso
      ? { minIso, maxIso }
      : null;

  return { uploadCounts, allTimeDateSpan };
}

export function isEditorCostExcluded(
  channelName: string,
  normalizeChannelName: (s: string) => string,
  excludeNames: string[]
): boolean {
  const n = normalizeChannelName(channelName).toLowerCase();
  return excludeNames.some(
    (e) => normalizeChannelName(e).toLowerCase() === n
  );
}

/** USD per video for this channel, or `undefined` if excluded from editor costs. */
export function editorUsdPerVideoForChannel(
  channelName: string,
  costsCfg: ResolvedAdminComputedCosts,
  normalizeChannelName: (s: string) => string
): number | undefined {
  if (
    isEditorCostExcluded(
      channelName,
      normalizeChannelName,
      costsCfg.editorExcludeChannelNames
    )
  ) {
    return undefined;
  }
  const n = normalizeChannelName(channelName).toLowerCase();
  for (const [k, v] of Object.entries(costsCfg.channelEditorUsdPerVideo)) {
    if (normalizeChannelName(k).toLowerCase() === n) {
      return v;
    }
  }
  return costsCfg.editorUsdPerVideo;
}

export type ChannelAggUsd = { revenue: number; costs: number; profit: number };

export type ComputedCostsApplied = {
  editorByChannelUsd: Record<string, number>;
  editorTotalUsd: number;
  vaUsd: number;
  subscriptionUsd: number;
};

/**
 * Adds editor cost per channel (from upload counts) and prorated VA + subscription to totals (USD).
 */
export function applyComputedBusinessCostsUsd(
  byChannel: Record<string, ChannelAggUsd>,
  totals: ChannelAggUsd,
  uploadCounts: Record<string, number>,
  costsCfg: ResolvedAdminComputedCosts,
  periodDays: number,
  normalizeChannelName: (s: string) => string
): ComputedCostsApplied {
  const editorByChannelUsd: Record<string, number> = {};
  let editorTotalUsd = 0;

  for (const [ch, count] of Object.entries(uploadCounts)) {
    const rate = editorUsdPerVideoForChannel(ch, costsCfg, normalizeChannelName);
    if (rate === undefined) continue;
    const usd = count * rate;
    editorByChannelUsd[ch] = usd;
    editorTotalUsd += usd;
    if (!byChannel[ch]) {
      byChannel[ch] = { revenue: 0, costs: 0, profit: 0 };
    }
    byChannel[ch].costs += usd;
  }

  const vaUsd =
    periodDays > 0 ? (periodDays / 7) * costsCfg.vaUsdPerWeek : 0;
  const subscriptionUsd =
    periodDays > 0
      ? (periodDays / AVG_DAYS_PER_MONTH) * costsCfg.subscriptionUsdPerMonth
      : 0;

  totals.costs += editorTotalUsd + vaUsd + subscriptionUsd;
  totals.profit = totals.revenue - totals.costs;

  for (const k of Object.keys(byChannel)) {
    byChannel[k].profit = byChannel[k].revenue - byChannel[k].costs;
  }

  return { editorByChannelUsd, editorTotalUsd, vaUsd, subscriptionUsd };
}
