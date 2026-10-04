import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

import type { CompanionScope } from "@/server/companion-scope";
import { createApp } from "@/server/create-app";
import { createReviewUpdates } from "@/server/review-updates";

export type StartedServer = Readonly<{
  url: string;
  close: () => Promise<void>;
}>;

type StartServerOptions = Readonly<{
  hostname?: string;
  port?: number;
  fallbackPort?: boolean;
  staticRoot?: string | false;
}>;

export async function startServer(scope: CompanionScope, options: StartServerOptions = {}): Promise<StartedServer> {
  const hostname = options.hostname ?? "127.0.0.1";
  const port = options.port ?? 4318;
  const staticRoot =
    options.staticRoot === false ? null : (options.staticRoot ?? fileURLToPath(new URL("./client", import.meta.url)));
  const reviewUpdates = await createReviewUpdates(scope.path);
  const app = createApp(scope, { reviewUpdates });

  if (staticRoot !== null) app.use("*", serveStatic({ root: staticRoot }));

  return new Promise((resolve, reject) => {
    const server = serve(
      {
        fetch: app.fetch,
        hostname,
        port,
      },
      (address) => {
        resolve({
          url: `http://${hostname}:${address.port}`,
          close: async () => {
            const closeServer = new Promise<void>((closeResolve, closeReject) => {
              server.close((error) => {
                if (error) closeReject(error);
                else closeResolve();
              });
              if ("closeAllConnections" in server && typeof server.closeAllConnections === "function") {
                server.closeAllConnections();
              }
            });

            await Promise.all([closeServer, reviewUpdates.close()]);
          },
        });
      },
    );

    const rejectStartup = (error: Error): void => {
      void reviewUpdates.close().then(() => reject(error), reject);
    };

    server.once("error", (error) => {
      if (options.fallbackPort && "code" in error && error.code === "EADDRINUSE") {
        server.once("error", rejectStartup);
        server.listen(0, hostname);
        return;
      }
      rejectStartup(error);
    });
  });
}
