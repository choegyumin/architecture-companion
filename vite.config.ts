import { posix, relative } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import micromatch from "micromatch";
import { defineConfig, normalizePath } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

const ignoredFiles = ["**/*.{spec,test}.{js,cjs,mjs,jsx,ts,cts,mts,tsx}"];
const watchedPaths = [
  "src/{client,features,shared}/**",
  "public/**",
  "index.html",
  "tsconfig.json",
  "vite.config.ts",
  "package.json",
  "pnpm-lock.yaml",
  ".env{,.*}",
];
const watchedPatterns = [
  ...new Set(
    watchedPaths.flatMap((pattern) =>
      micromatch.braces(pattern, { expand: true }).flatMap((path) => {
        const paths = [path];
        for (let parent = posix.dirname(path); parent !== "."; parent = posix.dirname(parent)) {
          paths.push(parent);
        }
        paths.push(".");
        return paths;
      }),
    ),
  ),
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": new URL("src", import.meta.url).pathname },
  },
  server: {
    host: "127.0.0.1",
    port: 4317,
    strictPort: false,
    watch: {
      ignored(file) {
        const path = normalizePath(relative(root, file));
        return (
          micromatch.isMatch(path, ignoredFiles, { dot: true }) ||
          !micromatch.isMatch(path, watchedPatterns, { dot: true })
        );
      },
    },
  },
  build: {
    outDir: "skills/architecture-companion/runtime/client",
    sourcemap: true,
  },
});
