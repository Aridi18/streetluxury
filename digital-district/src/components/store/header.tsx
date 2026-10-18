import Link from "next/link";
import { Heart, ShoppingBag, User } from "lucide-react";
import { getSettings } from "@/lib/settings";
import { navCategories } from "@/lib/catalog";
import { cartItemCount } from "@/lib/cart";
import { getCurrentUser } from "@/lib/auth";
import { isStaffRole } from "@/lib/permissions";
import { Logo } from "./logo";
import { SearchBox } from "./search-box";
import { MobileNav } from "./mobile-nav";

export async function Header() {
  const [settings, categories, count, user] = await Promise.all([getSettings(), navCategories(), cartItemCount(), getCurrentUser()]);
  const topLevel = categories.filter((c) => !c.parentId || !categories.some((p) => p.id === c.parentId));
  const links = [
    { label: "Shop all", href: "/shop" },
    { label: "Offers", href: "/offers" },
    { label: "New arrivals", href: "/shop?sort=newest" },
    { label: "Track order", href: "/track" },
    { label: "FAQ", href: "/faq" },
    { label: "Contact", href: "/contact" },
  ];
  return (
    <header className="sticky top-0 z-50 border-b border-line/80 bg-canvas/85 backdrop-blur-xl">
      {settings.announcementEnabled && settings.announcement && (
        <div className="border-b border-line/60 bg-gradient-to-r from-brand-900/40 via-brand-700/30 to-brand-900/40 px-4 py-2 text-center text-xs font-medium text-brand-100">{settings.announcement}</div>
      )}
      <div className="container-page flex h-16 items-center gap-3 lg:h-[72px] lg:gap-6">
        <MobileNav categories={topLevel.map((c) => ({ name: c.name, slug: c.slug, icon: c.icon }))} links={links} />
        <Logo logoKey={settings.logoKey} storeName={settings.storeName} />
        <SearchBox className="hidden flex-1 md:block lg:max-w-xl" />
        <nav className="ml-auto flex items-center gap-1" aria-label="Account and cart">
          {user && isStaffRole(user.role) && (
            <Link href="/admin" className="hidden rounded-full border border-brand-500/40 px-3 py-1.5 text-xs font-semibold text-brand-200 hover:bg-brand-500/10 sm:inline-flex">
              Admin
            </Link>
          )}
          <Link href="/account/wishlist" className="hidden size-10 place-items-center rounded-full text-fg hover:bg-surface-2 sm:grid" aria-label="Wishlist">
            <Heart className="size-5" />
          </Link>
          <Link href={user ? "/account" : "/login"} className="grid size-10 place-items-center rounded-full text-fg hover:bg-surface-2" aria-label={user ? "My account" : "Sign in"}>
            <User className="size-5" />
          </Link>
          <Link href="/cart" className="relative grid size-10 place-items-center rounded-full text-fg hover:bg-surface-2" aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}>
            <ShoppingBag className="size-5" />
            {count > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-brand-500 px-1 text-[11px] font-bold text-white">{count > 99 ? "99+" : count}</span>}
          </Link>
        </nav>
      </div>
      <div className="container-page pb-3 md:hidden">
        <SearchBox />
      </div>
      <div className="hidden border-t border-line/60 lg:block">
        <nav className="container-page scrollbar-none flex h-11 items-center gap-1 overflow-x-auto text-sm" aria-label="Categories">
          <Link href="/shop" className="shrink-0 rounded-full px-3 py-1.5 font-semibold text-white hover:bg-surface-2">Shop all</Link>
          <Link href="/offers" className="shrink-0 rounded-full px-3 py-1.5 font-semibold text-brand-200 hover:bg-surface-2">Offers</Link>
          {topLevel.map((c) => (
            <Link key={c.id} href={`/category/${c.slug}`} className="shrink-0 rounded-full px-3 py-1.5 text-muted transition hover:bg-surface-2 hover:text-white">
              {c.name}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
