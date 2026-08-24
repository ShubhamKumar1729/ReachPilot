import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "playwright",
    "playwright-core",
    "pdfkit",
    "mongodb",
    "mongodb-memory-server",
    "mongodb-download-url",
  ],
};

export default nextConfig;
