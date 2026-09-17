import { type ChildProcess, spawn } from "node:child_process";

export type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: Readonly<{ detached: true; stdio: "ignore" }>,
) => ChildProcess;

type OpenLocalPathOptions = Readonly<{
  platform?: NodeJS.Platform;
  spawnProcess?: SpawnProcess;
}>;

type LocalPathLaunch = Readonly<{
  command: string;
  args: readonly string[];
}>;

const defaultSpawnProcess: SpawnProcess = (command, args, options) => spawn(command, [...args], options);

function createLocalPathLaunch(platform: NodeJS.Platform, path: string): LocalPathLaunch {
  if (platform === "darwin") return { command: "/usr/bin/open", args: [path] };
  if (platform === "win32") {
    return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", path] };
  }
  return { command: "xdg-open", args: [path] };
}

export async function openLocalPath(path: string, options: OpenLocalPathOptions = {}): Promise<void> {
  const launch = createLocalPathLaunch(options.platform ?? process.platform, path);
  const spawnProcess = options.spawnProcess ?? defaultSpawnProcess;

  try {
    const child = spawnProcess(launch.command, launch.args, { detached: true, stdio: "ignore" });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
  } catch (error) {
    throw new Error(`Failed to open local path: ${path}`, { cause: error });
  }
}
