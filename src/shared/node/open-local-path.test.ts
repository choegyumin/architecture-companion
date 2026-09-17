import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import { openLocalPath, type SpawnProcess } from "@/shared/node/open-local-path";

type SpawnCall = Readonly<{
  command: string;
  args: readonly string[];
  options: Readonly<{ detached: true; stdio: "ignore" }>;
}>;

function createSpawnProcess(outcome: "spawn" | "error") {
  const calls: SpawnCall[] = [];
  let unrefCount = 0;
  const spawnProcess: SpawnProcess = (command, args, options) => {
    calls.push({ command, args: [...args], options });
    const child = new EventEmitter() as ChildProcess;
    child.unref = () => {
      unrefCount += 1;
    };
    queueMicrotask(() => {
      if (outcome === "spawn") child.emit("spawn");
      else child.emit("error", new Error("spawn failed"));
    });
    return child;
  };

  return { calls, spawnProcess, unrefCount: () => unrefCount };
}

describe("opening a local path", () => {
  it.each([
    ["darwin", "/usr/bin/open", ["/workspace/file.ts"]],
    ["win32", "rundll32.exe", ["url.dll,FileProtocolHandler", "/workspace/file.ts"]],
    ["linux", "xdg-open", ["/workspace/file.ts"]],
  ] as const)("selects the %s platform launcher", async (platform, command, args) => {
    const processBoundary = createSpawnProcess("spawn");

    await openLocalPath("/workspace/file.ts", { platform, spawnProcess: processBoundary.spawnProcess });

    expect(processBoundary.calls).toEqual([{ command, args, options: { detached: true, stdio: "ignore" } }]);
    expect(processBoundary.unrefCount()).toBe(1);
  });

  it("reports a process spawn failure", async () => {
    const processBoundary = createSpawnProcess("error");

    await expect(
      openLocalPath("/workspace/file.ts", { platform: "linux", spawnProcess: processBoundary.spawnProcess }),
    ).rejects.toThrow("Failed to open local path: /workspace/file.ts");
    expect(processBoundary.unrefCount()).toBe(0);
  });
});
