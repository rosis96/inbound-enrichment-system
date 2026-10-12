import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  // Internal workspace packages ship TypeScript source, so bundle them in.
  noExternal: [/^@enrich\//],
  // Their CommonJS dependencies (mysql2) get bundled too and call require() for Node built-ins, which ESM lacks.
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
