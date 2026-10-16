import * as T from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;

export function TabsList({ className, ...p }: ComponentProps<typeof T.List>) {
  return <T.List className={cn("flex gap-1 overflow-x-auto border-b border-line", className)} {...p} />;
}

export function TabsTrigger({ className, ...p }: ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "relative -mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-[13px] font-medium text-muted transition-colors hover:text-ink data-[state=active]:border-accent data-[state=active]:text-ink",
        className,
      )}
      {...p}
    />
  );
}

export function TabsContent({ className, ...p }: ComponentProps<typeof T.Content>) {
  return <T.Content className={cn("pt-5 focus:outline-none", className)} {...p} />;
}
