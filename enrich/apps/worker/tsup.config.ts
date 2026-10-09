import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  // Internal workspace packages ship TypeScript source, so bundle them in.
  noExternal: [/^@enrich\//],
});
