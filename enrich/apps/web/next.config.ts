import { loadRootEnvFile } from "@enrich/shared/env";
import type { NextConfig } from "next";

// Env lives in the monorepo root .env, not apps/web/.env.
loadRootEnvFile();

const nextConfig: NextConfig = {
  // Internal workspace packages ship TypeScript source.
  transpilePackages: ["@enrich/core", "@enrich/db", "@enrich/providers", "@enrich/shared"],
  serverExternalPackages: ["mysql2", "pino"],
};

export default nextConfig;
