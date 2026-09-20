import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Options } from "tsup";

const expectedDependencyCruiserVersion = "18.3.1";
const packageRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const dependencyCruiserManifest = JSON.parse(
  readFileSync(join(packageRoot, "node_modules", "dependency-cruiser", "package.json"), "utf8"),
) as Readonly<{ version?: unknown }>;

if (dependencyCruiserManifest.version !== expectedDependencyCruiserVersion) {
  throw new Error(
    `The standalone generator bundling adapter supports dependency-cruiser ${expectedDependencyCruiserVersion}, received ${String(dependencyCruiserManifest.version)}. Review its private imports before updating the version.`,
  );
}

export const dependencyCruiserBundleBanner =
  'import { createRequire as __createRequire } from "node:module"; import { fileURLToPath as __fileURLToPath } from "node:url"; import { dirname as __pathDirname } from "node:path"; globalThis.require = __createRequire(import.meta.url); globalThis.__filename = __fileURLToPath(import.meta.url); globalThis.__dirname = __pathDirname(globalThis.__filename);';

// dependency-cruiser discovers optional parsers and reporters dynamically. The installed
// Architecture Companion distribution has no node_modules, so the generator bundle replaces
// those private discovery seams with its supported JavaScript/TypeScript-only runtime.
export const dependencyCruiserBundlingPlugin = {
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
    build.onLoad({ filter: /^dependency-cruiser-try-import-available$/, namespace: "architecture-companion" }, () => ({
      contents: `export default function tryImportAvailable(moduleName) {
  return moduleName === "typescript";
}
`,
      loader: "js",
    }));
    build.onLoad({ filter: /^dependency-cruiser-javascript-wrap$/, namespace: "architecture-companion" }, () => ({
      contents: `export default {
  isAvailable: () => true,
  version: () => "acorn@bundled",
  transpile: (source) => source,
};
`,
      loader: "js",
    }));
    build.onLoad({ filter: /^enhanced-resolve-create-inner-callback$/, namespace: "architecture-companion" }, () => ({
      contents: "module.exports = (callback) => callback;\n",
      loader: "js",
    }));
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
} satisfies NonNullable<Options["esbuildPlugins"]>[number];
