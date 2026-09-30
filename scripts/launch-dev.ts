import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

async function launchDevelopment(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "architecture-companion-dev-"));

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
        "pnpm dev.server",
        "pnpm dev.client",
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          ARCHITECTURE_COMPANION_DEV_SERVER_STATE: join(directory, "server.json"),
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
  await launchDevelopment();
} catch (error) {
  const message = error instanceof Error ? error.message : "Architecture Companion development failed to start.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
