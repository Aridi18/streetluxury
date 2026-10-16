import { forwardRef, type InputHTMLAttributes, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-10 w-full rounded-lg border border-line-strong bg-elevated px-3 text-sm text-ink placeholder:text-faint transition-colors focus:border-accent-soft focus:outline-none disabled:opacity-50",
      className,
    )}
    {...p}
  />
));
Input.displayName = "Input";

export function Label({ className, ...p }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-[13px] font-medium text-ink-soft", className)} {...p} />;
}

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-10 w-full rounded-lg border border-line-strong bg-elevated px-3 text-sm text-ink focus:border-accent-soft focus:outline-none",
      className,
    )}
    {...p}
  />
));
Select.displayName = "Select";
