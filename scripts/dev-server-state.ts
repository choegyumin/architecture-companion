import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export type DevelopmentServerState = Readonly<{
  url: string;
  pid: number;
  ownerPid: number;
}>;

export function getDevelopmentServerStatePath(): string {
  return (
    process.env.ARCHITECTURE_COMPANION_DEV_SERVER_STATE ??
    fileURLToPath(new URL("../.vite/dev-server.json", import.meta.url))
  );
}

export async function readDevelopmentServerState(
  path = getDevelopmentServerStatePath(),
): Promise<DevelopmentServerState | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as DevelopmentServerState;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readRunningDevelopmentServer(
  path = getDevelopmentServerStatePath(),
): Promise<DevelopmentServerState | undefined> {
  const state = await readDevelopmentServerState(path);
  if (!state) return undefined;

  try {
    process.kill(state.pid, 0);
    process.kill(state.ownerPid, 0);
    return state;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return undefined;
    throw error;
  }
}

export async function waitForDevelopmentServer(
  path = getDevelopmentServerStatePath(),
): Promise<DevelopmentServerState> {
  while (true) {
    const state = await readRunningDevelopmentServer(path);
    if (state) return state;
    await setTimeout(100);
  }
}

export async function writeDevelopmentServerState(
  state: DevelopmentServerState,
  path = getDevelopmentServerStatePath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${state.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(state));
  await rename(temporaryPath, path);
}
