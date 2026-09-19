import { defineConfig } from "tsup";

export default defineConfig({
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
