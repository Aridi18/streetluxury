// Business dates are interpreted in Lebanon time.
export const BUSINESS_TZ = "Asia/Beirut";

function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - at.getTime();
}

/** Midnight at the start of `ymd` (YYYY-MM-DD) in the business time zone, as a UTC Date. */
export function zonedMidnight(ymd: string, tz = BUSINESS_TZ): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let result = guess - tzOffsetMs(new Date(guess), tz);
  result = guess - tzOffsetMs(new Date(result), tz);
  return new Date(result);
}

/** YYYY-MM-DD of an instant in the business time zone. */
export function zonedYmd(at: Date, tz = BUSINESS_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export type PeriodPreset = "today" | "7d" | "30d" | "week" | "month" | "quarter" | "year" | "all" | "custom";

export type Period = { from: Date; to: Date; fromYmd: string; toYmd: string; preset: PeriodPreset; label: string };

/** Resolves a reporting period. `to` is exclusive (start of the day after the last included day). */
export function resolvePeriod(preset: PeriodPreset = "30d", customFrom?: string, customTo?: string, now = new Date()): Period {
  const today = zonedYmd(now);
  const [y, m] = today.split("-").map(Number);
  let fromYmd: string;
  let lastYmd = today;
  let label: string;
  switch (preset) {
    case "today":
      fromYmd = today;
      label = "Today";
      break;
    case "7d":
      fromYmd = addDaysYmd(today, -6);
      label = "Last 7 days";
      break;
    case "week": {
      const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
      fromYmd = addDaysYmd(today, -((dow + 6) % 7));
      label = "This week";
      break;
    }
    case "month":
      fromYmd = `${today.slice(0, 7)}-01`;
      label = "This month";
      break;
    case "quarter": {
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      fromYmd = `${y}-${String(qm).padStart(2, "0")}-01`;
      label = "This quarter";
      break;
    }
    case "year":
      fromYmd = `${y}-01-01`;
      label = "This year";
      break;
    case "all":
      fromYmd = "2020-01-01";
      label = "All time";
      break;
    case "custom": {
      const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
      fromYmd = valid(customFrom) ?? addDaysYmd(today, -29);
      lastYmd = valid(customTo) ?? today;
      if (lastYmd < fromYmd) [fromYmd, lastYmd] = [lastYmd, fromYmd];
      label = `${fromYmd} → ${lastYmd}`;
      break;
    }
    default:
      fromYmd = addDaysYmd(today, -29);
      label = "Last 30 days";
      preset = "30d";
  }
  return { from: zonedMidnight(fromYmd), to: zonedMidnight(addDaysYmd(lastYmd, 1)), fromYmd, toYmd: lastYmd, preset, label };
}
