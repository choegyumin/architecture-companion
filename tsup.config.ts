import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig, type Options } from "tsup";

import {
  dependencyCruiserBundleBanner,
  dependencyCruiserBundlingPlugin,
} from "./src/plugins/diagram-generators/js-module-dependency-graph/packaging/dependency-cruiser-bundling";
import { nodeBundleBanner } from "./src/plugins/diagram-generators/react-component-structure/packaging/node-bundling";

const nodeBundleOptions = {
  bundle: true,
  clean: false,
  format: "esm",
  noExternal: [/.*/],
  outDir: "skills/architecture-companion",
  platform: "node",
  sourcemap: false,
  splitting: false,
  target: "node22",
} satisfies Options;

const cliDirectory = fileURLToPath(new URL("./src/cli", import.meta.url));

// CLI entries are the src/cli files whose basename has no additional dot (serve.ts),
// unlike their implementations (serve.command.ts).
const cliEntries = Object.fromEntries(
  readdirSync(cliDirectory)
    .filter((file) => /^[^.]+\.ts$/.test(file))
    .map((file) => [`runtime/cli/${file.replace(/\.ts$/, "")}`, `src/cli/${file}`]),
);

export default defineConfig([
  {
    ...nodeBundleOptions,
    entry: cliEntries,
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
      "runtime/diagram-generators/js-module-dependency-graph/run":
        "src/plugins/diagram-generators/js-module-dependency-graph/run.ts",
    },
    banner: { js: dependencyCruiserBundleBanner },
    esbuildPlugins: [dependencyCruiserBundlingPlugin],
  },
  {
    ...nodeBundleOptions,
    entry: {
      "runtime/diagram-generators/react-component-structure/run":
        "src/plugins/diagram-generators/react-component-structure/run.ts",
    },
    banner: { js: nodeBundleBanner },
  },
]);
