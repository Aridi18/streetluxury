import Link from "next/link";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { navCategories } from "@/lib/catalog";
import { waLink } from "@/lib/whatsapp";
import { Logo } from "./logo";
import { FacebookIcon, InstagramIcon, TikTokIcon, WhatsAppIcon } from "./icons";

export async function Footer() {
  const [s, categories, pages] = await Promise.all([
    getSettings(),
    navCategories(),
    db.page.findMany({ where: { isPublished: true, showInFooter: true }, select: { slug: true, title: true }, orderBy: { title: "asc" } }),
  ]);
  const top = categories.filter((c) => !c.parentId).slice(0, 8);
  const socials = [
    s.instagramUrl && { href: s.instagramUrl, label: "Instagram", Icon: InstagramIcon },
    s.facebookUrl && { href: s.facebookUrl, label: "Facebook", Icon: FacebookIcon },
    s.tiktokUrl && { href: s.tiktokUrl, label: "TikTok", Icon: TikTokIcon },
  ].filter(Boolean) as { href: string; label: string; Icon: typeof InstagramIcon }[];
  return (
    <footer className="mt-24 border-t border-line bg-ink">
      <div className="hairline" />
      <div className="container-page grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <div className="space-y-4">
          <Logo logoKey={s.logoKey} storeName={s.storeName} size="lg" />
          <p className="eyebrow">{s.tagline}</p>
          <p className="max-w-xs text-sm text-muted">Premium digital subscriptions, software licences and more — delivered fast and backed by real human support.</p>
          <a href={waLink(s.whatsappNumber, s.whatsappDefaultMessage)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-2 text-sm font-semibold text-[#05290f] hover:bg-[#3ee07b]">
            <WhatsAppIcon className="size-4" /> Order on WhatsApp
          </a>
          {socials.length > 0 && (
            <div className="flex gap-2 pt-1">
              {socials.map(({ href, label, Icon }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className="grid size-9 place-items-center rounded-full border border-line-strong text-muted hover:border-brand-400 hover:text-white">
                  <Icon className="size-4" />
                </a>
              ))}
            </div>
          )}
        </div>
        <div>
          <h2 className="mb-4 text-sm font-semibold text-white">Shop</h2>
          <ul className="space-y-2.5 text-sm text-muted">
            <li><Link href="/shop" className="hover:text-white">All products</Link></li>
            <li><Link href="/offers" className="hover:text-white">Offers</Link></li>
            {top.map((c) => (
              <li key={c.id}><Link href={`/category/${c.slug}`} className="hover:text-white">{c.name}</Link></li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-4 text-sm font-semibold text-white">Help & company</h2>
          <ul className="space-y-2.5 text-sm text-muted">
            <li><Link href="/track" className="hover:text-white">Track your order</Link></li>
            <li><Link href="/faq" className="hover:text-white">FAQ</Link></li>
            <li><Link href="/contact" className="hover:text-white">Contact</Link></li>
            {pages.map((p) => (
              <li key={p.slug}><Link href={`/${p.slug}`} className="hover:text-white">{p.title}</Link></li>
            ))}
            {s.footerLinks.map((l) => (
              <li key={l.href}><a href={l.href} className="hover:text-white">{l.label}</a></li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-4 text-sm font-semibold text-white">Contact</h2>
          <ul className="space-y-3 text-sm text-muted">
            <li className="flex gap-2.5"><WhatsAppIcon className="mt-0.5 size-4 shrink-0 text-[#25D366]" /><a href={waLink(s.whatsappNumber)} className="hover:text-white">{s.phoneDisplay}</a></li>
            <li className="flex gap-2.5"><Phone className="mt-0.5 size-4 shrink-0 text-brand-300" /><a href={`tel:+${s.whatsappNumber}`} className="hover:text-white">{s.phoneDisplay}</a></li>
            {s.supportEmail && <li className="flex gap-2.5"><Mail className="mt-0.5 size-4 shrink-0 text-brand-300" /><a href={`mailto:${s.supportEmail}`} className="break-all hover:text-white">{s.supportEmail}</a></li>}
            {s.supportHours && <li className="flex gap-2.5"><Clock className="mt-0.5 size-4 shrink-0 text-brand-300" />{s.supportHours}</li>}
            {s.address && <li className="flex gap-2.5"><MapPin className="mt-0.5 size-4 shrink-0 text-brand-300" />{s.address}</li>}
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="container-page flex flex-col gap-2 py-5 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {s.storeName}. All rights reserved.</p>
          <p>{s.domain}</p>
        </div>
      </div>
    </footer>
  );
}
