import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, rmdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

import type ts from "typescript";
import { version as fallbackVersion } from "typescript/package.json";

import { isMissingPathError } from "@/shared/node/path";

const require = createRequire(import.meta.url);
const installations = new Map<string, Promise<void>>();

async function hasCachedPackage(directory: string): Promise<boolean> {
  let contents: string;
  try {
    const cacheStat = await lstat(directory);
    if (!cacheStat.isDirectory() || (process.getuid && cacheStat.uid !== process.getuid())) {
      throw new Error(`Unsafe TypeScript temporary cache directory: ${directory}`);
    }
    contents = await readFile(join(directory, "node_modules/typescript/package.json"), "utf8");
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
  if (JSON.parse(contents).version !== fallbackVersion) {
    throw new Error(`Unexpected TypeScript version in temporary cache: ${directory}`);
  }
  try {
    await access(require.resolve(join(directory, "node_modules/typescript")));
    await access(join(directory, "node_modules/typescript/lib/lib.esnext.full.d.ts"));
    await access(join(directory, "node_modules/typescript/lib/lib.es5.d.ts"));
  } catch (error) {
    if (
      isMissingPathError(error) ||
      (error && typeof error === "object" && "code" in error && error.code === "MODULE_NOT_FOUND")
    ) {
      return false;
    }
    throw error;
  }
  return true;
}

async function acquireInstallationLock(cachePath: string): Promise<() => Promise<void>> {
  const lockPath = `${cachePath}.lock`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for TypeScript temporary installation lock: ${lockPath}`);
    }
    try {
      await mkdir(lockPath, { mode: 0o700 });
      return () => rmdir(lockPath);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    }
    try {
      const lockStat = await lstat(lockPath);
      if (!lockStat.isDirectory() || (process.getuid && lockStat.uid !== process.getuid())) {
        throw new Error(`Unsafe TypeScript temporary lock directory: ${lockPath}`);
      }
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw error;
    }
    await setTimeout(50);
  }
}

async function installFallback(cacheRoot: string, cachePath: string): Promise<void> {
  const releaseLock = await acquireInstallationLock(cachePath);
  try {
    if (await hasCachedPackage(cachePath)) return;
    await installFallbackPackage(cacheRoot, cachePath);
  } finally {
    await releaseLock();
  }
}

async function installFallbackPackage(cacheRoot: string, cachePath: string): Promise<void> {
  const directory = await mkdtemp(join(cacheRoot, `${fallbackVersion}-install-`));
  try {
    try {
      // npm.cmd needs a shell on Windows. Arguments are fixed; paths are passed through cwd, not the shell.
      await promisify(execFile)(
        process.platform === "win32" ? "npm.cmd" : "npm",
        [
          "install",
          "--prefix",
          ".",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--no-package-lock",
          "--no-save",
          `typescript@${fallbackVersion}`,
        ],
        { cwd: directory, shell: process.platform === "win32", windowsHide: true, timeout: 120_000 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot install fallback TypeScript ${fallbackVersion}: ${message}`, { cause: error });
    }
    if (!(await hasCachedPackage(directory))) {
      throw new Error(`npm did not install fallback TypeScript ${fallbackVersion}.`);
    }
    if (!(await hasCachedPackage(cachePath))) {
      try {
        const cacheStat = await lstat(cachePath);
        if (!cacheStat.isDirectory() || (process.getuid && cacheStat.uid !== process.getuid())) {
          throw new Error(`Unsafe TypeScript temporary cache directory: ${cachePath}`);
        }
        const quarantine = await mkdtemp(join(cacheRoot, `${fallbackVersion}-invalid-`));
        await rename(cachePath, join(quarantine, "cache"));
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
      }
    }
    try {
      await rename(directory, cachePath);
    } catch (error) {
      // Another process may have published the same version while npm was running.
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        ["EEXIST", "ENOTEMPTY"].includes(String(error.code))
      )) {
        throw error;
      }
      if (!(await hasCachedPackage(cachePath))) throw error;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function loadFallback(): Promise<typeof ts> {
  const user = createHash("sha256").update(homedir()).digest("hex").slice(0, 16);
  const cacheRoot = join(tmpdir(), `architecture-companion-typescript-${user}`);
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  const cacheStat = await lstat(cacheRoot);
  if (!cacheStat.isDirectory() || (process.getuid && cacheStat.uid !== process.getuid())) {
    throw new Error(`Unsafe TypeScript temporary cache directory: ${cacheRoot}`);
  }
  if (process.platform !== "win32") await chmod(cacheRoot, 0o700);
  const cachePath = join(cacheRoot, fallbackVersion);
  if (!(await hasCachedPackage(cachePath))) {
    let installation = installations.get(cachePath);
    if (!installation) {
      installation = installFallback(cacheRoot, cachePath).finally(() => installations.delete(cachePath));
      installations.set(cachePath, installation);
    }
    await installation;
  }
  // Load only after promotion: TypeScript resolves its lib.*.d.ts next to its executing file.
  return require(join(cachePath, "node_modules/typescript")) as typeof ts;
}

export async function loadTypeScript(scopePath: string): Promise<typeof ts> {
  const targetRequire = createRequire(resolve(scopePath, "package.json"));
  try {
    targetRequire.resolve("typescript/package.json");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "MODULE_NOT_FOUND") {
      return loadFallback();
    }
    throw error;
  }
  return targetRequire("typescript") as typeof ts;
}
