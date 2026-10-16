import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-accent-soft", className)} aria-hidden />;
}

export function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-3 text-sm text-muted">
      <Spinner /> {label}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[14px] border border-dashed border-line-strong px-6 py-14 text-center">
      {icon && <div className="mb-4 rounded-xl bg-raised p-3 text-accent-soft [&_svg]:size-6">{icon}</div>}
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children && <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn("rounded-lg border border-sev-high/30 bg-sev-high-bg px-4 py-3 text-sm text-sev-high", className)}>
      {children}
    </div>
  );
}

export function KV({ k, v, mono }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/70 py-2 text-[13px] last:border-0">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className={cn("min-w-0 text-right text-ink-soft", mono && "break-all font-mono text-[12px]")}>{v}</dd>
    </div>
  );
}

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {children && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{children}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
