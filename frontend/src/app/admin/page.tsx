"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildAdminFinanceExportTsv } from "@/lib/adminFinanceExport";
import { formatChartDateLabel } from "@/lib/formatChartDate";
import {
  pacificMonthOptions,
  previousPacificMonthRange,
  rangeForPacificMonth,
  thisPacificMonthMtd,
} from "@/lib/pacificDateUi";

type ApiChannelAgg = { revenue: number; costs: number; profit: number };

/** After overrides + partner split (admin view). */
type ChannelAgg = ApiChannelAgg & {
  grossRevenue: number;
  partnerRevenue?: number;
  /** Ops + editor etc. + partner share (for display as one “cost” bar). */
  costsWithPartner: number;
};

type ComputedCostsPayload = {
  basisCurrency: "USD";
  periodDays: number;
  uploadsByChannel: Record<string, number>;
  editorByChannelUsd: Record<string, number>;
  editorTotalUsd: number;
  vaUsd: number;
  subscriptionUsd: number;
  sharedTotalUsd: number;
  assumptions: {
    editorUsdPerVideo: number;
    editorExcludeChannelNames: string[];
    channelEditorUsdPerVideo: Record<string, number>;
    vaUsdPerWeek: number;
    subscriptionUsdPerMonth: number;
  };
};

type FinancialsResponse = {
  configured?: boolean;
  tab?: string;
  displayCurrency?: "EUR" | "USD";
  currency?: string;
  channelRevenueSplits?: Record<string, { yourPercent: number }>;
  computedCosts?: ComputedCostsPayload | null;
  revenueWindow?: {
    mode: "rolling" | "all" | "custom";
    days: number | null;
    /** Inclusive Pacific calendar dates (rolling, custom) */
    startDate?: string;
    endDate?: string;
    reportingTimeZone?: string;
    reportingTimeZoneLabel?: string;
    /** Rolling windows only: false = ends yesterday Pacific (default) */
    includesTodayPacific?: boolean;
  };
  fx?: {
    eurPerUsd: number;
    rateAsOf: string;
    source?: string;
    sheetRules?: string;
    revenueAccuracyHint?: string;
  };
  totals: { revenue: number; costs: number; profit: number };
  byChannel: Record<string, ApiChannelAgg>;
  /** One row per calendar day in the selected window (sheet data; no pencil overrides). */
  dailySeries?: { date: string; revenue: number; costs: number; profit: number }[];
  /** How daily chart revenue is built; when RPM modes are on, channel totals match the same model. */
  dailyRevenueSource?:
    | "sheet"
    | "views_rpm_usd"
    | "views_rpm_eur"
    | "manual_rpm_eur";
  /** Same as dailyRevenueSource for the successful response (explicit label for UI). */
  revenueEstimateMode?:
    | "sheet"
    | "views_rpm_usd"
    | "views_rpm_eur"
    | "manual_rpm_eur";
  /** Per day: sum of engaged_views (col E) when scraped; else legacy `views` (col D). Used for RPM. */
  dailyViewsSeries?: { date: string; views: number }[];
  message?: string | null;
  info?: string | null;
  error?: string;
};

function formatMoney(n: number, currency: "EUR" | "USD") {
  const locale = currency === "USD" ? "en-US" : "de-DE";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatMoneyDetail(n: number, currency: "EUR" | "USD") {
  const locale = currency === "USD" ? "en-US" : "de-DE";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatMoneyCompact(n: number, currency: "EUR" | "USD") {
  const locale = currency === "USD" ? "en-US" : "de-DE";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function usdBasisToDisplay(
  usd: number,
  display: "EUR" | "USD",
  eurPerUsd: number
) {
  if (display === "USD") return usd;
  return usd * eurPerUsd;
}

/** User-typed amount in current display currency → USD (for localStorage). */
function displayAmountToUsd(
  amount: number,
  display: "EUR" | "USD",
  eurPerUsd: number
) {
  if (display === "USD") return amount;
  return amount / eurPerUsd;
}

const REVENUE_OVERRIDE_STORAGE_KEY = "performance-tracker-admin-revenue-overrides-v1";

function revenueOverrideScopeKey(d: FinancialsResponse): string {
  if (
    d.revenueWindow?.mode === "custom" &&
    d.revenueWindow.startDate &&
    d.revenueWindow.endDate
  ) {
    return `custom:${d.revenueWindow.startDate}:${d.revenueWindow.endDate}`;
  }
  if (
    d.revenueWindow?.mode === "rolling" &&
    d.revenueWindow.startDate &&
    d.revenueWindow.endDate &&
    d.revenueWindow.days != null
  ) {
    return `${d.revenueWindow.days}d:${d.revenueWindow.startDate}:${d.revenueWindow.endDate}`;
  }
  return "all";
}

function parseMoneyInput(s: string): number | null {
  let t = s.trim().replace(/\s/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function normalizeChannelNameLocal(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Delays value updates (e.g. RPM query param) so typing doesn’t refetch every keystroke. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/** Your share multiplier 0–1 from channels.config.json adminChannelRevenueSplits */
function yourRevenueShareMultiplier(
  channelName: string,
  splits: Record<string, { yourPercent: number }> | undefined
): number {
  if (!splits || Object.keys(splits).length === 0) return 1;
  const n = normalizeChannelNameLocal(channelName).toLowerCase();
  for (const [k, v] of Object.entries(splits)) {
    if (normalizeChannelNameLocal(k).toLowerCase() === n) {
      const pct =
        typeof v.yourPercent === "number" ? v.yourPercent : 100;
      return Math.min(100, Math.max(0, pct)) / 100;
    }
  }
  return 1;
}

/** Label like "75% split" when channel has a partner revenue split configured. */
function channelSplitBadgeLabel(
  channelName: string,
  splits: Record<string, { yourPercent: number }> | undefined
): string | null {
  if (!splits || Object.keys(splits).length === 0) return null;
  const n = normalizeChannelNameLocal(channelName).toLowerCase();
  for (const [k, v] of Object.entries(splits)) {
    if (normalizeChannelNameLocal(k).toLowerCase() === n) {
      const pct =
        typeof v.yourPercent === "number" ? v.yourPercent : 100;
      const p = Math.min(100, Math.max(0, pct));
      if (p >= 99.9) return null;
      return `${Math.round(p)}% split`;
    }
  }
  return null;
}

/** Profit ÷ gross revenue; bar width = margin % (0–100); colors like low = amber, solid = emerald. */
function MarginBarCell({
  grossRevenue,
  profit,
}: {
  grossRevenue: number;
  profit: number;
}) {
  const pct =
    grossRevenue > 1e-9 ? (profit / grossRevenue) * 100 : null;
  if (pct == null || !Number.isFinite(pct)) {
    return (
      <div className="flex min-w-[4.5rem] flex-col items-end gap-1">
        <span className="text-sm text-zinc-600">—</span>
        <div
          className="h-1.5 w-full max-w-[4.5rem] rounded-full bg-zinc-800/90"
          aria-hidden
        />
      </div>
    );
  }
  const isNeg = pct < 0;
  const isLow = pct >= 0 && pct < 20;
  const barClass = isNeg
    ? "bg-red-500"
    : isLow
      ? "bg-amber-500"
      : "bg-emerald-500";
  const textClass = isNeg
    ? "text-red-400"
    : isLow
      ? "text-amber-200/90"
      : "text-emerald-300";
  const fillW = Math.min(100, Math.max(0, pct));

  return (
    <div
      className="flex min-w-[4.5rem] flex-col items-end gap-1"
      title="Margin = profit ÷ gross revenue (same period)"
    >
      <span
        className={`text-sm font-semibold tabular-nums ${textClass}`}
      >
        {pct.toFixed(1)}%
      </span>
      <div
        className="h-1.5 w-full max-w-[4.5rem] overflow-hidden rounded-full bg-zinc-800/90"
        role="presentation"
      >
        <div
          className={`h-full rounded-full ${barClass} ${pct > 0 && fillW < 4 ? "min-w-[4px]" : ""}`}
          style={{ width: `${fillW}%` }}
        />
      </div>
    </div>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
      />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ComputedCostsSection({
  cc,
  fx,
  cur,
  manualRpmInput,
  onManualRpmChange,
  onClearManualRpm,
}: {
  cc: ComputedCostsPayload | null;
  fx: NonNullable<FinancialsResponse["fx"]>;
  cur: "EUR" | "USD";
  manualRpmInput: string;
  onManualRpmChange: (value: string) => void;
  onClearManualRpm: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition hover:bg-zinc-800/40"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-zinc-200">
          Computed costs &amp; manual RPM
        </span>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open ? (
        <div className="border-t border-zinc-800 px-4 pb-4 pt-3">
          {cc ? (
            <>
          {cc.periodDays === 0 && (
            <p className="mb-3 text-xs text-amber-600/90">
              0-day proration → no VA/sub in this view; check{" "}
              <code className="text-zinc-400">videostatsraw</code> or use 28d/7d/custom
              range.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-xs font-medium uppercase text-zinc-500">
                Uploads → editor
              </h3>
              <ul className="mt-2 space-y-1 text-sm text-zinc-300">
                {Object.entries(cc.uploadsByChannel)
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, n]) => {
                    const edUsd = cc.editorByChannelUsd[name] ?? 0;
                    return (
                      <li
                        key={name}
                        className="flex justify-between gap-2 border-b border-zinc-800/60 py-1"
                      >
                        <span>
                          {name}{" "}
                          <span className="text-zinc-500">({n} uploads)</span>
                        </span>
                        <span className="text-orange-200/90">
                          {formatMoneyDetail(
                            usdBasisToDisplay(edUsd, cur, fx.eurPerUsd),
                            cur
                          )}
                        </span>
                      </li>
                    );
                  })}
                {Object.keys(cc.uploadsByChannel).length === 0 && (
                  <li className="text-zinc-500">
                    No uploads in range (check scraper).
                  </li>
                )}
              </ul>
              <p className="mt-2 text-xs text-zinc-500">
                Editor total:{" "}
                <span className="text-orange-200">
                  {formatMoneyDetail(
                    usdBasisToDisplay(cc.editorTotalUsd, cur, fx.eurPerUsd),
                    cur
                  )}
                </span>
              </p>
            </div>
            <div>
              <h3 className="text-xs font-medium uppercase text-zinc-500">
                Shared (totals only)
              </h3>
              <ul className="mt-2 space-y-2 text-sm text-zinc-300">
                <li className="flex justify-between">
                  <span>VA (prorated)</span>
                  <span className="text-orange-200/90">
                    {formatMoneyDetail(
                      usdBasisToDisplay(cc.vaUsd, cur, fx.eurPerUsd),
                      cur
                    )}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span>Subscriptions (prorated)</span>
                  <span className="text-orange-200/90">
                    {formatMoneyDetail(
                      usdBasisToDisplay(cc.subscriptionUsd, cur, fx.eurPerUsd),
                      cur
                    )}
                  </span>
                </li>
                <li className="flex justify-between border-t border-zinc-700 pt-2 font-medium text-zinc-200">
                  <span>Shared total</span>
                  <span className="text-orange-200">
                    {formatMoneyDetail(
                      usdBasisToDisplay(cc.sharedTotalUsd, cur, fx.eurPerUsd),
                      cur
                    )}
                  </span>
                </li>
              </ul>
            </div>
          </div>
            </>
          ) : (
            <p className="mb-3 text-xs text-zinc-500">
              No <code className="text-zinc-400">adminComputedCosts</code> in{" "}
              <code className="text-zinc-400">channels.config.json</code> — editor/VA
              breakdown is hidden. Manual RPM below still works.
            </p>
          )}
          <div className={`border-t border-zinc-800 pt-4 ${cc ? "mt-6" : "mt-0"}`}>
            <h3 className="text-xs font-medium uppercase text-zinc-500">
              Manual RPM (EUR / 1k engaged views)
            </h3>
            <p className="mt-1 text-xs text-zinc-600">
              Uses YouTube Analytics <strong className="text-zinc-500">engaged_views</strong>{" "}
              (monetization basis; column <code className="text-zinc-500">engaged_views</code> in{" "}
              <code className="text-zinc-500">channelanalytics</code>
              ) when the views scraper has run after the sheet upgrade. Older rows fall back to
              total <code className="text-zinc-500">views</code>. When RPM &gt; 0,{" "}
              <strong className="text-zinc-500">per-channel revenue and top-line totals</strong>{" "}
              are recomputed as{" "}
              <code className="text-zinc-500">(engaged ÷ 1000) × RPM</code> in{" "}
              <strong>EUR per 1,000 views</strong> (then converted for display). Sheet{" "}
              <strong>costs</strong> in the window stay; editor/VA/sub are still added on top.
              Saved in this browser.
            </p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-zinc-400">
                RPM (EUR / 1k engaged views)
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={manualRpmInput}
                  onChange={(e) => onManualRpmChange(e.target.value)}
                  placeholder="e.g. 2.5 — leave empty to off"
                  className="w-44 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600"
                />
              </label>
              <button
                type="button"
                onClick={onClearManualRpm}
                className="rounded border border-zinc-600 px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const MANUAL_RPM_STORAGE_KEY = "performance-tracker-admin-manual-rpm-eur-v1";
const MANUAL_RPM_STORAGE_KEY_LEGACY_USD =
  "performance-tracker-admin-manual-rpm-usd-v1";

export default function AdminPage() {
  const { data: session, status } = useSession();
  const [data, setData] = useState<FinancialsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const dataLoadedRef = useRef(false);
  const [username, setUsername] = useState("anes");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState<"EUR" | "USD">("EUR");
  /** Preset rolling days, all rows, or custom start/end (Pacific dates). */
  const [periodPreset, setPeriodPreset] = useState<"28" | "7" | "all" | "custom">(
    "28"
  );
  /** When `periodPreset === "custom"`, inclusive YYYY-MM-DD (Pacific). */
  const [customRange, setCustomRange] = useState<{
    start: string;
    end: string;
  } | null>(null);

  const customPeriodDialogRef = useRef<HTMLDialogElement>(null);
  const [modalStart, setModalStart] = useState("");
  const [modalEnd, setModalEnd] = useState("");
  const monthChoices = useMemo(() => pacificMonthOptions(24), []);

  /** scopeKey → channel name → revenue override in USD */
  const [overrideStore, setOverrideStore] = useState<
    Record<string, Record<string, number>>
  >({});
  const [editingChannel, setEditingChannel] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [sheetExportStatus, setSheetExportStatus] = useState<
    "idle" | "copied" | "error"
  >("idle");
  const [manualRpmInput, setManualRpmInput] = useState("");
  const debouncedRpmForFetch = useDebouncedValue(manualRpmInput, 450);

  useEffect(() => {
    try {
      const s = localStorage.getItem(MANUAL_RPM_STORAGE_KEY);
      if (s) {
        setManualRpmInput(s);
        return;
      }
      const legacy = localStorage.getItem(MANUAL_RPM_STORAGE_KEY_LEGACY_USD);
      if (legacy) {
        setManualRpmInput(legacy);
        localStorage.setItem(MANUAL_RPM_STORAGE_KEY, legacy);
        localStorage.removeItem(MANUAL_RPM_STORAGE_KEY_LEGACY_USD);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const t = manualRpmInput.trim();
      if (t) localStorage.setItem(MANUAL_RPM_STORAGE_KEY, t);
      else localStorage.removeItem(MANUAL_RPM_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [manualRpmInput]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(REVENUE_OVERRIDE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, Record<string, number>>;
        if (parsed && typeof parsed === "object") setOverrideStore(parsed);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        REVENUE_OVERRIDE_STORAGE_KEY,
        JSON.stringify(overrideStore)
      );
    } catch {
      /* ignore */
    }
  }, [overrideStore]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    async function load() {
      const first = !dataLoadedRef.current;
      if (first) {
        setIsInitialLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setLoadError(null);
      try {
        const params = new URLSearchParams();
        params.set("display", displayCurrency);
        if (periodPreset === "custom" && customRange) {
          params.set("start", customRange.start);
          params.set("end", customRange.end);
        } else {
          params.set(
            "window",
            periodPreset === "custom" ? "28" : periodPreset
          );
        }
        let t = debouncedRpmForFetch.trim().replace(/\s/g, "");
        if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
        const rpmEur = parseFloat(t);
        if (Number.isFinite(rpmEur) && rpmEur > 0) {
          params.set("rpmEur", String(rpmEur));
        }
        const res = await fetch(`/api/admin/financials?${params.toString()}`);
        const json = (await res.json()) as FinancialsResponse & { error?: string };
        if (!res.ok) {
          setLoadError(json.error ?? "Failed to load");
          if (!dataLoadedRef.current) {
            setData(null);
          }
          return;
        }
        if (cancelled) return;
        setData(json);
        dataLoadedRef.current = true;
      } catch {
        setLoadError("Failed to load financials");
        if (!dataLoadedRef.current) {
          setData(null);
        }
      } finally {
        if (!cancelled) {
          setIsInitialLoading(false);
          setIsRefreshing(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    status,
    displayCurrency,
    periodPreset,
    customRange,
    debouncedRpmForFetch,
  ]);

  function openCustomPeriodDialog() {
    if (periodPreset === "custom" && customRange) {
      setModalStart(customRange.start);
      setModalEnd(customRange.end);
    } else {
      const mtd = thisPacificMonthMtd();
      setModalStart(mtd.start);
      setModalEnd(mtd.end);
    }
    customPeriodDialogRef.current?.showModal();
  }

  function applyCustomPeriodFromModal() {
    const s = modalStart.trim();
    const e = modalEnd.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) {
      setLoadError("Use YYYY-MM-DD for start and end.");
      return;
    }
    if (s > e) {
      setLoadError("Start date must be on or before end date.");
      return;
    }
    setLoadError(null);
    setPeriodPreset("custom");
    setCustomRange({ start: s, end: e });
    customPeriodDialogRef.current?.close();
  }

  function selectPreset(p: "28" | "7" | "all") {
    setPeriodPreset(p);
    setCustomRange(null);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setLoginSubmitting(true);
    try {
      const res = await signIn("credentials", {
        username,
        password,
        redirect: false,
      });
      if (res?.error) {
        setLoginError("Wrong username or password.");
      }
    } finally {
      setLoginSubmitting(false);
    }
  }

  const cur: "EUR" | "USD" =
    data?.displayCurrency === "USD" || data?.currency === "USD"
      ? "USD"
      : "EUR";

  const scopeKey = useMemo(
    () => (data ? revenueOverrideScopeKey(data) : ""),
    [data]
  );

  const adjustedByChannel = useMemo(() => {
    if (!data?.byChannel || !data.fx) return {} as Record<string, ChannelAgg>;
    const scoped = scopeKey ? overrideStore[scopeKey] ?? {} : {};
    const out: Record<string, ChannelAgg> = {};
    for (const [name, agg] of Object.entries(data.byChannel)) {
      const ou = scoped[name];
      const gross =
        ou != null && Number.isFinite(ou)
          ? usdBasisToDisplay(ou, cur, data.fx.eurPerUsd)
          : agg.revenue;
      const mult = yourRevenueShareMultiplier(
        name,
        data.channelRevenueSplits
      );
      const yourRev = gross * mult;
      const hasSplit = Math.abs(1 - mult) > 1e-9;
      const partnerAmt = hasSplit ? gross * (1 - mult) : 0;
      const costsWithPartner = agg.costs + partnerAmt;
      out[name] = {
        revenue: yourRev,
        grossRevenue: gross,
        partnerRevenue: hasSplit ? partnerAmt : undefined,
        costs: agg.costs,
        costsWithPartner,
        profit: gross - costsWithPartner,
      };
    }
    return out;
  }, [data, overrideStore, scopeKey, cur]);

  const adjustedTotals = useMemo(() => {
    if (!data?.totals) {
      return {
        grossRevenue: 0,
        partnerRevenue: 0,
        opsCosts: 0,
        costsWithPartner: 0,
        profit: 0,
      };
    }
    let grossSum = 0;
    let partnerSum = 0;
    for (const a of Object.values(adjustedByChannel)) {
      grossSum += a.grossRevenue;
      if (a.partnerRevenue != null && Number.isFinite(a.partnerRevenue)) {
        partnerSum += a.partnerRevenue;
      }
    }
    const opsCosts = data.totals.costs;
    const costsWithPartner = opsCosts + partnerSum;
    return {
      grossRevenue: grossSum,
      partnerRevenue: partnerSum,
      opsCosts,
      costsWithPartner,
      profit: grossSum - costsWithPartner,
    };
  }, [data, adjustedByChannel]);

  const channels = useMemo(
    () =>
      Object.entries(adjustedByChannel).sort(
        (a, b) => b[1].grossRevenue - a[1].grossRevenue
      ),
    [adjustedByChannel]
  );

  function saveRevenueOverride() {
    if (!data?.fx || !scopeKey || !editingChannel) return;
    const parsed = parseMoneyInput(editDraft);
    if (parsed == null) return;
    const usd = displayAmountToUsd(parsed, cur, data.fx.eurPerUsd);
    setOverrideStore((prev) => ({
      ...prev,
      [scopeKey]: { ...(prev[scopeKey] ?? {}), [editingChannel]: usd },
    }));
    setEditingChannel(null);
    setEditDraft("");
  }

  function clearRevenueOverride(channel: string) {
    if (!scopeKey) return;
    setOverrideStore((prev) => {
      const inner = { ...(prev[scopeKey] ?? {}) };
      delete inner[channel];
      const next = { ...prev };
      if (Object.keys(inner).length === 0) delete next[scopeKey];
      else next[scopeKey] = inner;
      return next;
    });
  }

  async function copyStructuredSheetExport() {
    if (!data?.fx || isInitialLoading) return;
    try {
      const tsv = buildAdminFinanceExportTsv({
        generatedAtIso: new Date().toISOString(),
        data: {
          displayCurrency: cur,
          eurPerUsd: data.fx.eurPerUsd,
          revenueWindow: data.revenueWindow,
          channelRevenueSplits: data.channelRevenueSplits,
          computedCosts: data.computedCosts ?? null,
          byChannel: data.byChannel,
        },
        adjustedTotals,
        channelsSorted: channels,
        scopeKey,
        overrideStore,
      });
      await navigator.clipboard.writeText(tsv);
      setSheetExportStatus("copied");
      window.setTimeout(() => setSheetExportStatus("idle"), 2500);
    } catch {
      setSheetExportStatus("error");
      window.setTimeout(() => setSheetExportStatus("idle"), 4000);
    }
  }

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <p className="text-sm text-zinc-400">Loading…</p>
      </main>
    );
  }

  if (status === "unauthenticated") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 px-6 text-zinc-100">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="mt-2 max-w-sm text-sm text-zinc-400">
            Private finance area. Username and password are set in your{" "}
            <code className="rounded bg-zinc-800 px-1">.env.local</code> (see below).
          </p>
        </div>
        <form
          onSubmit={handleLogin}
          className="flex w-full max-w-xs flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5"
        >
          <label className="text-xs font-medium text-zinc-400">
            Username
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          <label className="text-xs font-medium text-zinc-400">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          {loginError && (
            <p className="text-xs text-red-400">{loginError}</p>
          )}
          <button
            type="submit"
            disabled={loginSubmitting}
            className="mt-1 rounded-lg bg-white py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
          >
            {loginSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="max-w-md rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 text-left text-xs text-zinc-500">
          <p className="font-medium text-zinc-400">One-time setup (in frontend/.env.local)</p>
          <ul className="mt-2 list-inside list-disc space-y-1">
            <li>
              <code className="text-zinc-300">NEXTAUTH_SECRET</code> — any long random string (e.g. run{" "}
              <code className="text-zinc-300">openssl rand -base64 32</code>)
            </li>
            <li>
              <code className="text-zinc-300">NEXTAUTH_URL=http://localhost:3000</code> (your site URL when live)
            </li>
            <li>
              <code className="text-zinc-300">ADMIN_USERNAME=admin</code> (or your choice)
            </li>
            <li>
              <code className="text-zinc-300">ADMIN_PASSWORD=…</code> (your choice)
            </li>
          </ul>
          <p className="mt-3 text-zinc-600">
            Money numbers: create sheet tab <code className="text-zinc-400">adminfinance</code> — see{" "}
            <code className="text-zinc-400">ADMIN_SETUP.md</code>.
          </p>
        </div>
        <Link href="/" className="text-xs text-zinc-500 underline hover:text-zinc-300">
          ← Back to main dashboard
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-400">
              Private · Admin only
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Finance overview</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Signed in as {session?.user?.name ?? "Admin"}
            </p>
            {data?.revenueWindow && (
              <p className="mt-1 text-xs text-zinc-500">
                {data.revenueWindow.mode === "all"
                  ? "Totals: all dates in the sheet (not filtered)."
                  : data.revenueWindow.mode === "custom" &&
                      data.revenueWindow.startDate &&
                      data.revenueWindow.endDate
                    ? `Totals: custom range ${data.revenueWindow.startDate} → ${data.revenueWindow.endDate} (${data.revenueWindow.reportingTimeZoneLabel ?? "Pacific"}), inclusive.`
                    : data.revenueWindow.mode === "rolling" &&
                        data.revenueWindow.startDate &&
                        data.revenueWindow.endDate
                      ? `Totals: last ${data.revenueWindow.days} days = ${data.revenueWindow.startDate} → ${data.revenueWindow.endDate} (${data.revenueWindow.reportingTimeZoneLabel ?? "Pacific"}). ${data.revenueWindow.includesTodayPacific ? "Includes today (Pacific)." : "Ends yesterday (Pacific) — matches Studio when today’s row is still empty."} Re-run the revenue scraper after date logic changes.`
                      : "Totals: rolling window (Pacific)."}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900/80 p-1">
              <span className="pl-2 pr-1 text-[10px] font-medium uppercase text-zinc-500">
                Period
              </span>
              <button
                type="button"
                onClick={() => selectPreset("7")}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  periodPreset === "7"
                    ? "bg-violet-600 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                7d
              </button>
              <button
                type="button"
                onClick={() => selectPreset("28")}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  periodPreset === "28"
                    ? "bg-violet-600 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                28d
              </button>
              <button
                type="button"
                onClick={() => selectPreset("all")}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  periodPreset === "all"
                    ? "bg-violet-600 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => openCustomPeriodDialog()}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  periodPreset === "custom"
                    ? "bg-violet-600 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
                title="Pick dates or a month (Pacific)"
              >
                Custom
              </button>
            </div>
            <div className="flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900/80 p-1">
              <button
                type="button"
                onClick={() => setDisplayCurrency("EUR")}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  displayCurrency === "EUR"
                    ? "bg-emerald-600 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                € EUR
              </button>
              <button
                type="button"
                onClick={() => setDisplayCurrency("USD")}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  displayCurrency === "USD"
                    ? "bg-sky-600 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                $ USD
              </button>
            </div>
            <button
              type="button"
              disabled={!data?.fx || isInitialLoading}
              title="Copies tab-separated text — paste into Google Sheets cell A1 or into Claude. Uses the numbers currently on this page (period, currency, overrides)."
              onClick={() => void copyStructuredSheetExport()}
              className="rounded-full border border-emerald-800/80 bg-emerald-950/40 px-4 py-1.5 text-sm text-emerald-200 hover:bg-emerald-900/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sheetExportStatus === "copied"
                ? "Copied for Sheets"
                : sheetExportStatus === "error"
                  ? "Copy failed — try again"
                  : "Copy for Sheets / Claude"}
            </button>
            <Link
              href="/"
              className="rounded-full border border-zinc-600 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
            >
              Main dashboard
            </Link>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/" })}
              className="rounded-full border border-zinc-600 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
            >
              Sign out
            </button>
          </div>
        </header>

        {data?.fx && status === "authenticated" && (
          <p className="-mt-4 text-xs text-zinc-500">
            FX: 1 USD = {data.fx.eurPerUsd.toFixed(4)} EUR
            {data.fx.rateAsOf && data.fx.rateAsOf !== "fallback"
              ? ` (ECB via Frankfurter, ${data.fx.rateAsOf})`
              : " (offline fallback — set FALLBACK_USD_EUR_RATE in .env.local)"}
            . {data.fx.sheetRules ?? ""}
            {data.fx.revenueAccuracyHint && (
              <span className="mt-1 block text-zinc-600">
                {data.fx.revenueAccuracyHint}
              </span>
            )}
          </p>
        )}

        {loadError && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {loadError}
          </div>
        )}

        {isInitialLoading && !data && (
          <p className="text-sm text-zinc-500">Loading financial data…</p>
        )}
        {isRefreshing && data && (
          <p className="text-xs text-zinc-500" aria-live="polite">
            Updating numbers…
          </p>
        )}

        {data?.message && (
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
            {data.message}
          </div>
        )}

        {data?.info && (
          <div className="rounded-lg border border-sky-900/40 bg-sky-950/25 px-4 py-3 text-sm text-sky-100">
            <p className="whitespace-pre-wrap">{data.info}</p>
          </div>
        )}

        {data && (
          <>
            <section className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                <p className="text-xs font-medium uppercase text-zinc-500">Total revenue</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-400">
                  {formatMoney(adjustedTotals.grossRevenue, cur)}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Full channel revenue before partner split.
                </p>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                <p className="text-xs font-medium uppercase text-zinc-500">Total costs</p>
                <p className="mt-2 text-2xl font-semibold text-orange-300">
                  {formatMoney(adjustedTotals.costsWithPartner, cur)}
                </p>
                {adjustedTotals.partnerRevenue > 0 && (
                  <p className="mt-1 text-xs text-zinc-500">
                    Includes partner payout{" "}
                    <span className="text-zinc-400">
                      {formatMoney(adjustedTotals.partnerRevenue, cur)}
                    </span>{" "}
                    · Ops &amp; tools{" "}
                    <span className="text-zinc-400">
                      {formatMoney(adjustedTotals.opsCosts, cur)}
                    </span>
                  </p>
                )}
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                <p className="text-xs font-medium uppercase text-zinc-500">Profit</p>
                <p
                  className={`mt-2 text-2xl font-semibold ${
                    adjustedTotals.profit >= 0 ? "text-sky-400" : "text-red-400"
                  }`}
                >
                  {formatMoney(adjustedTotals.profit, cur)}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Total revenue − all costs (incl. partner).
                </p>
              </div>
            </section>

            {data.fx && (
              <ComputedCostsSection
                key={
                  data.revenueWindow?.mode === "custom" &&
                  data.revenueWindow.startDate &&
                  data.revenueWindow.endDate
                    ? `c:${data.revenueWindow.startDate}:${data.revenueWindow.endDate}`
                    : data.revenueWindow?.mode === "rolling" &&
                        data.revenueWindow.days != null
                      ? `r:${data.revenueWindow.days}`
                      : "all"
                }
                cc={data.computedCosts ?? null}
                fx={data.fx}
                cur={cur}
                manualRpmInput={manualRpmInput}
                onManualRpmChange={setManualRpmInput}
                onClearManualRpm={() => {
                  setManualRpmInput("");
                  try {
                    localStorage.removeItem(MANUAL_RPM_STORAGE_KEY);
                    localStorage.removeItem(MANUAL_RPM_STORAGE_KEY_LEGACY_USD);
                  } catch {
                    /* ignore */
                  }
                }}
              />
            )}

            {Array.isArray(data.dailySeries) && data.dailySeries.length > 0 ? (
              <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <h2 className="text-sm font-semibold text-zinc-200">
                  Daily estimated revenue
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  {data.dailyRevenueSource === "manual_rpm_eur" ? (
                    <>
                      <strong className="text-zinc-400">Manual RPM (EUR):</strong> chart and
                      channel/total revenue use{" "}
                      <code className="text-zinc-400">channelanalytics</code>{" "}
                      <strong>engaged_views</strong> × your RPM (EUR/1k). Costs still from the
                      sheet + computed editor/VA/sub.
                    </>
                  ) : data.dailyRevenueSource === "views_rpm_eur" ? (
                    <>
                      <strong className="text-zinc-400">Engaged views × RPM (EUR):</strong> from{" "}
                      <code className="text-zinc-400">adminViewsRpmEur</code> in{" "}
                      <code className="text-zinc-400">channels.config.json</code> — same basis as
                      per-channel revenue and totals.
                    </>
                  ) : data.dailyRevenueSource === "views_rpm_usd" ? (
                    <>
                      <strong className="text-zinc-400">Engaged views × RPM (USD, legacy):</strong>{" "}
                      <code className="text-zinc-400">adminViewsRpmUsd</code> in config — same basis
                      as per-channel revenue and totals.
                    </>
                  ) : (
                    <>
                      One point per day from the finance sheet (same Pacific window
                      as totals). Pencil overrides are not applied here.
                    </>
                  )}
                </p>
                <div className="mt-4 h-[300px] w-full min-h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.dailySeries}>
                      <CartesianGrid stroke="#3f3f46" vertical={false} />
                      <XAxis
                        dataKey="date"
                        minTickGap={20}
                        tick={{ fontSize: 11, fill: "#a1a1aa" }}
                        tickFormatter={(v) => formatChartDateLabel(String(v))}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "#a1a1aa" }}
                        width={56}
                        tickFormatter={(v) =>
                          formatMoneyCompact(Number(v), cur)
                        }
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#18181b",
                          border: "1px solid #3f3f46",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        labelStyle={{ color: "#e4e4e7" }}
                        labelFormatter={(label) =>
                          formatChartDateLabel(String(label))
                        }
                        formatter={(value) => [
                          formatMoneyDetail(Number(value), cur),
                          "Revenue",
                        ]}
                      />
                      <Line
                        type="monotone"
                        dataKey="revenue"
                        name="Revenue"
                        stroke="#34d399"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>
            ) : (
              <section className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/20 p-4">
                <h2 className="text-sm font-semibold text-zinc-300">
                  Daily chart
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  No days in this period yet. Run{" "}
                  <code className="text-zinc-400">python -m scraper.run_channel_analytics_views</code>{" "}
                  so <code className="text-zinc-400">channelanalytics</code> has{" "}
                  <code className="text-zinc-400">engaged_views</code> (and views), or add dated
                  rows to <code className="text-zinc-400">adminfinance</code> for sheet-only
                  charting.
                </p>
              </section>
            )}

            {data && (
              <p className="-mt-2 text-xs text-zinc-500">
                {data.computedCosts
                  ? "Top-line revenue is gross. Costs column includes partner share + sheet + editor, VA, subscriptions (below). "
                  : ""}
                Revenue overrides (pencil) are{" "}
                <strong>gross</strong> (Studio total); saved in this browser (
                <code className="text-zinc-400">localStorage</code>). Partner % from{" "}
                <code className="text-zinc-400">adminChannelRevenueSplits</code> is counted as{" "}
                <strong>cost</strong> so profit = full revenue − ops − partner.
              </p>
            )}

            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
              <h2 className="text-sm font-semibold text-zinc-200">By channel</h2>
              {channels.length === 0 ? (
                <p className="mt-3 text-sm text-zinc-500">No rows to aggregate yet.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[480px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 text-xs uppercase text-zinc-500">
                        <th className="py-2 pr-4">Channel</th>
                        <th className="py-2 pr-4 text-right">Gross rev</th>
                        <th className="py-2 pr-4 text-right">Total costs</th>
                        <th className="py-2 pr-4 text-right">Profit</th>
                        <th className="py-2 pl-2 text-right">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {channels.map(([name, agg]) => {
                        const scopedMap = scopeKey
                          ? overrideStore[scopeKey]
                          : undefined;
                        const rawOv = scopedMap?.[name];
                        const hasOverride =
                          rawOv != null && Number.isFinite(rawOv);
                        const splitBadge = channelSplitBadgeLabel(
                          name,
                          data.channelRevenueSplits
                        );
                        const marginPctForColor =
                          agg.grossRevenue > 1e-9
                            ? (agg.profit / agg.grossRevenue) * 100
                            : null;
                        return (
                        <tr key={name} className="border-t border-zinc-800/80">
                          <td className="py-2 pr-4">
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                              <span className="font-medium text-zinc-200">
                                {name}
                              </span>
                              {splitBadge ? (
                                <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300 ring-1 ring-amber-500/25">
                                  {splitBadge}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="py-2 pr-4 text-right text-emerald-300/90">
                            {editingChannel === name ? (
                              <div className="flex flex-wrap items-center justify-end gap-1.5">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={editDraft}
                                  onChange={(e) => setEditDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveRevenueOverride();
                                    if (e.key === "Escape") {
                                      setEditingChannel(null);
                                      setEditDraft("");
                                    }
                                  }}
                                  className="w-28 rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-right text-sm text-zinc-100"
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  onClick={saveRevenueOverride}
                                  className="rounded bg-violet-600 px-2 py-1 text-xs text-white hover:bg-violet-500"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingChannel(null);
                                    setEditDraft("");
                                  }}
                                  className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1.5">
                                <span>{formatMoney(agg.grossRevenue, cur)}</span>
                                {hasOverride && (
                                  <span
                                    className="text-[10px] font-medium uppercase text-violet-400"
                                    title="Manual override"
                                  >
                                    adj
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingChannel(name);
                                    setEditDraft(agg.grossRevenue.toFixed(2));
                                  }}
                                  className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                                  title="Edit gross revenue (before split)"
                                >
                                  <PencilIcon className="h-4 w-4" />
                                </button>
                                {hasOverride && (
                                  <button
                                    type="button"
                                    onClick={() => clearRevenueOverride(name)}
                                    className="rounded p-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                                    title="Clear override"
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-right text-orange-200/80">
                            <div className="flex flex-col items-end gap-0.5">
                              <span>{formatMoney(agg.costsWithPartner, cur)}</span>
                              {agg.partnerRevenue != null &&
                                agg.partnerRevenue > 0 && (
                                  <span className="text-[10px] font-normal text-zinc-500">
                                    incl. partner{" "}
                                    {formatMoney(agg.partnerRevenue, cur)}
                                  </span>
                                )}
                            </div>
                          </td>
                          <td
                            className={`py-2 pr-4 text-right font-medium tabular-nums ${
                              agg.profit < 0
                                ? "text-red-400"
                                : marginPctForColor != null &&
                                    marginPctForColor >= 20
                                  ? "text-emerald-400"
                                  : "text-zinc-200"
                            }`}
                          >
                            {formatMoney(agg.profit, cur)}
                          </td>
                          <td className="py-2 pl-2 text-right align-middle">
                            <MarginBarCell
                              grossRevenue={agg.grossRevenue}
                              profit={agg.profit}
                            />
                          </td>
                        </tr>
                      );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

          </>
        )}
      </div>

      <dialog
        ref={customPeriodDialogRef}
        className="fixed left-1/2 top-1/2 z-[100] w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-700 bg-zinc-950 p-5 text-zinc-100 shadow-2xl [&::backdrop]:bg-black/70"
      >
        <h2 className="text-lg font-semibold text-zinc-100">Custom period</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Dates are <strong className="text-zinc-400">Pacific calendar</strong> (same as your finance sheet).
          <strong className="text-zinc-400"> This month</strong> = 1st through today (month-to-date). Other months
          use the full month unless it’s the current month.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
            onClick={() => {
              const r = thisPacificMonthMtd();
              setModalStart(r.start);
              setModalEnd(r.end);
            }}
          >
            This month (MTD)
          </button>
          <button
            type="button"
            className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
            onClick={() => {
              const r = previousPacificMonthRange();
              setModalStart(r.start);
              setModalEnd(r.end);
            }}
          >
            Last month
          </button>
        </div>

        <label className="mt-4 block text-xs font-medium text-zinc-400">
          Jump to month
          <select
            className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            value={
              monthChoices.find((c) => modalStart.startsWith(`${c.key}-`))?.key ??
              ""
            }
            onChange={(e) => {
              const o = monthChoices.find((c) => c.key === e.target.value);
              if (o) {
                const r = rangeForPacificMonth(o.y, o.m);
                setModalStart(r.start);
                setModalEnd(r.end);
              }
            }}
          >
            <option value="">Select…</option>
            {monthChoices.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-zinc-400">
            Start
            <input
              type="date"
              value={modalStart}
              onChange={(e) => setModalStart(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            End
            <input
              type="date"
              value={modalEnd}
              onChange={(e) => setModalEnd(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-zinc-800 pt-4">
          <button
            type="button"
            className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
            onClick={() => customPeriodDialogRef.current?.close()}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
            onClick={() => applyCustomPeriodFromModal()}
          >
            Apply
          </button>
        </div>
      </dialog>
    </main>
  );
}
