import { createServer, type ProxyOptions } from "vite";

import { getDevelopmentCacheDirectory, readRunningDevelopmentServer, waitForDevelopmentServer } from "./_dev-session";

async function startDevelopmentClient(): Promise<void> {
  const backend = await waitForDevelopmentServer();
  const vite = await createServer({
    cacheDir: getDevelopmentCacheDirectory(),
    server: {
      open: true,
      proxy: {
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
      },
    },
  });

  try {
    await vite.listen();
    vite.printUrls();
  } catch (error) {
    await vite.close();
    throw error;
  }
}

try {
  await startDevelopmentClient();
} catch (error) {
  const message = error instanceof Error ? error.message : "Architecture Companion development client failed to start.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
