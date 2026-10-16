import { cn } from "@/lib/utils";

export function Progress({ value, className, tone = "accent" }: { value: number; className?: string; tone?: "accent" | "high" | "medium" | "ok" | "synthetic" }) {
  const toneClass = { accent: "bg-accent", high: "bg-sev-high", medium: "bg-sev-medium", ok: "bg-ok", synthetic: "bg-synthetic" }[tone];
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-raised", className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", toneClass)} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}
