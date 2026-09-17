import { mkdtemp, rm } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeServeCommand } from "@/cli/serve.command";
import type { StartedServer } from "@/server/start-server";

async function getStatus(url: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.once("error", reject);
  });
}

describe("Architecture Companion server command", () => {
  it("requires exactly one explicit scope argument", async () => {
    const outputs: string[] = [];
    const options = { staticRoot: false as const, writeStdout: (output: string) => outputs.push(output) };

    await expect(executeServeCommand([], options)).rejects.toThrow("Usage:");
    await expect(executeServeCommand(["first", "second"], options)).rejects.toThrow("Usage:");
    expect(outputs).toEqual([]);
  });

  it("prints the URL once the dynamic loopback server is listening", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-serve-"));
    const outputs: string[] = [];
    let server: StartedServer | undefined;

    try {
      server = await executeServeCommand([scopePath], {
        staticRoot: false,
        writeStdout: (output) => outputs.push(output),
      });

      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(new URL(server.url).port).not.toBe("0");
      expect(outputs).toEqual([`${server.url}\n`]);
      expect(await getStatus(`${server.url}/api/review`)).toBe(200);
    } finally {
      await server?.close();
      await rm(scopePath, { recursive: true });
    }
  });
});
