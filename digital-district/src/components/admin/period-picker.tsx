import Link from "next/link";
import type { Period } from "@/lib/time";
import { cn } from "../ui";

const PRESETS = [
  ["today", "Today"],
  ["7d", "7 days"],
  ["30d", "30 days"],
  ["month", "This month"],
  ["quarter", "Quarter"],
  ["year", "This year"],
  ["all", "All time"],
] as const;

/** Period selector (works without JavaScript): presets plus a custom date range. */
export function PeriodPicker({ period, basePath }: { period: Period; basePath: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
        {PRESETS.map(([key, label]) => (
          <Link key={key} href={`${basePath}?period=${key}`} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", period.preset === key ? "bg-brand-500 text-white" : "text-muted hover:text-white")}>
            {label}
          </Link>
        ))}
      </div>
      <form method="get" action={basePath} className="flex items-center gap-1.5 rounded-xl border border-line bg-surface p-1 text-xs">
        <input type="hidden" name="period" value="custom" />
        <input type="date" name="from" defaultValue={period.fromYmd} aria-label="From" className="rounded-lg bg-surface-2 px-2 py-1 text-fg [color-scheme:dark]" />
        <span className="text-subtle">→</span>
        <input type="date" name="to" defaultValue={period.toYmd} aria-label="To" className="rounded-lg bg-surface-2 px-2 py-1 text-fg [color-scheme:dark]" />
        <button className={cn("rounded-lg px-2.5 py-1 font-semibold", period.preset === "custom" ? "bg-brand-500 text-white" : "text-muted hover:text-white")}>Apply</button>
      </form>
    </div>
  );
}
