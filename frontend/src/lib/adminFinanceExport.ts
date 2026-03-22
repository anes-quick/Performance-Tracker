/**
 * Tab-separated export for pasting into Google Sheets or sharing with LLMs.
 * Uses dot decimals; escapes tabs/newlines in cells.
 */

/** Matches admin page channel aggregate after overrides + partner logic. */
export type ChannelAgg = {
  revenue: number;
  grossRevenue: number;
  partnerRevenue?: number;
  costs: number;
  costsWithPartner: number;
  profit: number;
};

export type AdjustedTotals = {
  grossRevenue: number;
  partnerRevenue: number;
  opsCosts: number;
  costsWithPartner: number;
  profit: number;
};

type FinancialsResponseLike = {
  revenueWindow?: {
    mode: "rolling" | "all" | "custom";
    days: number | null;
    startDate?: string;
    endDate?: string;
    reportingTimeZoneLabel?: string;
    includesTodayPacific?: boolean;
  };
};

type ComputedCostsLike = {
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

export type FinancialsExportSlice = {
  displayCurrency: "EUR" | "USD";
  eurPerUsd: number;
  revenueWindow?: FinancialsResponseLike["revenueWindow"];
  channelRevenueSplits?: Record<string, { yourPercent: number }>;
  computedCosts?: ComputedCostsLike | null;
  byChannel: Record<string, { revenue: number; costs: number; profit: number }>;
};

function tsvCell(raw: string): string {
  const s = String(raw);
  if (/[\t\n\r"]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(cells: (string | number)[]): string {
  return cells.map((c) => tsvCell(c === "" || c == null ? "" : String(c))).join("\t");
}

function num(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return "";
  return n.toFixed(decimals);
}

function usdToDisplay(
  usd: number,
  display: "EUR" | "USD",
  eurPerUsd: number
): number {
  if (display === "USD") return usd;
  return usd * eurPerUsd;
}

function normalizeName(s: string): string {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function yourPercentForChannel(
  channelName: string,
  splits: Record<string, { yourPercent: number }> | undefined
): number | null {
  if (!splits || Object.keys(splits).length === 0) return null;
  const n = normalizeName(channelName).toLowerCase();
  for (const [k, v] of Object.entries(splits)) {
    if (normalizeName(k).toLowerCase() === n) {
      const pct = typeof v.yourPercent === "number" ? v.yourPercent : 100;
      return Math.min(100, Math.max(0, pct));
    }
  }
  return null;
}

function revenueWindowLabel(w: FinancialsResponseLike["revenueWindow"]): string {
  if (!w) return "";
  if (w.mode === "all") return "all rows in sheet (no date filter)";
  if (w.mode === "custom" && w.startDate && w.endDate) {
    return `custom ${w.startDate} → ${w.endDate} (${w.reportingTimeZoneLabel ?? "Pacific"}), inclusive`;
  }
  if (w.mode === "rolling" && w.startDate && w.endDate) {
    return `last ${w.days ?? "?"}d: ${w.startDate} → ${w.endDate} (${w.reportingTimeZoneLabel ?? "Pacific"})${w.includesTodayPacific ? "; includes today Pacific" : "; ends yesterday Pacific"}`;
  }
  return `rolling ${w.days ?? "?"}d`;
}

export function buildAdminFinanceExportTsv(opts: {
  generatedAtIso: string;
  data: FinancialsExportSlice;
  adjustedTotals: AdjustedTotals;
  channelsSorted: [string, ChannelAgg][];
  scopeKey: string;
  overrideStore: Record<string, Record<string, number>>;
}): string {
  const {
    generatedAtIso,
    data,
    adjustedTotals,
    channelsSorted,
    scopeKey,
    overrideStore,
  } = opts;

  const cur = data.displayCurrency;
  const fx = data.eurPerUsd;
  const lines: string[] = [];

  lines.push(row(["Performance Tracker — admin finance export"]));
  lines.push(row([]));
  lines.push(row(["Meta", "Value"]));
  lines.push(row(["generated_at_iso", generatedAtIso]));
  lines.push(row(["amounts_display_currency", cur]));
  lines.push(row(["fx_eur_per_1_usd", num(fx, 4)]));
  lines.push(row(["revenue_window", revenueWindowLabel(data.revenueWindow)]));
  lines.push(row(["override_scope_key", scopeKey || ""]));

  lines.push(row([]));
  lines.push(row(["Summary (totals)", "Amount"]));
  lines.push(row(["total_revenue_gross", num(adjustedTotals.grossRevenue)]));
  lines.push(row(["ops_and_tools_costs", num(adjustedTotals.opsCosts)]));
  lines.push(row(["partner_share_as_cost", num(adjustedTotals.partnerRevenue)]));
  lines.push(row(["total_costs", num(adjustedTotals.costsWithPartner)]));
  lines.push(row(["profit", num(adjustedTotals.profit)]));

  lines.push(row([]));
  lines.push(
    row([
      "channel",
      "your_revenue_share_pct",
      "total_revenue_gross",
      "ops_costs",
      "partner_cost",
      "total_costs",
      "profit",
      "revenue_from_api_display",
      "manual_gross_override",
    ])
  );

  const scoped = scopeKey ? overrideStore[scopeKey] ?? {} : {};

  for (const [name, agg] of channelsSorted) {
    const apiRev = data.byChannel[name]?.revenue;
    const ovUsd = scoped[name];
    const hasOv = ovUsd != null && Number.isFinite(ovUsd);
    const yp = yourPercentForChannel(name, data.channelRevenueSplits);
    lines.push(
      row([
        name,
        yp != null ? num(yp, 0) : "",
        num(agg.grossRevenue),
        num(agg.costs),
        agg.partnerRevenue != null && agg.partnerRevenue > 0
          ? num(agg.partnerRevenue)
          : "",
        num(agg.costsWithPartner),
        num(agg.profit),
        apiRev != null && Number.isFinite(apiRev) ? num(apiRev) : "",
        hasOv ? "yes" : "",
      ])
    );
  }

  const cc = data.computedCosts;
  if (cc && Number.isFinite(fx) && fx > 0) {
    lines.push(row([]));
    lines.push(row(["Computed costs (basis USD, also shown in display currency)"]));
    lines.push(row(["period_days", String(cc.periodDays)]));
    lines.push(
      row([
        "assumption_editor_default_usd_per_video",
        String(cc.assumptions.editorUsdPerVideo),
      ])
    );
    lines.push(
      row([
        "assumption_va_usd_per_week",
        String(cc.assumptions.vaUsdPerWeek),
      ])
    );
    lines.push(
      row([
        "assumption_subscriptions_usd_per_month",
        String(cc.assumptions.subscriptionUsdPerMonth),
      ])
    );
    lines.push(
      row([
        "editor_excluded_channels",
        cc.assumptions.editorExcludeChannelNames.join("; "),
      ])
    );
    lines.push(
      row([
        "channel_editor_usd_per_video_overrides",
        Object.entries(cc.assumptions.channelEditorUsdPerVideo ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join("; "),
      ])
    );

    lines.push(row([]));
    lines.push(
      row([
        "channel",
        "uploads_in_window",
        "editor_cost_usd",
        `editor_cost_${cur.toLowerCase()}`,
      ])
    );
    for (const [ch, uploads] of Object.entries(cc.uploadsByChannel).sort(
      (a, b) => b[1] - a[1]
    )) {
      const edUsd = cc.editorByChannelUsd[ch] ?? 0;
      lines.push(
        row([
          ch,
          String(uploads),
          num(edUsd),
          num(usdToDisplay(edUsd, cur, fx)),
        ])
      );
    }
    lines.push(
      row([
        "editor_total",
        "",
        num(cc.editorTotalUsd),
        num(usdToDisplay(cc.editorTotalUsd, cur, fx)),
      ])
    );

    lines.push(row([]));
    lines.push(row(["line_item", "usd", cur.toLowerCase()]));
    lines.push(row(["va_prorated", num(cc.vaUsd), num(usdToDisplay(cc.vaUsd, cur, fx))]));
    lines.push(
      row([
        "subscriptions_prorated",
        num(cc.subscriptionUsd),
        num(usdToDisplay(cc.subscriptionUsd, cur, fx)),
      ])
    );
    lines.push(
      row([
        "shared_va_plus_subscriptions",
        num(cc.sharedTotalUsd),
        num(usdToDisplay(cc.sharedTotalUsd, cur, fx)),
      ])
    );
  }

  lines.push(row([]));
  lines.push(
    row([
      "Note",
      "Pasted from Performance Tracker /admin. Gross revenue = Studio total before split; partner % from config is in partner_cost and total_costs.",
    ])
  );

  return lines.join("\n");
}
