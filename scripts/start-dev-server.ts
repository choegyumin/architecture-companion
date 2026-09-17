import { resolveConsumerScope } from "@/server/resolve-consumer-scope";
import { startServer } from "@/server/start-server";

async function startDevelopmentServer(args: readonly string[]): Promise<void> {
  if (args.length > 1) throw new Error("Usage: pnpm dev:server -- [directory]");

  const scope = await resolveConsumerScope(args.at(0) ?? process.cwd());
  const server = await startServer(scope, { staticRoot: false });
  process.stdout.write(`Hono API: ${server.url}\n`);
}

try {
  await startDevelopmentServer(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : "Architecture Companion Hono server failed to start.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
