"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { CategoryIcon } from "./icons";

export function MobileNav({ categories, links }: { categories: { name: string; slug: string; icon: string | null }[]; links: { label: string; href: string }[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    // Close the menu after navigating.
    setLastPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="grid size-10 place-items-center rounded-full text-fg hover:bg-surface-2 lg:hidden" aria-label="Open menu" aria-expanded={open}>
        <Menu className="size-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} aria-label="Close menu" />
          <nav className="absolute inset-y-0 left-0 flex w-[min(86vw,360px)] animate-fade-up flex-col overflow-y-auto border-r border-line bg-surface p-5">
            <div className="mb-6 flex items-center justify-between">
              <span className="eyebrow">Menu</span>
              <button type="button" onClick={() => setOpen(false)} className="grid size-9 place-items-center rounded-full hover:bg-surface-2" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            <ul className="space-y-1">
              {links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="block rounded-xl px-3 py-2.5 font-semibold hover:bg-surface-2">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="eyebrow mt-6 mb-2 px-3">Categories</p>
            <ul className="space-y-0.5">
              {categories.map((c) => (
                <li key={c.slug}>
                  <Link href={`/category/${c.slug}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-fg/90 hover:bg-surface-2">
                    <CategoryIcon name={c.icon} className="size-4 text-brand-300" />
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}
    </>
  );
}
