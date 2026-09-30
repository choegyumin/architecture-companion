import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";

export const DEVELOPMENT_SERVER_STATE_FILENAME = "server.json";

export type DevelopmentServerState = Readonly<{
  url: string;
  pid: number;
  ownerPid: number;
}>;

export function getDevelopmentCacheDirectory(): string {
  const path = process.env.DEVELOPMENT_SERVER_STATE;
  if (!path) throw new Error("Development server state path is required. Start with pnpm dev.");
  return dirname(path);
}

export async function readDevelopmentServerState(
  path = join(getDevelopmentCacheDirectory(), DEVELOPMENT_SERVER_STATE_FILENAME),
): Promise<DevelopmentServerState | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as DevelopmentServerState;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readRunningDevelopmentServer(
  path = join(getDevelopmentCacheDirectory(), DEVELOPMENT_SERVER_STATE_FILENAME),
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
  path = join(getDevelopmentCacheDirectory(), DEVELOPMENT_SERVER_STATE_FILENAME),
): Promise<DevelopmentServerState> {
  while (true) {
    const state = await readRunningDevelopmentServer(path);
    if (state) return state;
    await setTimeout(100);
  }
}

export async function writeDevelopmentServerState(
  state: DevelopmentServerState,
  path = join(getDevelopmentCacheDirectory(), DEVELOPMENT_SERVER_STATE_FILENAME),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${state.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(state));
  await rename(temporaryPath, path);
}
