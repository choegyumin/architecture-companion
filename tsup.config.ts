import { defineConfig, type Options } from "tsup";

import {
  dependencyCruiserBundleBanner,
  dependencyCruiserBundlingPlugin,
} from "./src/plugins/diagram-generators/js-module-dependency-graph/tooling/dependency-cruiser-bundling";

const nodeBundleOptions = {
  bundle: true,
  clean: false,
  format: "esm",
  noExternal: [/.*/],
  outDir: "dist",
  platform: "node",
  sourcemap: false,
  splitting: false,
  target: "node22",
} satisfies Options;

export default defineConfig([
  {
    ...nodeBundleOptions,
    entry: {
      serve: "src/cli/serve.ts",
      "validate-schemas": "src/cli/validate-schemas.ts",
      "view-annotations": "src/cli/view-annotations.ts",
      "view-generators": "src/cli/view-generators.ts",
      "diagram-generators/react-component-structure/cli/run":
        "src/plugins/diagram-generators/react-component-structure/cli/run.ts",
    },
    banner: {
      js: [
        'import { createRequire as __createRequire } from "node:module";',
        'import { dirname as __pathDirname } from "node:path";',
        'import { fileURLToPath as __fileURLToPath } from "node:url";',
        "const require = __createRequire(import.meta.url);",
        "const __filename = __fileURLToPath(import.meta.url);",
        "const __dirname = __pathDirname(__filename);",
      ].join("\n"),
    },
  },
  {
    ...nodeBundleOptions,
    entry: {
      "diagram-generators/js-module-dependency-graph/generate":
        "src/plugins/diagram-generators/js-module-dependency-graph/generate.ts",
    },
    banner: { js: dependencyCruiserBundleBanner },
    esbuildPlugins: [dependencyCruiserBundlingPlugin],
  },
]);
