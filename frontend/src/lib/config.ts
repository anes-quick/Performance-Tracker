import fs from "node:fs";
import path from "node:path";

type ChannelConfig = {
  handle: string;
  name: string;
  niche?: string;
  url?: string;
};

export type AppConfig = {
  spreadsheetId: string;
  sourcesTab: string;
  videoStatsRawTab: string;
  channelDailyTab?: string;
  /** Tab with daily views per channel (from YouTube Analytics scraper) */
  channelAnalyticsTab?: string;
  /** Private tab for admin revenue/costs (same spreadsheet; do not share with VA if needed) */
  adminFinanceTab?: string;
  /**
   * Pass-through for the Python revenue scraper: YouTube Analytics `currency` query param.
   * Use the same code as YouTube Studio (e.g. EUR). Omit to use API default (USD).
   */
  youtubeAnalyticsRevenueCurrency?: string;
  /**
   * If true, rolling windows include “today” in Pacific. Default false: end date is
   * yesterday Pacific (matches Studio when today’s revenue row is still empty).
   */
  youtubeAnalyticsIncludeTodayPacific?: boolean;
  /**
   * Admin finance: add editor ($/video from videostatsraw), VA ($/week), subscriptions ($/month).
   * Amounts are USD; converted to € on the page via FX when needed.
   */
  adminComputedCosts?: {
    editorUsdPerVideo?: number;
    editorExcludeChannelNames?: string[];
    /** Per-channel $/video from uploads (overrides default editorUsdPerVideo). */
    channelEditorUsdPerVideo?: Record<string, number>;
    vaUsdPerWeek?: number;
    subscriptionUsdPerMonth?: number;
  };
  /**
   * Per-channel revenue split for /admin (your % vs partner). Rest = partner.
   * Keys match channel display names (e.g. "CrazyMomente").
   */
  adminChannelRevenueSplits?: Record<string, { yourPercent: number }>;
  scrapeTimeUtc?: string;
  channels: ChannelConfig[];
};

let cachedConfig: AppConfig | null = null;

function resolveChannelsConfigPath(): string {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "channels.config.json"),
    path.join(cwd, "..", "channels.config.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `channels.config.json not found. Tried: ${candidates.join(", ")}`
  );
}

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = resolveChannelsConfigPath();

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw);
  cachedConfig = parsed as AppConfig;
  return cachedConfig;
}

