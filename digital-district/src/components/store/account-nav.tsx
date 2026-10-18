"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../ui";

const LINKS = [
  { href: "/account", label: "Overview" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/downloads", label: "Digital library" },
  { href: "/account/wishlist", label: "Wishlist" },
  { href: "/account/addresses", label: "Addresses" },
  { href: "/account/support", label: "Support & returns" },
  { href: "/account/profile", label: "Profile" },
  { href: "/account/security", label: "Security" },
  { href: "/account/privacy", label: "Privacy" },
];

export function AccountNav() {
  const path = usePathname();
  return (
    <nav aria-label="Account" className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0">
      {LINKS.map((l) => {
        const active = l.href === "/account" ? path === l.href : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined} className={cn("shrink-0 rounded-xl px-3.5 py-2.5 text-sm font-medium transition", active ? "bg-brand-500/15 text-white" : "text-muted hover:bg-surface-2 hover:text-white")}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
