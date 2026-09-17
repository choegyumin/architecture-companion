import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveConsumerScope } from "@/server/resolve-consumer-scope";

describe("consumer scope resolution", () => {
  it("canonicalizes an explicit path and detects an ancestor Git repository", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "architecture-companion-scope-"));
    const repositoryPath = join(temporaryRoot, "repository");
    const scopePath = join(repositoryPath, "packages", "app");

    try {
      await mkdir(join(repositoryPath, ".git"), { recursive: true });
      await mkdir(scopePath, { recursive: true });

      await expect(resolveConsumerScope(scopePath)).resolves.toEqual({
        path: await realpath(scopePath),
        isGitRepository: true,
      });
    } finally {
      await rm(temporaryRoot, { recursive: true });
    }
  });

  it("rejects a missing path", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "architecture-companion-scope-"));
    const missingPath = join(temporaryRoot, "missing");

    try {
      await expect(resolveConsumerScope(missingPath)).rejects.toThrow(`Review scope does not exist: ${missingPath}`);
    } finally {
      await rm(temporaryRoot, { recursive: true });
    }
  });

  it("rejects a path that is not a directory", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "architecture-companion-scope-"));
    const filePath = join(temporaryRoot, "file.txt");

    try {
      await writeFile(filePath, "not a directory");

      await expect(resolveConsumerScope(filePath)).rejects.toThrow(`Review scope is not a directory: ${filePath}`);
    } finally {
      await rm(temporaryRoot, { recursive: true });
    }
  });
});
