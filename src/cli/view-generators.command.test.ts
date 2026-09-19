import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { executeViewGeneratorsCommand } from "@/cli/view-generators.command";

async function writeGenerator(
  rootPath: string,
  directoryName: string,
  id: string,
  description: string,
): Promise<string> {
  const pluginPath = join(rootPath, directoryName);
  await mkdir(pluginPath, { recursive: true });
  await writeFile(
    join(pluginPath, "GENERATOR.md"),
    `---\nid: ${id}\ndescription: ${description}\n---\n\nGenerate the diagram.\n`,
  );
  return pluginPath;
}

describe("diagram generator discovery command", () => {
  it("requires exactly one explicit scope argument", async () => {
    const outputs: string[] = [];
    const environment = {
      builtInGeneratorsRoot: "/unused/built-in",
      homeDirectory: "/unused/home",
      writeStdout: (output: string) => outputs.push(output),
    };

    await expect(executeViewGeneratorsCommand([], environment)).rejects.toThrow("Usage:");
    await expect(executeViewGeneratorsCommand(["first", "second"], environment)).rejects.toThrow("Usage:");
    expect(outputs).toEqual([]);
  });

  it("treats a missing generator root as empty", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "architecture-companion-generators-"));
    const scopePath = join(temporaryRoot, "scope");
    const outputs: string[] = [];

    try {
      await mkdir(scopePath);
      await executeViewGeneratorsCommand([scopePath], {
        builtInGeneratorsRoot: join(temporaryRoot, "built-in"),
        homeDirectory: join(temporaryRoot, "home"),
        writeStdout: (output) => outputs.push(output),
      });

      expect(outputs).toEqual(["[]\n"]);
    } finally {
      await rm(temporaryRoot, { recursive: true });
    }
  });

  it("discovers manifest metadata and the absolute plugin path", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "architecture-companion-generators-"));
    const scopePath = join(temporaryRoot, "scope");
    const builtInRoot = join(temporaryRoot, "built-in");
    const outputs: string[] = [];

    try {
      await mkdir(scopePath);
      const pluginPath = await writeGenerator(
        builtInRoot,
        "directory-name",
        "dependency-graph",
        "Builds a dependency graph.",
      );

      await executeViewGeneratorsCommand([scopePath], {
        builtInGeneratorsRoot: builtInRoot,
        homeDirectory: join(temporaryRoot, "home"),
        writeStdout: (output) => outputs.push(output),
      });

      expect(JSON.parse(outputs.at(0) as string)).toEqual([
        {
          id: "dependency-graph",
          description: "Builds a dependency graph.",
          source: "built-in",
          path: resolve(pluginPath),
        },
      ]);
    } finally {
      await rm(temporaryRoot, { recursive: true });
    }
  });

  it("preserves duplicates across the three locations and sorts by id, source, then path", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "architecture-companion-generators-"));
    const scopePath = join(temporaryRoot, "scope");
    const builtInRoot = join(temporaryRoot, "built-in");
    const homeDirectory = join(temporaryRoot, "home");
    const globalRoot = join(homeDirectory, ".architecture-companion", "diagram-generators");
    const projectRoot = join(scopePath, ".architecture-companion", "diagram-generators");
    const outputs: string[] = [];

    try {
      await mkdir(scopePath);
      const builtInLast = await writeGenerator(builtInRoot, "z-plugin", "shared", "A description.");
      const builtInFirst = await writeGenerator(builtInRoot, "a-plugin", "shared", "Z description.");
      const globalPlugin = await writeGenerator(globalRoot, "global-copy", "shared", "Same description.");
      const projectPlugin = await writeGenerator(projectRoot, "project-copy", "shared", "Same description.");
      const alphaPlugin = await writeGenerator(projectRoot, "alpha-plugin", "alpha", "Project alpha.");
      await mkdir(join(builtInRoot, "manifestless"));
      await writeGenerator(join(builtInRoot, "container"), "nested", "nested", "Must be ignored.");

      await executeViewGeneratorsCommand([scopePath], {
        builtInGeneratorsRoot: builtInRoot,
        homeDirectory,
        writeStdout: (output) => outputs.push(output),
      });

      expect(outputs).toHaveLength(1);
      expect(outputs.at(0)?.endsWith("\n")).toBe(true);
      expect(JSON.parse(outputs.at(0) as string)).toEqual([
        {
          id: "alpha",
          description: "Project alpha.",
          source: "project",
          path: await realpath(alphaPlugin),
        },
        {
          id: "shared",
          description: "Z description.",
          source: "built-in",
          path: resolve(builtInFirst),
        },
        {
          id: "shared",
          description: "A description.",
          source: "built-in",
          path: resolve(builtInLast),
        },
        {
          id: "shared",
          description: "Same description.",
          source: "global",
          path: resolve(globalPlugin),
        },
        {
          id: "shared",
          description: "Same description.",
          source: "project",
          path: await realpath(projectPlugin),
        },
      ]);
    } finally {
      await rm(temporaryRoot, { recursive: true });
    }
  });

  it("discovers the generators from the source built-in root", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "architecture-companion-generators-"));
    const scopePath = join(temporaryRoot, "scope");
    const builtInRoot = resolve("src/plugins/diagram-generators");
    const outputs: string[] = [];

    try {
      await mkdir(scopePath);
      await executeViewGeneratorsCommand([scopePath], {
        builtInGeneratorsRoot: builtInRoot,
        homeDirectory: join(temporaryRoot, "home"),
        writeStdout: (output) => outputs.push(output),
      });

      expect(JSON.parse(outputs.at(0) as string)).toEqual([
        {
          id: "file-dependency-graph",
          description: expect.any(String),
          source: "built-in",
          path: resolve(builtInRoot, "file-dependency-graph"),
        },
        {
          id: "freeform",
          description: expect.any(String),
          source: "built-in",
          path: resolve(builtInRoot, "freeform"),
        },
      ]);
    } finally {
      await rm(temporaryRoot, { recursive: true });
    }
  });

  it("fails without stdout when an existing manifest is invalid", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "architecture-companion-generators-"));
    const scopePath = join(temporaryRoot, "scope");
    const builtInRoot = join(temporaryRoot, "built-in");
    const pluginPath = join(builtInRoot, "invalid");
    const outputs: string[] = [];

    try {
      await mkdir(scopePath);
      await mkdir(pluginPath, { recursive: true });
      await writeFile(join(pluginPath, "GENERATOR.md"), "invalid manifest");

      await expect(
        executeViewGeneratorsCommand([scopePath], {
          builtInGeneratorsRoot: builtInRoot,
          homeDirectory: join(temporaryRoot, "home"),
          writeStdout: (output) => outputs.push(output),
        }),
      ).rejects.toThrow(join(pluginPath, "GENERATOR.md"));
      expect(outputs).toEqual([]);
    } finally {
      await rm(temporaryRoot, { recursive: true });
    }
  });

  it("fails without stdout when an existing manifest cannot be read", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "architecture-companion-generators-"));
    const scopePath = join(temporaryRoot, "scope");
    const builtInRoot = join(temporaryRoot, "built-in");
    const pluginPath = join(builtInRoot, "unreadable");
    const manifestPath = join(pluginPath, "GENERATOR.md");
    const outputs: string[] = [];

    try {
      await mkdir(scopePath);
      await mkdir(manifestPath, { recursive: true });

      await expect(
        executeViewGeneratorsCommand([scopePath], {
          builtInGeneratorsRoot: builtInRoot,
          homeDirectory: join(temporaryRoot, "home"),
          writeStdout: (output) => outputs.push(output),
        }),
      ).rejects.toThrow(manifestPath);
      expect(outputs).toEqual([]);
    } finally {
      await rm(temporaryRoot, { recursive: true });
    }
  });
});
