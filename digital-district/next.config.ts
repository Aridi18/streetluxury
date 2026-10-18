import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  images: {
    localPatterns: [{ pathname: "/media/**" }],
    formats: ["image/avif", "image/webp"],
  },
  serverExternalPackages: ["sharp", "bcryptjs"],
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
