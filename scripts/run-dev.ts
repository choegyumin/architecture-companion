import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveConsumerScopePath } from "@/server/resolve-consumer-scope";

import { DEVELOPMENT_SERVER_STATE_FILENAME } from "./_dev-session";

async function runDevelopment(args: readonly string[]): Promise<void> {
  const directories = args.at(0) === "--" ? args.slice(1) : args;
  if (directories.length > 1) throw new Error("Usage: pnpm dev [directory]");
  const scopePath = await resolveConsumerScopePath(directories.at(0) ?? process.cwd());
  const cacheRoot = fileURLToPath(new URL("../node_modules/.vite/", import.meta.url));
  await mkdir(cacheRoot, { recursive: true });
  const directory = await mkdtemp(join(cacheRoot, "session-"));

  try {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./dist/bin/index.js", import.meta.resolve("concurrently/package.json"))),
        "--no-color",
        "--kill-others",
        "--success",
        "first",
        "--names",
        "server,client",
        "tsx scripts/_dev-server.ts",
        "tsx scripts/_dev-client.ts",
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          DEVELOPMENT_SERVER_STATE: join(directory, DEVELOPMENT_SERVER_STATE_FILENAME),
          DEVELOPMENT_SERVER_SCOPE: scopePath,
          DEVELOPMENT_SERVER_OWNER: undefined,
        },
      },
    );

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.on(signal, () => child.kill(signal));
    }

    const [code, signal] = await once(child, "close");
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

try {
  await runDevelopment(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : "Architecture Companion development failed to start.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
