import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...p }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-raised px-2 py-0.5 text-[11.5px] font-medium text-ink-soft",
        className,
      )}
      {...p}
    />
  );
}
