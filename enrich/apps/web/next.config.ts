import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Internal workspace packages ship TypeScript source.
  transpilePackages: ["@enrich/core", "@enrich/db", "@enrich/providers", "@enrich/shared"],
};

export default nextConfig;
