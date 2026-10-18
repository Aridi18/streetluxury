"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "../ui";

type Suggestions = { products: { title: string; slug: string; minPrice: number; isOnRequest: boolean }[]; categories: { name: string; slug: string }[] };

export function SearchBox({ className, autoFocus, defaultValue = "", large }: { className?: string; autoFocus?: boolean; defaultValue?: string; large?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [data, setData] = useState<Suggestions>({ products: [], categories: [] });
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setData({ products: [], categories: [] });
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (res.ok) setData(await res.json());
      } catch {
        // ignore aborted requests
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const items = [
    ...data.categories.map((c) => ({ label: c.name, hint: "Category", href: `/category/${c.slug}` })),
    ...data.products.map((p) => ({ label: p.title, hint: p.isOnRequest ? "On request" : `$${(p.minPrice / 100).toFixed(p.minPrice % 100 ? 2 : 0)}`, href: `/product/${p.slug}` })),
  ];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setOpen(false);
    if (active >= 0 && items[active]) router.push(items[active].href);
    else if (q.trim()) router.push(`/shop?q=${encodeURIComponent(q.trim())}`);
  }

  return (
    <div ref={box} className={cn("relative", className)}>
      <form role="search" onSubmit={submit}>
        <label htmlFor={`${listId}-input`} className="sr-only">Search products</label>
        <Search className={cn("pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle", large ? "size-5" : "size-4")} aria-hidden />
        <input
          id={`${listId}-input`}
          type="search"
          value={q}
          autoFocus={autoFocus}
          autoComplete="off"
          placeholder="Search Netflix, ChatGPT, Windows, accessories…"
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, -1));
            } else if (e.key === "Escape") setOpen(false);
          }}
          className={cn(
            "w-full rounded-full border border-line-strong bg-surface-2/80 pl-10 pr-4 text-fg placeholder:text-subtle transition focus:border-brand-400 focus:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-brand-500/25",
            large ? "h-14 pl-12 text-base" : "h-11 text-sm",
          )}
        />
      </form>
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-line-strong bg-surface-2 py-1.5 shadow-2xl">
          {items.map((it, i) => (
            <li key={it.href} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  setOpen(false);
                  router.push(it.href);
                }}
                className={cn("flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm", i === active ? "bg-surface-3 text-white" : "text-fg/90")}
              >
                <span className="truncate">{it.label}</span>
                <span className="shrink-0 text-xs text-subtle">{it.hint}</span>
              </button>
            </li>
          ))}
          <li className="border-t border-line px-4 pt-2 pb-1 text-xs text-subtle">Press Enter to see all results for “{q.trim()}”</li>
        </ul>
      )}
    </div>
  );
}
