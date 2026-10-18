export const dynamic = "force-dynamic";

import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/account", "/cart", "/checkout", "/order/", "/api/", "/invite/", "/reset-password/"] }],
    sitemap: `${env.appUrl}/sitemap.xml`,
  };
}
