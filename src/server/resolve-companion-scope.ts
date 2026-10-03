import { realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { CompanionScope } from "@/server/companion-scope";

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function isInsideGitRepository(path: string): Promise<boolean> {
  let currentPath = path;

  while (true) {
    if (await pathExists(join(currentPath, ".git"))) return true;

    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) return false;
    currentPath = parentPath;
  }
}

export async function resolveCompanionScopePath(inputPath: string): Promise<string> {
  let inputStat;

  try {
    inputStat = await stat(inputPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`Review scope does not exist: ${inputPath}`, { cause: error });
    }
    throw error;
  }

  if (!inputStat.isDirectory()) {
    throw new Error(`Review scope is not a directory: ${inputPath}`);
  }

  return realpath(inputPath);
}

export async function resolveCompanionScope(inputPath: string): Promise<CompanionScope> {
  const path = await resolveCompanionScopePath(inputPath);

  return {
    path,
    isGitRepository: await isInsideGitRepository(path),
  };
}
