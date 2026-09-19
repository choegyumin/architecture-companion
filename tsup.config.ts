import { fileURLToPath } from "node:url";

import { defineConfig } from "tsup";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  entry: {
    "diagram-generators/file-dependency-graph/generate": "src/cli/generate-file-dependency-graph.ts",
    serve: "src/cli/serve.ts",
    "validate-schemas": "src/cli/validate-schemas.ts",
    "view-annotations": "src/cli/view-annotations.ts",
    "view-generators": "src/cli/view-generators.ts",
  },
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; import { fileURLToPath as __fileURLToPath } from "node:url"; import { dirname as __pathDirname } from "node:path"; globalThis.require = __createRequire(import.meta.url); globalThis.__filename = __fileURLToPath(import.meta.url); globalThis.__dirname = __pathDirname(globalThis.__filename);',
  },
  bundle: true,
  clean: true,
  esbuildPlugins: [
    {
      name: "bundle-dependency-cruiser-typescript",
      setup(build) {
        build.onResolve({ filter: /^#utl\/try-import\.mjs$/ }, () => ({
          path: "dependency-cruiser-try-import",
          namespace: "architecture-companion",
        }));
        build.onResolve({ filter: /^#report\/index\.mjs$/ }, () => ({
          path: "dependency-cruiser-reporters",
          namespace: "architecture-companion",
        }));
        build.onResolve({ filter: /^\.\/try-import-available\.mjs$/ }, (args) => {
          if (!args.importer.endsWith("/dependency-cruiser/src/extract/transpile/meta.mjs")) return;
          return {
            path: "dependency-cruiser-try-import-available",
            namespace: "architecture-companion",
          };
        });
        build.onResolve({ filter: /^\.\/javascript-wrap\.mjs$/ }, (args) => {
          if (!args.importer.endsWith("/dependency-cruiser/src/extract/transpile/meta.mjs")) return;
          return {
            path: "dependency-cruiser-javascript-wrap",
            namespace: "architecture-companion",
          };
        });
        build.onResolve({ filter: /^enhanced-resolve\/lib\/createInnerCallback$/ }, () => ({
          path: "enhanced-resolve-create-inner-callback",
          namespace: "architecture-companion",
        }));
        build.onResolve({ filter: /^json5$/ }, () => ({
          path: "json5",
          namespace: "architecture-companion",
        }));
        build.onLoad({ filter: /^dependency-cruiser-try-import$/, namespace: "architecture-companion" }, () => ({
          contents: `import typescript from "typescript";
export default async function tryImport(moduleName) {
  return moduleName === "typescript" ? typescript : false;
}
`,
          loader: "js",
          resolveDir: packageRoot,
        }));
        build.onLoad({ filter: /^dependency-cruiser-reporters$/, namespace: "architecture-companion" }, () => ({
          contents: `export function getAvailableReporters() {
  return [];
}
export async function getReporter() {
  return (result) => ({ output: result, exitCode: 0 });
}
`,
          loader: "js",
        }));
        build.onLoad(
          { filter: /^dependency-cruiser-try-import-available$/, namespace: "architecture-companion" },
          () => ({
            contents: `export default function tryImportAvailable(moduleName) {
  return moduleName === "typescript";
}
`,
            loader: "js",
          }),
        );
        build.onLoad({ filter: /^dependency-cruiser-javascript-wrap$/, namespace: "architecture-companion" }, () => ({
          contents: `export default {
  isAvailable: () => true,
  version: () => "acorn@bundled",
  transpile: (source) => source,
};
`,
          loader: "js",
        }));
        build.onLoad(
          { filter: /^enhanced-resolve-create-inner-callback$/, namespace: "architecture-companion" },
          () => ({
            contents: "module.exports = (callback) => callback;\n",
            loader: "js",
          }),
        );
        build.onLoad({ filter: /^json5$/, namespace: "architecture-companion" }, () => ({
          contents: `import typescript from "typescript";
export function parse(text) {
  const result = typescript.parseConfigFileTextToJson("tsconfig.json", text);
  if (result.error) {
    throw new Error(typescript.flattenDiagnosticMessageText(result.error.messageText, "\\n"));
  }
  return result.config;
}
export function stringify(value, replacer, space) {
  return JSON.stringify(value, replacer, space);
}
export default { parse, stringify };
`,
          loader: "js",
          resolveDir: packageRoot,
        }));
      },
    },
  ],
  format: "esm",
  noExternal: [/.*/],
  outDir: "dist",
  platform: "node",
  sourcemap: false,
  splitting: false,
  target: "node22",
});
