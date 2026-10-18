import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getSettings } from "@/lib/settings";
import { env } from "@/lib/env";
import { publicFileUrl } from "@/lib/media";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  const logo = publicFileUrl(s.logoKey);
  return {
    metadataBase: new URL(env.appUrl),
    title: { default: s.seoTitle || s.storeName, template: `%s · ${s.storeName}` },
    description: s.seoDescription || s.heroSubtitle,
    applicationName: s.storeName,
    openGraph: { siteName: s.storeName, type: "website", locale: "en_US", ...(logo ? { images: [logo] } : {}) },
    twitter: { card: "summary_large_image" },
    icons: logo ? { icon: logo, apple: logo } : undefined,
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = { themeColor: "#0b0b0f", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
