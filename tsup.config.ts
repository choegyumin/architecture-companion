import { defineConfig } from "tsup";

import { dependencyCruiserBundleBanner, dependencyCruiserBundlingPlugin } from "./scripts/dependency-cruiser-bundling";

export default defineConfig({
  entry: {
    "diagram-generators/js-module-dependency-graph/generate":
      "src/plugins/diagram-generators/js-module-dependency-graph/generate.ts",
    serve: "src/cli/serve.ts",
    "validate-schemas": "src/cli/validate-schemas.ts",
    "view-annotations": "src/cli/view-annotations.ts",
    "view-generators": "src/cli/view-generators.ts",
  },
  banner: { js: dependencyCruiserBundleBanner },
  bundle: true,
  clean: true,
  esbuildPlugins: [dependencyCruiserBundlingPlugin],
  format: "esm",
  noExternal: [/.*/],
  outDir: "dist",
  platform: "node",
  sourcemap: false,
  splitting: false,
  target: "node22",
});
