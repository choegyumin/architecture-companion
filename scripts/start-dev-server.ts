import { resolveConsumerScope } from "@/server/resolve-consumer-scope";
import { startServer } from "@/server/start-server";

import { readDevelopmentServerState, writeDevelopmentServerState } from "./dev-server-state";

async function startDevelopmentServer(args: readonly string[]): Promise<void> {
  const scope = await resolveConsumerScope(args.at(0) ?? process.cwd());
  const ownerPid = Number(process.env.ARCHITECTURE_COMPANION_DEV_SERVER_OWNER ?? process.pid);
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
  await startDevelopmentServer(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : "Architecture Companion Hono server failed to start.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
