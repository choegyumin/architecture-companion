import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "tsup";

import { dependencyCruiserBundleBanner, dependencyCruiserBundlingPlugin } from "./dependency-cruiser-bundling";

const packageRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const pluginRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  entry: {
    "diagram-generators/js-module-dependency-graph/generate": join(pluginRoot, "generate.ts"),
  },
  banner: { js: dependencyCruiserBundleBanner },
  bundle: true,
  clean: false,
  esbuildPlugins: [dependencyCruiserBundlingPlugin],
  format: "esm",
  noExternal: [/.*/],
  outDir: join(packageRoot, "dist"),
  platform: "node",
  sourcemap: false,
  splitting: false,
  target: "node22",
});
