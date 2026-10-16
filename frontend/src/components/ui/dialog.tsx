import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] animate-fade-in" />
        <D.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line-strong bg-elevated p-6 shadow-2xl animate-fade-in",
            className,
          )}
        >
          <D.Title className="text-base font-semibold text-ink">{title}</D.Title>
          {description && <D.Description className="mt-1.5 text-sm leading-relaxed text-muted">{description}</D.Description>}
          <div className="mt-5">{children}</div>
          <D.Close className="absolute right-4 top-4 rounded-md p-1 text-muted hover:bg-raised hover:text-ink" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
