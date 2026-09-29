import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildModuleGraph } from "../analysis/build-module-graph";
import { executeJsModuleDependencyGraphCommand, writeJsModuleDependencyGraph } from "./command";

function createEnvironment() {
  const outputs: string[] = [];
  return {
    outputs,
    environment: {
      writeGraph: vi.fn(async () => "/tmp/js-module-dependency-graph.json"),
      writeStdout: (output: string) => outputs.push(output),
    },
  };
}

describe("JavaScript module dependency graph generator command", () => {
  it.each([[[]], [["--base", "/base"]], [["src"]]])("requires a base and at least one source path", async (args) => {
    const { environment, outputs } = createEnvironment();

    await expect(executeJsModuleDependencyGraphCommand(args, environment)).rejects.toThrow(
      "Usage: js-module-dependency-graph",
    );
    expect(environment.writeGraph).not.toHaveBeenCalled();
    expect(outputs).toEqual([]);
  });

  it("forwards generator-specific options and prints the temporary graph path", async () => {
    const { environment, outputs } = createEnvironment();

    await executeJsModuleDependencyGraphCommand(
      [
        "--base",
        "/base",
        "--tsconfig",
        "configs/tsconfig.json",
        "--exclude-path",
        "src/generated/**",
        "--exclude-path",
        "src/legacy.ts",
        "src",
        "scripts/build.ts",
      ],
      environment,
    );

    expect(environment.writeGraph).toHaveBeenCalledExactlyOnceWith({
      scopePath: "/base",
      sourcePaths: ["src", "scripts/build.ts"],
      tsConfigPath: "configs/tsconfig.json",
      exclude: ["src/generated/**", "src/legacy.ts"],
    });
    expect(outputs).toEqual(['{"graphPath":"/tmp/js-module-dependency-graph.json"}\n']);
  });

  it("writes only deterministic graph data to a temporary file", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "architecture-companion-js-module-dependencies-"));

    try {
      await writeFile(join(rootPath, "package.json"), '{"name":"fixture-package","type":"module"}\n');
      await writeFile(join(rootPath, "index.js"), 'import { value } from "./value.js";\nexport { value };\n');
      await writeFile(join(rootPath, "value.js"), "export const value = 1;\n");
      const options = { scopePath: rootPath, sourcePaths: ["index.js", "value.js"] } as const;

      const [firstGraph, secondGraph] = await Promise.all([buildModuleGraph(options), buildModuleGraph(options)]);
      const graphPath = await writeJsModuleDependencyGraph(options);
      const writtenGraph = JSON.parse(await readFile(graphPath, "utf8"));

      expect(secondGraph).toEqual(firstGraph);
      expect(writtenGraph).toEqual(firstGraph);
      expect(writtenGraph).toEqual({
        groups: expect.any(Array),
        nodes: expect.any(Array),
        edges: expect.any(Array),
      });
      expect(writtenGraph).not.toHaveProperty("id");
      expect(writtenGraph).not.toHaveProperty("title");
      expect(writtenGraph).not.toHaveProperty("generator");
      expect(writtenGraph).not.toHaveProperty("layout");
    } finally {
      await rm(rootPath, { recursive: true });
    }
  });
});
