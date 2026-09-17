import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

import type { ConsumerScope } from "@/server/consumer-scope";
import { createApp } from "@/server/create-app";
import { createReviewUpdates } from "@/server/review-updates";

export type StartedServer = Readonly<{
  url: string;
  close: () => Promise<void>;
}>;

type StartServerOptions = Readonly<{
  hostname?: string;
  port?: number;
  staticRoot?: string | false;
}>;

export async function startServer(scope: ConsumerScope, options: StartServerOptions = {}): Promise<StartedServer> {
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

    server.once("error", (error) => {
      void reviewUpdates.close().finally(() => reject(error));
    });
  });
}
