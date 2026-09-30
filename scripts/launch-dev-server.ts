import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { resolveConsumerScopePath } from "@/server/resolve-consumer-scope";

async function launchDevelopmentServer(args: readonly string[]): Promise<void> {
  if (args.length > 1) throw new Error("Usage: pnpm dev.server [directory]");

  const scopePath = await resolveConsumerScopePath(args.at(0) ?? process.cwd());
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
      fileURLToPath(new URL("./start-dev-server.ts", import.meta.url)),
      scopePath,
    ],
    { stdio: "inherit" },
  );

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => child.kill(signal));
  }

  const [code, signal] = await once(child, "close");
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
}

try {
  await launchDevelopmentServer(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : "Architecture Companion development server failed to start.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
