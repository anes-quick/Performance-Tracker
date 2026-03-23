import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { google } from "googleapis";
import { authOptions } from "@/lib/auth";
import {
  aggregateVideoUploadsFromSheetRows,
  applyComputedBusinessCostsUsd,
  inclusiveDayCount,
  resolveAdminComputedCosts,
} from "@/lib/adminComputedCosts";
import { loadConfig, type AppConfig } from "@/lib/config";
import { createSheetsGoogleAuth } from "@/lib/googleSheetsAuth";

export const runtime = "nodejs";

type ChannelAgg = { revenue: number; costs: number; profit: number };

type DisplayCurrency = "EUR" | "USD";

const YT_REV_TAG = "[yt-analytics-estimatedRevenue]";

/** Parse leading YYYY-MM-DD from a sheet cell (YouTube rows use API day strings). */
function parseRowISODate(cell: unknown): string | null {
  const s = String(cell ?? "").trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

const YOUTUBE_ANALYTICS_DAY_TZ = "America/Los_Angeles";

/** Pacific “today” as YYYY-MM-DD. */
function pacificTodayIso(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: YOUTUBE_ANALYTICS_DAY_TZ,
  });
}

/** Previous calendar day in Pacific (Studio often aligns totals through yesterday). */
function pacificYesterdayIso(): string {
  const todayIso = pacificTodayIso();
  const [y, m, d] = todayIso.split("-").map((x) => parseInt(x, 10));
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;
}

function resolveIncludeTodayPacific(cfg: AppConfig): boolean {
  const env = process.env.YT_ANALYTICS_INCLUDE_TODAY_PACIFIC?.trim().toLowerCase();
  if (env === "1" || env === "true" || env === "yes" || env === "on") return true;
  if (env === "0" || env === "false" || env === "no" || env === "off")
    return false;
  if (typeof cfg.youtubeAnalyticsIncludeTodayPacific === "boolean") {
    return cfg.youtubeAnalyticsIncludeTodayPacific;
  }
  return false;
}

/**
 * Inclusive [startIso, endIso] matching Python `_date_range`.
 * Default: **end = yesterday Pacific** (incomplete “today” in Studio).
 */
function rollingYoutubeStudioInclusiveRange(
  windowDays: number,
  includeTodayPacific: boolean
): {
  startIso: string;
  endIso: string;
} {
  const endIso = includeTodayPacific ? pacificTodayIso() : pacificYesterdayIso();
  const [ey, em, ed] = endIso.split("-").map((x) => parseInt(x, 10));
  const start = new Date(Date.UTC(ey, em - 1, ed - (windowDays - 1)));
  const startIso = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-${String(start.getUTCDate()).padStart(2, "0")}`;
  return { startIso, endIso };
}

function rowInYoutubeStudioWindow(
  isoDate: string,
  startIso: string,
  endIso: string
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
  return isoDate >= startIso && isoDate <= endIso;
}

/**
 * RPM / monetization basis: `engaged_views` (column E) when **> 0**; otherwise **`views`** (D).
 * YouTube Analytics often returns `engagedViews` as 0 for some channels (e.g. Shorts-heavy)
 * even when `views` is non-zero — using 0 would zero out RPM, so we fall back to views.
 */
function monetizedViewsFromChannelAnalyticsRow(row: string[]): number {
  const v = Number(row[3] ?? 0);
  const views = Number.isFinite(v) && v >= 0 ? v : 0;
  if (row.length >= 5) {
    const e = Number(row[4]);
    if (Number.isFinite(e) && e > 0) return e;
  }
  return views;
}

/**
 * Map channel_id (col B) → display name for aggregation. Built from rows that have
 * `channel_name` (col C) plus optional `youtubeChannelId` in channels.config.json.
 */
function buildChannelIdToDisplayNameMap(
  analyticsRows: string[][],
  cfg: AppConfig,
  normalize: (s: string) => string
): Map<string, string> {
  const m = new Map<string, string>();
  for (const row of analyticsRows) {
    const id = String(row[1] ?? "").trim();
    const nm = normalize(String(row[2] ?? ""));
    if (id && nm && !m.has(id)) m.set(id, nm);
  }
  for (const ch of cfg.channels) {
    const ytid =
      typeof ch.youtubeChannelId === "string"
        ? ch.youtubeChannelId.trim()
        : "";
    if (!ytid || !ch.name) continue;
    if (!m.has(ytid)) m.set(ytid, normalize(ch.name));
  }
  return m;
}

/** Resolved adminfinance-style channel name for one analytics row. */
function channelAnalyticsRowDisplayName(
  row: string[],
  channelIdToDisplayName: Map<string, string>,
  normalize: (s: string) => string
): string {
  const fromCol = normalize(String(row[2] ?? ""));
  if (fromCol) return fromCol;
  const id = String(row[1] ?? "").trim();
  if (!id) return "";
  return channelIdToDisplayName.get(id) ?? "";
}

/** `null` = sum all rows (all time). */
function parseWindowDays(raw: string | null): number | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "all" || s === "0") return null;
  const n = parseInt(s, 10);
  if (n === 7) return 7;
  if (n === 28 || s === "") return 28;
  if (Number.isFinite(n) && n > 0 && n <= 366) return n;
  return 28;
}

/** Inclusive calendar dates as YYYY-MM-DD (string order = chronological). */
function eachIsoDateInclusive(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  let cur = startIso;
  let guard = 0;
  while (cur <= endIso && guard < 900) {
    out.push(cur);
    guard++;
    const [y, m, d] = cur.split("-").map((x) => parseInt(x, 10));
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    cur = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  }
  return out;
}

function buildDailySeriesDisplay(
  dailyUsd: Map<string, { revenue: number; costs: number }>,
  windowBounds: { startIso: string; endIso: string } | null,
  display: DisplayCurrency,
  eurPerUsd: number,
  /** When set, daily revenue uses these USD amounts (views×RPM); costs still from sheet. */
  revenueUsdByDayFromViews?: Map<string, number> | null
): { date: string; revenue: number; costs: number; profit: number }[] {
  const row = (date: string, rev: number, cost: number) => ({
    date,
    revenue: usdToDisplay(rev, display, eurPerUsd),
    costs: usdToDisplay(cost, display, eurPerUsd),
    profit: usdToDisplay(rev - cost, display, eurPerUsd),
  });
  if (windowBounds) {
    return eachIsoDateInclusive(
      windowBounds.startIso,
      windowBounds.endIso
    ).map((date) => {
      const v = dailyUsd.get(date) ?? { revenue: 0, costs: 0 };
      const revUsd =
        revenueUsdByDayFromViews != null
          ? (revenueUsdByDayFromViews.get(date) ?? 0)
          : v.revenue;
      return row(date, revUsd, v.costs);
    });
  }
  const dateKeys = new Set<string>([
    ...dailyUsd.keys(),
    ...(revenueUsdByDayFromViews ? revenueUsdByDayFromViews.keys() : []),
  ]);
  const sorted = [...dateKeys].sort();
  return sorted.map((date) => {
    const v = dailyUsd.get(date) ?? { revenue: 0, costs: 0 };
    const revUsd =
      revenueUsdByDayFromViews != null
        ? (revenueUsdByDayFromViews.get(date) ?? 0)
        : v.revenue;
    return row(date, revUsd, v.costs);
  });
}

function adminViewsRpmUsdConfigEnabled(cfg: AppConfig): boolean {
  const r = cfg.adminViewsRpmUsd;
  if (!r || typeof r !== "object") return false;
  const d = typeof r.default === "number" && Number.isFinite(r.default) ? r.default : 0;
  if (d > 0) return true;
  const by = r.byChannel ?? {};
  return Object.values(by).some(
    (n) => typeof n === "number" && Number.isFinite(n) && n > 0
  );
}

function adminViewsRpmEurConfigEnabled(cfg: AppConfig): boolean {
  const r = cfg.adminViewsRpmEur;
  if (!r || typeof r !== "object") return false;
  const d = typeof r.default === "number" && Number.isFinite(r.default) ? r.default : 0;
  if (d > 0) return true;
  const by = r.byChannel ?? {};
  return Object.values(by).some(
    (n) => typeof n === "number" && Number.isFinite(n) && n > 0
  );
}

function parseRpmEurQuery(raw: string | null): number {
  if (!raw) return 0;
  let t = String(raw).trim().replace(/\s/g, "");
  if (!t) return 0;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(t);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function rpmEurForChannel(
  channelName: string,
  cfg: NonNullable<AppConfig["adminViewsRpmEur"]>,
  normalize: (s: string) => string
): number {
  const n = normalize(channelName);
  const by = cfg.byChannel ?? {};
  for (const [k, v] of Object.entries(by)) {
    if (normalize(k) === n && typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
  }
  const def =
    typeof cfg.default === "number" && Number.isFinite(cfg.default)
      ? cfg.default
      : 0;
  return def;
}

function rpmUsdForChannel(
  channelName: string,
  cfg: NonNullable<AppConfig["adminViewsRpmUsd"]>,
  normalize: (s: string) => string
): number {
  const n = normalize(channelName);
  const by = cfg.byChannel ?? {};
  for (const [k, v] of Object.entries(by)) {
    if (normalize(k) === n && typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
  }
  const def =
    typeof cfg.default === "number" && Number.isFinite(cfg.default)
      ? cfg.default
      : 0;
  return def;
}

/** Total monetized basis (engaged_views, else views) per calendar day — all channels in sheet. */
function buildDailyViewsByDay(
  analyticsRows: string[][],
  windowBounds: { startIso: string; endIso: string } | null
): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const row of analyticsRows) {
    const date = String(row[0] ?? "").trim();
    const views = monetizedViewsFromChannelAnalyticsRow(row);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (
      windowBounds &&
      !rowInYoutubeStudioWindow(
        date,
        windowBounds.startIso,
        windowBounds.endIso
      )
    ) {
      continue;
    }
    byDay.set(date, (byDay.get(date) ?? 0) + views);
  }
  return byDay;
}

function buildDailyViewsSeriesDisplay(
  viewsByDay: Map<string, number>,
  windowBounds: { startIso: string; endIso: string } | null
): { date: string; views: number }[] {
  if (windowBounds) {
    return eachIsoDateInclusive(
      windowBounds.startIso,
      windowBounds.endIso
    ).map((date) => ({
      date,
      views: viewsByDay.get(date) ?? 0,
    }));
  }
  const sorted = [...viewsByDay.keys()].sort();
  return sorted.map((date) => ({
    date,
    views: viewsByDay.get(date) ?? 0,
  }));
}

/** Sum (views/1000)*rpm in USD per calendar day from channelanalytics rows. */
function buildDailyRevenueUsdFromViewsRpm(
  analyticsRows: string[][],
  windowBounds: { startIso: string; endIso: string } | null,
  rpmCfg: NonNullable<AppConfig["adminViewsRpmUsd"]>,
  channelIdToDisplayName: Map<string, string>,
  normalize: (s: string) => string
): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const row of analyticsRows) {
    const date = String(row[0] ?? "").trim();
    const channelName = channelAnalyticsRowDisplayName(
      row,
      channelIdToDisplayName,
      normalize
    );
    const monetizedViews = monetizedViewsFromChannelAnalyticsRow(row);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!channelName) continue;
    if (
      windowBounds &&
      !rowInYoutubeStudioWindow(
        date,
        windowBounds.startIso,
        windowBounds.endIso
      )
    ) {
      continue;
    }
    const rpm = rpmUsdForChannel(channelName, rpmCfg, normalize);
    if (rpm <= 0) continue;
    const revUsd = (monetizedViews / 1000) * rpm;
    byDay.set(date, (byDay.get(date) ?? 0) + revUsd);
  }
  return byDay;
}

/** EUR per 1k engaged → USD for internal pivot */
function buildDailyRevenueUsdFromViewsRpmEur(
  analyticsRows: string[][],
  windowBounds: { startIso: string; endIso: string } | null,
  rpmCfg: NonNullable<AppConfig["adminViewsRpmEur"]>,
  eurPerUsd: number,
  channelIdToDisplayName: Map<string, string>,
  normalize: (s: string) => string
): Map<string, number> {
  const byDay = new Map<string, number>();
  if (!eurPerUsd || eurPerUsd <= 0) return byDay;
  for (const row of analyticsRows) {
    const date = String(row[0] ?? "").trim();
    const channelName = channelAnalyticsRowDisplayName(
      row,
      channelIdToDisplayName,
      normalize
    );
    const monetizedViews = monetizedViewsFromChannelAnalyticsRow(row);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!channelName) continue;
    if (
      windowBounds &&
      !rowInYoutubeStudioWindow(
        date,
        windowBounds.startIso,
        windowBounds.endIso
      )
    ) {
      continue;
    }
    const rpmEur = rpmEurForChannel(channelName, rpmCfg, normalize);
    if (rpmEur <= 0) continue;
    const revUsd = (monetizedViews / 1000) * (rpmEur / eurPerUsd);
    byDay.set(date, (byDay.get(date) ?? 0) + revUsd);
  }
  return byDay;
}

/** Single manual EUR RPM for every channel-day */
function buildDailyRevenueUsdFromManualRpmEur(
  analyticsRows: string[][],
  windowBounds: { startIso: string; endIso: string } | null,
  rpmEur: number,
  eurPerUsd: number
): Map<string, number> {
  const byDay = new Map<string, number>();
  if (rpmEur <= 0 || !eurPerUsd || eurPerUsd <= 0) return byDay;
  for (const row of analyticsRows) {
    const date = String(row[0] ?? "").trim();
    const monetizedViews = monetizedViewsFromChannelAnalyticsRow(row);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (
      windowBounds &&
      !rowInYoutubeStudioWindow(
        date,
        windowBounds.startIso,
        windowBounds.endIso
      )
    ) {
      continue;
    }
    const revUsd = (monetizedViews / 1000) * (rpmEur / eurPerUsd);
    byDay.set(date, (byDay.get(date) ?? 0) + revUsd);
  }
  return byDay;
}

function aggregateEngagedViewsByChannel(
  analyticsRows: string[][],
  windowBounds: { startIso: string; endIso: string } | null,
  channelIdToDisplayName: Map<string, string>,
  normalize: (s: string) => string
): Map<string, number> {
  const m = new Map<string, number>();
  for (const row of analyticsRows) {
    const date = String(row[0] ?? "").trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (
      windowBounds &&
      !rowInYoutubeStudioWindow(
        date,
        windowBounds.startIso,
        windowBounds.endIso
      )
    ) {
      continue;
    }
    const name = channelAnalyticsRowDisplayName(
      row,
      channelIdToDisplayName,
      normalize
    );
    if (!name) continue;
    const v = monetizedViewsFromChannelAnalyticsRow(row);
    m.set(name, (m.get(name) ?? 0) + v);
  }
  return m;
}

function recalcTotalsFromByChannelUsd(
  byChannel: Record<string, ChannelAgg>
): { revenue: number; costs: number; profit: number } {
  let revenue = 0;
  let costs = 0;
  for (const a of Object.values(byChannel)) {
    revenue += a.revenue;
    costs += a.costs;
  }
  return { revenue, costs, profit: revenue - costs };
}

type RpmRevenueMode =
  | { kind: "manual_eur"; rpmEur: number; eurPerUsd: number }
  | {
      kind: "config_eur";
      cfg: NonNullable<AppConfig["adminViewsRpmEur"]>;
      eurPerUsd: number;
    }
  | { kind: "config_usd"; cfg: NonNullable<AppConfig["adminViewsRpmUsd"]> };

function applyRpmRevenueToByChannel(
  byChannel: Record<string, ChannelAgg>,
  engagedByChannel: Map<string, number>,
  mode: RpmRevenueMode,
  normalize: (s: string) => string
): void {
  const names = new Set<string>([
    ...Object.keys(byChannel),
    ...engagedByChannel.keys(),
  ]);
  for (const name of names) {
    const engaged = engagedByChannel.get(name) ?? 0;
    let revUsd = 0;
    if (mode.kind === "manual_eur") {
      revUsd =
        (engaged / 1000) * (mode.rpmEur / mode.eurPerUsd);
    } else if (mode.kind === "config_eur") {
      const rpm = rpmEurForChannel(name, mode.cfg, normalize);
      revUsd =
        rpm > 0 ? (engaged / 1000) * (rpm / mode.eurPerUsd) : 0;
    } else {
      const rpm = rpmUsdForChannel(name, mode.cfg, normalize);
      revUsd = rpm > 0 ? (engaged / 1000) * rpm : 0;
    }
    if (!byChannel[name]) {
      byChannel[name] = { revenue: 0, costs: 0, profit: 0 };
    }
    byChannel[name].revenue = revUsd;
    byChannel[name].profit = byChannel[name].revenue - byChannel[name].costs;
  }
}

const MAX_CUSTOM_RANGE_DAYS = 800;

function parseYyyyMmDdStrict(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return s;
}

function parseCustomWindowParams(
  startStr: string,
  endStr: string
): { startIso: string; endIso: string } | null {
  const a = parseYyyyMmDdStrict(startStr);
  const b = parseYyyyMmDdStrict(endStr);
  if (!a || !b) return null;
  if (a > b) return null;
  const days = inclusiveDayCount(a, b);
  if (days > MAX_CUSTOM_RANGE_DAYS) return null;
  return { startIso: a, endIso: b };
}

type RevenueWindowJson =
  | { mode: "all"; days: null }
  | {
      mode: "rolling";
      days: number;
      startDate: string;
      endDate: string;
      reportingTimeZone: string;
      reportingTimeZoneLabel: string;
      includesTodayPacific: boolean;
    }
  | {
      mode: "custom";
      days: null;
      startDate: string;
      endDate: string;
      reportingTimeZone: string;
      reportingTimeZoneLabel: string;
    };

function buildRevenueWindowJson(opts: {
  custom: { startIso: string; endIso: string } | null;
  windowDays: number | null;
  includeTodayPacific: boolean;
}): RevenueWindowJson {
  if (opts.custom) {
    return {
      mode: "custom",
      days: null,
      startDate: opts.custom.startIso,
      endDate: opts.custom.endIso,
      reportingTimeZone: YOUTUBE_ANALYTICS_DAY_TZ,
      reportingTimeZoneLabel:
        "Pacific Time — inclusive calendar dates (matches sheet Date column)",
    };
  }
  if (opts.windowDays == null) {
    return { mode: "all", days: null };
  }
  const { startIso, endIso } = rollingYoutubeStudioInclusiveRange(
    opts.windowDays,
    opts.includeTodayPacific
  );
  return {
    mode: "rolling",
    days: opts.windowDays,
    startDate: startIso,
    endDate: endIso,
    reportingTimeZone: YOUTUBE_ANALYTICS_DAY_TZ,
    reportingTimeZoneLabel:
      "Pacific Time — same “day” calendar as YouTube Studio & Analytics API",
    includesTodayPacific: opts.includeTodayPacific,
  };
}

/** In-memory FX cache (USD → EUR multiplier: EUR per 1 USD) */
let fxCache: { eurPerUsd: number; asOf: string; fetchedAt: number } | null = null;
const FX_TTL_MS = 60 * 60 * 1000;

function parseMoney(val: unknown): number {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  let s = String(val ?? "").trim().replace(/\s/g, "");
  if (!s) return 0;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

const YT_TAG_REGEX_ESC = YT_REV_TAG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * YouTube scraper writes: `[yt-analytics-estimatedRevenue] USD|EUR · YouTube Analytics`
 * Values are in that currency (EU AdSense → often EUR). Treating EUR cells as USD and
 * then applying USD→EUR FX **again** inflated totals (~× rate).
 */
function youtubeRowSheetCurrency(note: string): "USD" | "EUR" {
  if (!note.includes(YT_REV_TAG)) return "USD";
  const m = note.match(
    new RegExp(`${YT_TAG_REGEX_ESC}\\s+(USD|EUR)\\b`, "i")
  );
  if (m && String(m[1]).toUpperCase() === "EUR") return "EUR";
  return "USD";
}

function sheetRowCurrency(note: string, isYoutubeRevenueRow: boolean): "USD" | "EUR" {
  if (isYoutubeRevenueRow) return youtubeRowSheetCurrency(note);
  if (/\[EUR\]/i.test(note) || /\[currency:EUR\]/i.test(note)) return "EUR";
  return "USD";
}

function normalizeChannelName(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Convert sheet amount to USD for aggregation (pivot). eurPerUsd = EUR per 1 USD. */
function amountToUsd(
  amount: number,
  sheet: "USD" | "EUR",
  eurPerUsd: number
): number {
  if (sheet === "USD") return amount;
  if (!eurPerUsd || eurPerUsd <= 0) return amount;
  return amount / eurPerUsd;
}

/** Convert USD-normalized amount to display currency */
function usdToDisplay(
  usd: number,
  display: DisplayCurrency,
  eurPerUsd: number
): number {
  if (display === "USD") return usd;
  return usd * eurPerUsd;
}

async function fetchEurPerUsd(): Promise<{ eurPerUsd: number; asOf: string }> {
  const fallback = Number(process.env.FALLBACK_USD_EUR_RATE ?? "0.92");
  const safeFallback =
    Number.isFinite(fallback) && fallback > 0 ? fallback : 0.92;

  if (fxCache && Date.now() - fxCache.fetchedAt < FX_TTL_MS) {
    return { eurPerUsd: fxCache.eurPerUsd, asOf: fxCache.asOf };
  }

  try {
    const res = await fetch(
      "https://api.frankfurter.app/latest?from=USD&to=EUR"
    );
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as {
      rates?: { EUR?: number };
      date?: string;
    };
    const eur = j.rates?.EUR;
    if (typeof eur !== "number" || !Number.isFinite(eur) || eur <= 0) {
      throw new Error("missing EUR rate");
    }
    const asOf = j.date ?? new Date().toISOString().slice(0, 10);
    fxCache = { eurPerUsd: eur, asOf, fetchedAt: Date.now() };
    return { eurPerUsd: eur, asOf };
  } catch (e) {
    console.warn("[financials] FX fetch failed, using fallback:", e);
    const asOf = "fallback";
    fxCache = {
      eurPerUsd: safeFallback,
      asOf,
      fetchedAt: Date.now(),
    };
    return { eurPerUsd: safeFallback, asOf };
  }
}

/** A1 notation: quote sheet title, escape ' as '' */
function sheetRange(tab: string, a1: string): string {
  const q = tab.replace(/'/g, "''");
  return `'${q}'!${a1}`;
}

async function getSheetsClient() {
  const auth = createSheetsGoogleAuth([
    "https://www.googleapis.com/auth/spreadsheets",
  ]);
  return google.sheets({ version: "v4", auth });
}

async function ensureFinanceTab(
  sheets: Awaited<ReturnType<typeof getSheetsClient>>,
  spreadsheetId: string,
  tab: string
): Promise<{ created: boolean; error?: string }> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === tab);
  if (exists) return { created: false };

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tab } } }],
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      created: false,
      error: `Could not create tab "${tab}". Share the spreadsheet with your service account as Editor. ${msg}`,
    };
  }

  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: sheetRange(tab, "A1:E1"),
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [["Date", "Channel", "Revenue", "Costs", "Note"]],
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      created: true,
      error: `Tab was created but headers could not be written. ${msg}`,
    };
  }

  return { created: true };
}

function aggregateFinanceSheetUsd(
  values: string[][],
  eurPerUsd: number,
  windowBounds: { startIso: string; endIso: string } | null
): {
  byChannel: Record<string, ChannelAgg>;
  totals: { revenue: number; costs: number; profit: number };
  /** Per calendar day (Pacific window), USD — before display conversion */
  dailyUsd: Map<string, { revenue: number; costs: number }>;
} {
  const header = values[0].map((h) => String(h ?? "").trim().toLowerCase());
  const idx = (names: string[]) => {
    for (let c = 0; c < header.length; c++) {
      if (names.some((n) => header[c] === n || header[c].includes(n))) return c;
    }
    return -1;
  };

  let colDate = idx(["date", "datum"]);
  let colChannel = idx(["channel", "kanal", "account"]);
  let colRevenue = idx(["revenue", "income", "einnahmen", "umsatz"]);
  let colCosts = idx(["costs", "cost", "kosten", "ausgaben"]);
  let colNote = idx(["note", "notiz", "notes"]);
  if (colDate < 0) colDate = 0;
  if (colChannel < 0) colChannel = 1;
  if (colRevenue < 0) colRevenue = 2;
  if (colCosts < 0) colCosts = 3;
  if (colNote < 0) colNote = 4;

  const byChannel: Record<string, ChannelAgg> = {};
  const dailyUsd = new Map<string, { revenue: number; costs: number }>();
  let totalRevUsd = 0;
  let totalCostUsd = 0;

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (!row || row.every((c) => !String(c ?? "").trim())) continue;

    const iso = parseRowISODate(row[colDate]);
    if (windowBounds) {
      if (
        !iso ||
        !rowInYoutubeStudioWindow(
          iso,
          windowBounds.startIso,
          windowBounds.endIso
        )
      )
        continue;
    }

    const channel =
      normalizeChannelName(String(row[colChannel] ?? "")) || "Unassigned";
    const note = String(row[colNote] ?? "");
    const isYt = note.includes(YT_REV_TAG);
    const sheetCur = sheetRowCurrency(note, isYt);

    const revUsd = amountToUsd(parseMoney(row[colRevenue]), sheetCur, eurPerUsd);
    const costUsd = amountToUsd(parseMoney(row[colCosts]), sheetCur, eurPerUsd);

    totalRevUsd += revUsd;
    totalCostUsd += costUsd;
    if (!byChannel[channel]) {
      byChannel[channel] = { revenue: 0, costs: 0, profit: 0 };
    }
    byChannel[channel].revenue += revUsd;
    byChannel[channel].costs += costUsd;
    byChannel[channel].profit = byChannel[channel].revenue - byChannel[channel].costs;

    if (iso) {
      const prev = dailyUsd.get(iso) ?? { revenue: 0, costs: 0 };
      prev.revenue += revUsd;
      prev.costs += costUsd;
      dailyUsd.set(iso, prev);
    }
  }

  for (const k of Object.keys(byChannel)) {
    byChannel[k].profit = byChannel[k].revenue - byChannel[k].costs;
  }

  return {
    byChannel,
    totals: {
      revenue: totalRevUsd,
      costs: totalCostUsd,
      profit: totalRevUsd - totalCostUsd,
    },
    dailyUsd,
  };
}

function convertAggToDisplay(
  byChannel: Record<string, ChannelAgg>,
  totals: { revenue: number; costs: number; profit: number },
  display: DisplayCurrency,
  eurPerUsd: number
): {
  byChannel: Record<string, ChannelAgg>;
  totals: { revenue: number; costs: number; profit: number };
} {
  const mapAgg = (a: ChannelAgg): ChannelAgg => ({
    revenue: usdToDisplay(a.revenue, display, eurPerUsd),
    costs: usdToDisplay(a.costs, display, eurPerUsd),
    profit: usdToDisplay(a.profit, display, eurPerUsd),
  });

  const outCh: Record<string, ChannelAgg> = {};
  for (const [k, v] of Object.entries(byChannel)) {
    outCh[k] = mapAgg(v);
  }

  return {
    byChannel: outCh,
    totals: {
      revenue: usdToDisplay(totals.revenue, display, eurPerUsd),
      costs: usdToDisplay(totals.costs, display, eurPerUsd),
      profit: usdToDisplay(totals.profit, display, eurPerUsd),
    },
  };
}

function parseDisplay(raw: string | null): DisplayCurrency {
  const u = String(raw ?? "").toUpperCase();
  if (u === "USD") return "USD";
  return "EUR";
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const display = parseDisplay(request.nextUrl.searchParams.get("display"));
    const startQ = request.nextUrl.searchParams.get("start");
    const endQ = request.nextUrl.searchParams.get("end");
    const startTrim = startQ?.trim() ?? "";
    const endTrim = endQ?.trim() ?? "";

    if ((startTrim && !endTrim) || (!startTrim && endTrim)) {
      return NextResponse.json(
        {
          error:
            "Custom range needs both start and end as YYYY-MM-DD (Pacific calendar dates).",
        },
        { status: 400 }
      );
    }

    const customWindow =
      startTrim && endTrim ? parseCustomWindowParams(startTrim, endTrim) : null;
    if (startTrim && endTrim && !customWindow) {
      return NextResponse.json(
        {
          error: `Invalid custom range (use real dates, start ≤ end, max ${MAX_CUSTOM_RANGE_DAYS} days).`,
        },
        { status: 400 }
      );
    }

    const windowDays = customWindow ? null : parseWindowDays(
      request.nextUrl.searchParams.get("window")
    );
    const { eurPerUsd, asOf } = await fetchEurPerUsd();

    const cfg = loadConfig();
    const includeTodayPacific = resolveIncludeTodayPacific(cfg);

    const windowBounds = customWindow
      ? customWindow
      : windowDays != null
        ? rollingYoutubeStudioInclusiveRange(windowDays, includeTodayPacific)
        : null;

    const revenueWindow = buildRevenueWindowJson({
      custom: customWindow,
      windowDays,
      includeTodayPacific,
    });
    const tab = cfg.adminFinanceTab ?? "adminfinance";
    const sheets = await getSheetsClient();

    let values: string[][] = [];
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: cfg.spreadsheetId,
        range: sheetRange(tab, "A1:E2000"),
      });
      values = (res.data.values ?? []) as string[][];
    } catch {
      const ensured = await ensureFinanceTab(sheets, cfg.spreadsheetId, tab);
      if (ensured.error) {
        return NextResponse.json({
          configured: true,
          tab,
          displayCurrency: display,
          currency: display,
          revenueWindow,
          fx: {
            eurPerUsd,
            rateAsOf: asOf,
            source: "Frankfurter (ECB); fallback if offline",
          },
          totals: { revenue: 0, costs: 0, profit: 0 },
          byChannel: {} as Record<string, ChannelAgg>,
          dailySeries: [] as {
            date: string;
            revenue: number;
            costs: number;
            profit: number;
          }[],
          dailyViewsSeries: [] as { date: string; views: number }[],
          channelRevenueSplits: cfg.adminChannelRevenueSplits ?? {},
          message: ensured.error,
          info: null as string | null,
        });
      }
      try {
        const res2 = await sheets.spreadsheets.values.get({
          spreadsheetId: cfg.spreadsheetId,
          range: sheetRange(tab, "A1:E2000"),
        });
        values = (res2.data.values ?? []) as string[][];
      } catch {
        return NextResponse.json({
          configured: true,
          tab,
          displayCurrency: display,
          currency: display,
          revenueWindow,
          fx: { eurPerUsd, rateAsOf: asOf, source: "Frankfurter (ECB)" },
          totals: { revenue: 0, costs: 0, profit: 0 },
          byChannel: {} as Record<string, ChannelAgg>,
          dailySeries: [] as {
            date: string;
            revenue: number;
            costs: number;
            profit: number;
          }[],
          dailyViewsSeries: [] as { date: string; views: number }[],
          channelRevenueSplits: cfg.adminChannelRevenueSplits ?? {},
          message: `Could not read tab "${tab}" after setup. Check spreadsheet ID and sharing.`,
          info: null,
        });
      }
    }

    if (values.length < 2) {
      return NextResponse.json({
        configured: true,
        tab,
        displayCurrency: display,
        currency: display,
        revenueWindow,
        fx: { eurPerUsd, rateAsOf: asOf, source: "Frankfurter (ECB)" },
        totals: { revenue: 0, costs: 0, profit: 0 },
        byChannel: {},
        dailySeries: [] as {
          date: string;
          revenue: number;
          costs: number;
          profit: number;
        }[],
        dailyViewsSeries: [] as { date: string; views: number }[],
        channelRevenueSplits: cfg.adminChannelRevenueSplits ?? {},
        message:
          "No finance rows yet. Run the revenue scraper (writes real YouTube Analytics estimated revenue): from project root, `.venv/bin/python -m scraper.run_channel_analytics_revenue` with GOOGLE_APPLICATION_CREDENTIALS + YOUTUBE_API_KEY. Re-run OAuth once if prompted: `python -m scraper.youtube_analytics_oauth_console`.",
        info: null,
      });
    }

    const {
      byChannel: byUsd,
      totals: totalsUsd,
      dailyUsd,
    } = aggregateFinanceSheetUsd(values, eurPerUsd, windowBounds);

    let analyticsRows: string[][] = [];
    try {
      const caTab = cfg.channelAnalyticsTab ?? "channelanalytics";
      const ares = await sheets.spreadsheets.values.get({
        spreadsheetId: cfg.spreadsheetId,
        range: sheetRange(caTab, "A2:E100000"),
      });
      analyticsRows = (ares.data.values ?? []) as string[][];
    } catch (e) {
      console.warn("[financials] Could not read channelanalytics:", e);
    }

    const channelIdToDisplayName = buildChannelIdToDisplayNameMap(
      analyticsRows,
      cfg,
      normalizeChannelName
    );

    const viewsByDay = buildDailyViewsByDay(analyticsRows, windowBounds);
    const dailyViewsSeries = buildDailyViewsSeriesDisplay(
      viewsByDay,
      windowBounds
    );

    const rpmEurQuery = parseRpmEurQuery(
      request.nextUrl.searchParams.get("rpmEur")
    );

    type DailyRevSource =
      | "sheet"
      | "views_rpm_usd"
      | "views_rpm_eur"
      | "manual_rpm_eur";

    let revenueUsdByDayFromViews: Map<string, number> | null = null;
    let dailyRevenueSource: DailyRevSource = "sheet";
    let revenueEstimateMode: DailyRevSource = "sheet";

    const engagedByChannel = aggregateEngagedViewsByChannel(
      analyticsRows,
      windowBounds,
      channelIdToDisplayName,
      normalizeChannelName
    );

    let rpmMode: RpmRevenueMode | null = null;
    if (rpmEurQuery > 0 && eurPerUsd > 0) {
      rpmMode = {
        kind: "manual_eur",
        rpmEur: rpmEurQuery,
        eurPerUsd,
      };
      revenueUsdByDayFromViews = buildDailyRevenueUsdFromManualRpmEur(
        analyticsRows,
        windowBounds,
        rpmEurQuery,
        eurPerUsd
      );
      dailyRevenueSource = "manual_rpm_eur";
      revenueEstimateMode = "manual_rpm_eur";
    } else if (
      adminViewsRpmEurConfigEnabled(cfg) &&
      cfg.adminViewsRpmEur &&
      eurPerUsd > 0
    ) {
      rpmMode = {
        kind: "config_eur",
        cfg: cfg.adminViewsRpmEur,
        eurPerUsd,
      };
      revenueUsdByDayFromViews = buildDailyRevenueUsdFromViewsRpmEur(
        analyticsRows,
        windowBounds,
        cfg.adminViewsRpmEur,
        eurPerUsd,
        channelIdToDisplayName,
        normalizeChannelName
      );
      dailyRevenueSource = "views_rpm_eur";
      revenueEstimateMode = "views_rpm_eur";
    } else if (adminViewsRpmUsdConfigEnabled(cfg) && cfg.adminViewsRpmUsd) {
      rpmMode = {
        kind: "config_usd",
        cfg: cfg.adminViewsRpmUsd,
      };
      revenueUsdByDayFromViews = buildDailyRevenueUsdFromViewsRpm(
        analyticsRows,
        windowBounds,
        cfg.adminViewsRpmUsd,
        channelIdToDisplayName,
        normalizeChannelName
      );
      dailyRevenueSource = "views_rpm_usd";
      revenueEstimateMode = "views_rpm_usd";
    }

    if (rpmMode) {
      applyRpmRevenueToByChannel(
        byUsd,
        engagedByChannel,
        rpmMode,
        normalizeChannelName
      );
      Object.assign(totalsUsd, recalcTotalsFromByChannelUsd(byUsd));
    }

    const dailySeries = buildDailySeriesDisplay(
      dailyUsd,
      windowBounds,
      display,
      eurPerUsd,
      revenueUsdByDayFromViews
    );

    const costsCfg = resolveAdminComputedCosts(cfg);
    let videoRows: string[][] = [];
    try {
      const videoTab = cfg.videoStatsRawTab ?? "videostatsraw";
      const vres = await sheets.spreadsheets.values.get({
        spreadsheetId: cfg.spreadsheetId,
        range: sheetRange(videoTab, "A2:K100000"),
      });
      videoRows = (vres.data.values ?? []) as string[][];
    } catch (e) {
      console.warn("[financials] Could not read videostatsraw for upload counts:", e);
    }

    const { uploadCounts, allTimeDateSpan } =
      aggregateVideoUploadsFromSheetRows(
        videoRows,
        normalizeChannelName,
        windowBounds
      );

    let periodDays = 0;
    if (windowBounds) {
      periodDays = inclusiveDayCount(
        windowBounds.startIso,
        windowBounds.endIso
      );
    } else if (allTimeDateSpan) {
      periodDays = inclusiveDayCount(
        allTimeDateSpan.minIso,
        allTimeDateSpan.maxIso
      );
    }

    const computedApplied = applyComputedBusinessCostsUsd(
      byUsd,
      totalsUsd,
      uploadCounts,
      costsCfg,
      periodDays,
      normalizeChannelName
    );

    const { byChannel, totals } = convertAggToDisplay(
      byUsd,
      totalsUsd,
      display,
      eurPerUsd
    );

    return NextResponse.json({
      configured: true,
      tab,
      displayCurrency: display,
      currency: display,
      revenueWindow,
      fx: {
        eurPerUsd,
        rateAsOf: asOf,
        source: "api.frankfurter.app (ECB)",
        sheetRules:
          "YouTube rows: currency after the analytics tag (USD or EUR from the API) is respected. Manual rows: USD unless [EUR] in Note.",
        revenueAccuracyHint:
          "28d / 7d end on **yesterday** in Pacific by default (like Studio when today is empty). Custom ranges use inclusive Pacific calendar dates. Set youtubeAnalyticsIncludeTodayPacific to include today on rolling windows. Use EUR in config for API currency. Small gaps: refresh, rounding.",
      },
      totals,
      byChannel,
      dailySeries,
      dailyViewsSeries,
      dailyRevenueSource,
      revenueEstimateMode,
      computedCosts: {
        basisCurrency: "USD" as const,
        periodDays,
        uploadsByChannel: uploadCounts,
        editorByChannelUsd: computedApplied.editorByChannelUsd,
        editorTotalUsd: computedApplied.editorTotalUsd,
        vaUsd: computedApplied.vaUsd,
        subscriptionUsd: computedApplied.subscriptionUsd,
        sharedTotalUsd:
          computedApplied.vaUsd + computedApplied.subscriptionUsd,
        assumptions: {
          editorUsdPerVideo: costsCfg.editorUsdPerVideo,
          editorExcludeChannelNames: costsCfg.editorExcludeChannelNames,
          channelEditorUsdPerVideo: costsCfg.channelEditorUsdPerVideo,
          vaUsdPerWeek: costsCfg.vaUsdPerWeek,
          subscriptionUsdPerMonth: costsCfg.subscriptionUsdPerMonth,
        },
      },
      channelRevenueSplits: cfg.adminChannelRevenueSplits ?? {},
      message: null as string | null,
      info: null as string | null,
    });
  } catch (err) {
    console.error("Error in /api/admin/financials:", err);
    return NextResponse.json(
      { error: "Failed to load financials" },
      { status: 500 }
    );
  }
}
