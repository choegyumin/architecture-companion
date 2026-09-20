import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    serve: "src/cli/serve.ts",
    "validate-schemas": "src/cli/validate-schemas.ts",
    "view-annotations": "src/cli/view-annotations.ts",
    "view-generators": "src/cli/view-generators.ts",
  },
  bundle: true,
  clean: true,
  format: "esm",
  noExternal: [/.*/],
  outDir: "dist",
  platform: "node",
  sourcemap: false,
  splitting: false,
  target: "node22",
});
