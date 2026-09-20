import { defineConfig } from "tsup";

import {
  dependencyCruiserBundleBanner,
  dependencyCruiserBundlingPlugin,
} from "./src/plugins/diagram-generators/js-module-dependency-graph/tooling/dependency-cruiser-bundling";

export default defineConfig([
  {
    entry: {
      serve: "src/cli/serve.ts",
      "validate-schemas": "src/cli/validate-schemas.ts",
      "view-annotations": "src/cli/view-annotations.ts",
      "view-generators": "src/cli/view-generators.ts",
    },
    bundle: true,
    clean: false,
    format: "esm",
    noExternal: [/.*/],
    outDir: "dist",
    platform: "node",
    sourcemap: false,
    splitting: false,
    target: "node22",
  },
  {
    entry: {
      "diagram-generators/js-module-dependency-graph/generate":
        "src/plugins/diagram-generators/js-module-dependency-graph/generate.ts",
    },
    banner: { js: dependencyCruiserBundleBanner },
    bundle: true,
    clean: false,
    esbuildPlugins: [dependencyCruiserBundlingPlugin],
    format: "esm",
    noExternal: [/.*/],
    outDir: "dist",
    platform: "node",
    sourcemap: false,
    splitting: false,
    target: "node22",
  },
]);
