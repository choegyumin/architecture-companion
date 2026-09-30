import { dirname, join } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

import {
  getDevelopmentServerStatePath,
  readRunningDevelopmentServer,
  waitForDevelopmentServer,
} from "./scripts/dev-server-state";

export default defineConfig(async ({ command, isPreview }) => {
  const backend = command === "serve" && !isPreview ? await waitForDevelopmentServer() : undefined;

  return {
    plugins: [react(), tailwindcss()],
    cacheDir: backend ? join(dirname(getDevelopmentServerStatePath()), "node_modules/.vite") : undefined,
    resolve: {
      alias: { "@": new URL("src", import.meta.url).pathname },
    },
    server: {
      host: "127.0.0.1",
      port: 4317,
      strictPort: false,
      watch: {
        ignored: ["**/.architecture-companion/**", "**/src/cli/**", "**/src/server/**", "**/*.test.{ts,tsx}"],
      },
      proxy: backend
        ? {
            "/api": {
              target: backend.url,
              changeOrigin: true,
              headers: { origin: backend.url },
              configure(_proxy, options) {
                options.bypass = async (_request, response) => {
                  const current = await readRunningDevelopmentServer();
                  if (!current) {
                    if (!response) return false;
                    response.writeHead(503);
                    response.end("Development server is restarting.");
                    return "/api";
                  }
                  options.target = current.url;
                  options.headers = { origin: current.url };
                };
              },
            } satisfies ProxyOptions,
          }
        : undefined,
    },
    build: {
      outDir: "skills/architecture-companion/runtime/client",
      sourcemap: true,
    },
  };
});
