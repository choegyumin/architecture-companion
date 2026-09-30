import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { resolveConsumerScope, resolveConsumerScopePath } from "@/server/resolve-consumer-scope";
import { startServer } from "@/server/start-server";

import { getDevelopmentCacheDirectory, readDevelopmentServerState, writeDevelopmentServerState } from "./_dev-session";

async function watchDevelopmentServer(): Promise<void> {
  const scopePath = await resolveConsumerScopePath(process.cwd());
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve("tsx/cli")),
      "watch",
      "--clear-screen=false",
      "--exclude",
      "src/client/**",
      "--exclude",
      "src/**/*.tsx",
      fileURLToPath(import.meta.url),
      scopePath,
    ],
    {
      stdio: "inherit",
      env: { ...process.env, DEVELOPMENT_SERVER_OWNER: String(process.pid) },
    },
  );

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => child.kill(signal));
  }

  const [code, signal] = await once(child, "close");
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
}

async function startDevelopmentServer(scopePath: string, ownerPid: number): Promise<void> {
  const scope = await resolveConsumerScope(scopePath);
  const previous = await readDevelopmentServerState();
  const port = previous?.ownerPid === ownerPid ? Number(new URL(previous.url).port) : 4318;
  const server = await startServer(scope, { port, fallbackPort: true, staticRoot: false });

  try {
    await writeDevelopmentServerState({ url: server.url, pid: process.pid, ownerPid });
  } catch (error) {
    await server.close();
    throw error;
  }

  process.stdout.write(`Hono API: ${server.url}\n`);
}

try {
  getDevelopmentCacheDirectory();
  const ownerPid = process.env.DEVELOPMENT_SERVER_OWNER;
  if (ownerPid === undefined) await watchDevelopmentServer();
  else await startDevelopmentServer(process.argv.at(2) ?? process.cwd(), Number(ownerPid));
} catch (error) {
  const message = error instanceof Error ? error.message : "Architecture Companion development server failed to start.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
