import { AlertTriangle, CheckCircle2, CircleDashed, HelpCircle, Loader2, ShieldAlert, XCircle } from "lucide-react";
import { SEVERITY_STYLE, VERDICT_SHORT, VERDICT_STYLE, VERDICT_TEXT } from "@/lib/verdict";
import type { ComponentStatus, JobStatus, Severity } from "@/lib/types";
import { cn } from "@/lib/utils";

const VERDICT_ICON = {
  none: CheckCircle2,
  possible: AlertTriangle,
  strong: ShieldAlert,
  inconclusive: HelpCircle,
  not_configured: CircleDashed,
};

export function VerdictBadge({ status, long, className }: { status: ComponentStatus | null | undefined; long?: boolean; className?: string }) {
  if (!status) return <span className="text-xs text-faint">—</span>;
  const s = VERDICT_STYLE[status];
  const Icon = VERDICT_ICON[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset", s.fg, s.bg, s.ring, className)}>
      <Icon className="size-3.5" aria-hidden />
      {long ? VERDICT_TEXT[status] : VERDICT_SHORT[status]}
    </span>
  );
}

export function SeverityBadge({ severity, synthetic }: { severity: Severity; synthetic?: boolean }) {
  const s = SEVERITY_STYLE[synthetic ? "synthetic" : severity];
  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide", s.fg, s.bg)}>
      {synthetic ? `${SEVERITY_STYLE[severity].label} · ML` : s.label}
    </span>
  );
}

export function JobStatusPill({ status, stage }: { status: JobStatus; stage?: string | null }) {
  const map: Record<JobStatus, { label: string; cls: string; Icon: typeof Loader2 }> = {
    queued: { label: "Queued", cls: "text-ink-soft bg-raised", Icon: CircleDashed },
    running: { label: "Running", cls: "text-accent-soft bg-accent/15", Icon: Loader2 },
    succeeded: { label: "Complete", cls: "text-ok bg-ok-bg", Icon: CheckCircle2 },
    failed: { label: "Failed", cls: "text-sev-high bg-sev-high-bg", Icon: XCircle },
    cancelled: { label: "Cancelled", cls: "text-muted bg-raised", Icon: XCircle },
  };
  const m = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] font-medium", m.cls)} title={stage ?? undefined}>
      <m.Icon className={cn("size-3.5", status === "running" && "animate-spin")} aria-hidden />
      {m.label}
    </span>
  );
}

export function ScoreBar({ value, tone }: { value: number; tone?: "high" | "medium" | "low" | "synthetic" }) {
  const color = { high: "bg-sev-high", medium: "bg-sev-medium", low: "bg-sev-low", synthetic: "bg-synthetic" }[tone ?? "medium"];
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-raised">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="tabular text-[11.5px] text-muted">{value.toFixed(2)}</span>
    </div>
  );
}
