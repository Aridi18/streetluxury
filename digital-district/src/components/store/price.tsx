import { formatMoney } from "@/lib/money";
import { cn } from "../ui";

export function Price({ amount, was, currency = "USD", from, className, size = "md" }: { amount: number | null; was?: number | null; currency?: string; from?: boolean; className?: string; size?: "sm" | "md" | "lg" }) {
  if (amount == null) return <span className={cn("font-semibold text-brand-200", className)}>On request</span>;
  const big = size === "lg" ? "text-3xl" : size === "sm" ? "text-sm" : "text-lg";
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2", className)}>
      {from && <span className="text-xs text-subtle">From</span>}
      <span className={cn("font-display font-semibold text-white", big)}>{formatMoney(amount, currency)}</span>
      {was != null && was > amount && <s className="text-sm text-subtle">{formatMoney(was, currency)}</s>}
    </span>
  );
}
