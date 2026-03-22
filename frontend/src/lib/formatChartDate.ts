/**
 * Chart axis / tooltip: show day.month (e.g. 23.02) from sheet/API date strings.
 * Handles YYYY-MM-DD, ISO datetimes, and leaves unknown shapes unchanged.
 */
export function formatChartDateLabel(raw: string): string {
  const s = String(raw).trim();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (ymd) {
    const day = String(Number(ymd[3]));
    const month = ymd[2];
    return `${day}.${month}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const day = d.getUTCDate();
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${day}.${month}`;
  }
  return s;
}
