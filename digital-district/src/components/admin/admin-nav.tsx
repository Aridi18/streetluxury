"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3, Boxes, ClipboardList, FileText, Image as ImageIcon, LayoutDashboard, LifeBuoy, Megaphone, Menu, Package, Receipt, ScrollText,
  Settings, ShieldCheck, Star, Tags, Truck, UserCog, Users, Wallet, Warehouse, Layers, Mail, X, CreditCard,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";
import { cn } from "../ui";

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; perm: Permission };
const GROUPS: { title: string; items: Item[] }[] = [
  { title: "", items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard, perm: "dashboard.view" }] },
  {
    title: "Sales",
    items: [
      { href: "/admin/orders", label: "Orders", icon: Receipt, perm: "orders.view" },
      { href: "/admin/customers", label: "Customers", icon: Users, perm: "customers.view" },
      { href: "/admin/support", label: "Support requests", icon: LifeBuoy, perm: "support.manage" },
      { href: "/admin/reviews", label: "Reviews", icon: Star, perm: "reviews.moderate" },
    ],
  },
  {
    title: "Catalog",
    items: [
      { href: "/admin/products", label: "Products", icon: Package, perm: "products.manage" },
      { href: "/admin/categories", label: "Categories", icon: Layers, perm: "products.manage" },
      { href: "/admin/brands", label: "Brands & collections", icon: Tags, perm: "products.manage" },
      { href: "/admin/inventory", label: "Inventory", icon: Warehouse, perm: "inventory.manage" },
      { href: "/admin/purchases", label: "Suppliers & purchases", icon: Boxes, perm: "inventory.manage" },
      { href: "/admin/promotions", label: "Promotions & coupons", icon: Megaphone, perm: "promotions.manage" },
    ],
  },
  {
    title: "Finance",
    items: [
      { href: "/admin/reports", label: "Reports & profit", icon: BarChart3, perm: "finance.view" },
      { href: "/admin/expenses", label: "Expenses", icon: Wallet, perm: "expenses.manage" },
    ],
  },
  {
    title: "Website",
    items: [
      { href: "/admin/content", label: "Homepage & banners", icon: ImageIcon, perm: "content.manage" },
      { href: "/admin/pages", label: "Pages & FAQs", icon: FileText, perm: "content.manage" },
      { href: "/admin/newsletter", label: "Newsletter", icon: Mail, perm: "customers.export" },
    ],
  },
  {
    title: "Setup",
    items: [
      { href: "/admin/settings", label: "Store settings", icon: Settings, perm: "settings.manage" },
      { href: "/admin/payments", label: "Payment methods", icon: CreditCard, perm: "settings.manage" },
      { href: "/admin/shipping", label: "Delivery zones", icon: Truck, perm: "settings.manage" },
      { href: "/admin/staff", label: "Staff & roles", icon: UserCog, perm: "staff.manage" },
      { href: "/admin/audit", label: "Audit log", icon: ScrollText, perm: "audit.view" },
      { href: "/admin/emails", label: "Email log", icon: ClipboardList, perm: "settings.manage" },
      { href: "/admin/security", label: "My security", icon: ShieldCheck, perm: "dashboard.view" },
    ],
  },
];

export function AdminNav({ permissions }: { permissions: Permission[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const nav = (
    <nav className="space-y-5 pb-10" aria-label="Admin">
      {GROUPS.map((g) => {
        const items = g.items.filter((i) => permissions.includes(i.perm));
        if (!items.length) return null;
        return (
          <div key={g.title || "main"}>
            {g.title && <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">{g.title}</p>}
            <ul className="space-y-0.5">
              {items.map((i) => {
                const active = i.href === "/admin" ? path === "/admin" : path.startsWith(i.href);
                const Icon = i.icon;
                return (
                  <li key={i.href}>
                    <Link href={i.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition", active ? "bg-brand-500/15 font-semibold text-white" : "text-muted hover:bg-surface-2 hover:text-white")}>
                      <Icon className={cn("size-4", active ? "text-brand-300" : "")} />
                      {i.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="grid size-10 place-items-center rounded-lg hover:bg-surface-2 lg:hidden" aria-label="Open admin menu"><Menu className="size-5" /></button>
      <aside className="print:hidden fixed bottom-0 left-0 top-16 hidden w-60 overflow-y-auto border-r border-line bg-ink px-3 pt-5 lg:block">{nav}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} aria-label="Close menu" />
          <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-line bg-ink px-3 pt-4">
            <button type="button" onClick={() => setOpen(false)} className="mb-4 ml-auto grid size-9 place-items-center rounded-lg hover:bg-surface-2" aria-label="Close menu"><X className="size-5" /></button>
            {nav}
          </div>
        </div>
      )}
    </>
  );
}
