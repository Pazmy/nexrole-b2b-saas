import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Allow verification builds to avoid caches owned by another Windows account.
  distDir: process.env.NEXT_BUILD_DIR || ".next",
};

export default nextConfig;
