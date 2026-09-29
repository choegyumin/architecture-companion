import { executeGenerateJsModuleDependencyGraphCommand } from "./generate.command";

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

    await expect(executeGenerateJsModuleDependencyGraphCommand(args, environment)).rejects.toThrow(
      "Usage: js-module-dependency-graph",
    );
    expect(environment.writeGraph).not.toHaveBeenCalled();
    expect(outputs).toEqual([]);
  });

  it("forwards generator-specific options and prints the temporary graph path", async () => {
    const { environment, outputs } = createEnvironment();

    await executeGenerateJsModuleDependencyGraphCommand(
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
});
