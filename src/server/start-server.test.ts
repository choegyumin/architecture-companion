import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type StartedServer, startServer } from "@/server/start-server";

async function getText(url: string): Promise<Readonly<{ status: number | undefined; body: string }>> {
  return new Promise((resolve, reject) => {
    const request = get(url, async (response) => {
      try {
        const chunks = await Array.fromAsync(response);
        resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") });
      } catch (error) {
        reject(error);
      }
    });

    request.once("error", reject);
  });
}

describe("server startup", () => {
  it("serves the review RPC and built client files on a loopback address", async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), "architecture-companion-client-"));
    let server: StartedServer | undefined;

    try {
      await writeFile(join(staticRoot, "index.html"), "<h1>Architecture Companion</h1>");
      server = await startServer(
        { path: "/consumer", isGitRepository: false },
        { hostname: "127.0.0.1", port: 0, staticRoot },
      );

      const reviewResponse = await getText(`${server.url}/api/review`);
      const pageResponse = await getText(server.url);

      expect(reviewResponse.status).toBe(200);
      expect(JSON.parse(reviewResponse.body)).toEqual({
        scope: { path: "/consumer", isGitRepository: false },
        artifact: null,
      });
      expect(pageResponse.body).toContain("Architecture Companion");
    } finally {
      await server?.close();
      await rm(staticRoot, { recursive: true });
    }
  });

  it("fails to start on a port already in use", async () => {
    let server: StartedServer | undefined;

    try {
      server = await startServer(
        { path: "/consumer", isGitRepository: false },
        { hostname: "127.0.0.1", port: 0, staticRoot: false },
      );
      const port = Number(new URL(server.url).port);

      await expect(
        startServer({ path: "/consumer", isGitRepository: false }, { hostname: "127.0.0.1", port, staticRoot: false }),
      ).rejects.toMatchObject({ code: "EADDRINUSE" });
    } finally {
      await server?.close();
    }
  });
});
