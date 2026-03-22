/**
 * Pacific calendar helpers for /admin custom periods (same “day” as sheet + Studio).
 */

export const PACIFIC_TZ = "America/Los_Angeles";

export function pacificTodayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: PACIFIC_TZ });
}

export function startOfMonthIsoFromYmd(ymd: string): string {
  const [y, m] = ymd.split("-");
  return `${y}-${m}-01`;
}

/** Last calendar day of month (1–12), Gregorian, as YYYY-MM-DD (UTC date math; used for month boundaries only). */
export function lastDayOfMonthIso(y: number, month1to12: number): string {
  const d = new Date(Date.UTC(y, month1to12, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export type MonthOption = { key: string; label: string; y: number; m: number };

function monthYearLabel(y: number, m: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 15)));
}

/** Most recent `count` Pacific calendar months (current month first). */
export function pacificMonthOptions(countMonths: number): MonthOption[] {
  const today = pacificTodayIso();
  const [cy, cm] = today.split("-").map((x) => parseInt(x, 10));
  const out: MonthOption[] = [];
  let y = cy;
  let m = cm;
  for (let i = 0; i < countMonths; i++) {
    out.push({
      key: `${y}-${String(m).padStart(2, "0")}`,
      label: monthYearLabel(y, m),
      y,
      m,
    });
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** This Pacific month, month-to-date: 1st → today (Pacific). */
export function thisPacificMonthMtd(): { start: string; end: string } {
  const end = pacificTodayIso();
  return { start: startOfMonthIsoFromYmd(end), end };
}

/** Full previous Pacific calendar month. */
export function previousPacificMonthRange(): { start: string; end: string } {
  const today = pacificTodayIso();
  const [cy, cm] = today.split("-").map((x) => parseInt(x, 10));
  const prevM = cm === 1 ? 12 : cm - 1;
  const prevY = cm === 1 ? cy - 1 : cy;
  return {
    start: `${prevY}-${String(prevM).padStart(2, "0")}-01`,
    end: lastDayOfMonthIso(prevY, prevM),
  };
}

/**
 * Range for a given Pacific calendar month: if it is the current Pacific month,
 * end is today (MTD); otherwise end is the last day of that month.
 */
export function rangeForPacificMonth(y: number, m: number): { start: string; end: string } {
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const today = pacificTodayIso();
  const [ty, tm] = today.split("-").map((x) => parseInt(x, 10));
  if (y === ty && m === tm) {
    return { start, end: today };
  }
  return { start, end: lastDayOfMonthIso(y, m) };
}
