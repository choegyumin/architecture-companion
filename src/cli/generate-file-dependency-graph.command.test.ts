import { executeGenerateFileDependencyGraphCommand } from "@/cli/generate-file-dependency-graph.command";

function createEnvironment() {
  const outputs: string[] = [];
  return {
    outputs,
    environment: {
      writeGraph: vi.fn(async () => "/tmp/file-dependency-graph.json"),
      writeStdout: (output: string) => outputs.push(output),
    },
  };
}

describe("file dependency graph generator command", () => {
  it.each([[[]], [["--scope", "/scope"]], [["src"]]])("requires a scope and at least one source path", async (args) => {
    const { environment, outputs } = createEnvironment();

    await expect(executeGenerateFileDependencyGraphCommand(args, environment)).rejects.toThrow(
      "Usage: node generate.js",
    );
    expect(environment.writeGraph).not.toHaveBeenCalled();
    expect(outputs).toEqual([]);
  });

  it("forwards generator-specific options and prints the temporary graph path", async () => {
    const { environment, outputs } = createEnvironment();

    await executeGenerateFileDependencyGraphCommand(
      [
        "--scope",
        "/scope",
        "--ts-config",
        "configs/tsconfig.json",
        "--exclude",
        "src/generated/**",
        "--exclude",
        "src/legacy.ts",
        "src",
        "scripts/build.ts",
      ],
      environment,
    );

    expect(environment.writeGraph).toHaveBeenCalledExactlyOnceWith({
      scopePath: "/scope",
      sourcePaths: ["src", "scripts/build.ts"],
      tsConfigPath: "configs/tsconfig.json",
      exclude: ["src/generated/**", "src/legacy.ts"],
    });
    expect(outputs).toEqual(['{"graphPath":"/tmp/file-dependency-graph.json"}\n']);
  });
});
