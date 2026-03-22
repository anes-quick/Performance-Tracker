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

/** `null` = sum all rows (all time). */
function parseWindowDays(raw: string | null): number | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "all" || s === "0") return null;
  const n = parseInt(s, 10);
  if (n === 30) return 30;
  if (n === 28 || s === "") return 28;
  if (Number.isFinite(n) && n > 0 && n <= 366) return n;
  return 28;
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
  let totalRevUsd = 0;
  let totalCostUsd = 0;

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (!row || row.every((c) => !String(c ?? "").trim())) continue;

    if (windowBounds) {
      const iso = parseRowISODate(row[colDate]);
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
        channelRevenueSplits: cfg.adminChannelRevenueSplits ?? {},
        message:
          "No finance rows yet. Run the revenue scraper (writes real YouTube Analytics estimated revenue): from project root, `.venv/bin/python -m scraper.run_channel_analytics_revenue` with GOOGLE_APPLICATION_CREDENTIALS + YOUTUBE_API_KEY. Re-run OAuth once if prompted: `python -m scraper.youtube_analytics_oauth_console`.",
        info: null,
      });
    }

    const { byChannel: byUsd, totals: totalsUsd } = aggregateFinanceSheetUsd(
      values,
      eurPerUsd,
      windowBounds
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
          "28d / 30d end on **yesterday** in Pacific by default (like Studio when today is empty). Custom ranges use inclusive Pacific calendar dates. Set youtubeAnalyticsIncludeTodayPacific to include today on rolling windows. Use EUR in config for API currency. Small gaps: refresh, rounding.",
      },
      totals,
      byChannel,
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
