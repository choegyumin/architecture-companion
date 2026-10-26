import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type z from "zod";

import { dependencyDiagramGraphSchema } from "@/features/diagram/diagram-graph";

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
        "--ignore-path",
        "src/generated/**",
        "--ignore-path",
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

  it("keeps resolved local modules outside collection as unexpanded file boundaries", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "architecture-companion-js-module-dependencies-"));
    const outputs: string[] = [];
    let graphPath: string | undefined;

    try {
      await writeFile(join(rootPath, "package.json"), '{"name":"fixture-package","type":"module"}\n');
      await mkdir(join(rootPath, "src/shared"), { recursive: true });
      await writeFile(join(rootPath, "src/index.js"), 'import "./shared/helper.js";\n');
      await writeFile(join(rootPath, "src/shared/helper.js"), 'import "./deeper.js";\nexport const helper = true;\n');
      await writeFile(join(rootPath, "src/shared/deeper.js"), "export const deeper = true;\n");

      await executeJsModuleDependencyGraphCommand(["--base", rootPath, "src/index.js"], {
        writeGraph: writeJsModuleDependencyGraph,
        writeStdout: (output) => outputs.push(output),
      });
      ({ graphPath } = JSON.parse(outputs.join("")) as { graphPath: string });
      const graph = dependencyDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));

      expect(outputs).toEqual([`${JSON.stringify({ graphPath })}\n`]);
      expect(graph.groups).toEqual([
        { type: "default", groupId: "group:directory:src/shared", title: "shared", synthetic: false },
      ]);
      expect(graph.nodes).toEqual([
        {
          type: "default",
          nodeId: "file:src/index.js",
          title: "index.js",
          synthetic: false,
          links: [{ text: "source", href: "source:///src/index.js" }],
        },
        {
          type: "default",
          nodeId: "file:src/shared/helper.js",
          title: "helper.js",
          description: "Outside collection scope; internals not analyzed.",
          groupId: "group:directory:src/shared",
          synthetic: false,
          links: [{ text: "source", href: "source:///src/shared/helper.js" }],
        },
      ]);
      expect(graph.edges).toEqual([
        {
          type: "default",
          edgeId: "dependency:file%3Asrc%2Findex.js:file%3Asrc%2Fshared%2Fhelper.js:runtime",
          sourceNodeId: "file:src/index.js",
          targetNodeId: "file:src/shared/helper.js",
        },
      ]);
    } finally {
      await rm(rootPath, { recursive: true });
      if (graphPath) await rm(dirname(graphPath), { recursive: true });
    }
  });

  it("preserves alias resolution and type-only edges to deduplicated local package boundaries", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "architecture-companion-js-module-dependencies-"));
    let graphPath: string | undefined;

    try {
      await writeFile(join(rootPath, "package.json"), '{"name":"fixture-package","type":"module"}\n');
      await writeFile(
        join(rootPath, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { paths: { "@shared/*": ["packages/shared/*"] } } }),
      );
      await mkdir(join(rootPath, "src"));
      await mkdir(join(rootPath, "packages/shared"), { recursive: true });
      await writeFile(join(rootPath, "src/index.ts"), 'import { value } from "@shared/value";\nexport { value };\n');
      await writeFile(
        join(rootPath, "src/types.ts"),
        'import type { Shape } from "@shared/value";\nexport type Result = Shape;\n',
      );
      await writeFile(join(rootPath, "packages/shared/package.json"), '{"name":"shared-package","type":"module"}\n');
      await writeFile(
        join(rootPath, "packages/shared/value.ts"),
        'import "./deeper.js";\nexport type Shape = boolean;\nexport const value = true;\n',
      );
      await writeFile(join(rootPath, "packages/shared/deeper.ts"), "export {};\n");

      graphPath = await writeJsModuleDependencyGraph({
        scopePath: rootPath,
        sourcePaths: ["src/index.ts", "src/types.ts"],
      });
      const graph = dependencyDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));

      expect(graph.groups).toEqual([
        { type: "default", groupId: "group:directory:src", title: "src", synthetic: false },
        {
          type: "default",
          groupId: "group:package:packages/shared",
          title: "shared-package",
          description: "Package packages/shared",
          synthetic: false,
        },
      ]);
      expect(graph.nodes).toEqual([
        {
          type: "default",
          nodeId: "file:packages/shared/value.ts",
          title: "value.ts",
          description: "Outside collection scope; internals not analyzed.",
          groupId: "group:package:packages/shared",
          synthetic: false,
          links: [{ text: "source", href: "source:///packages/shared/value.ts" }],
        },
        expect.objectContaining({ nodeId: "file:src/index.ts", groupId: "group:directory:src" }),
        expect.objectContaining({ nodeId: "file:src/types.ts", groupId: "group:directory:src" }),
      ]);
      expect(graph.edges).toEqual([
        {
          type: "default",
          edgeId: "dependency:file%3Asrc%2Findex.ts:file%3Apackages%2Fshared%2Fvalue.ts:runtime",
          sourceNodeId: "file:src/index.ts",
          targetNodeId: "file:packages/shared/value.ts",
        },
        {
          type: "default",
          edgeId: "dependency:file%3Asrc%2Ftypes.ts:file%3Apackages%2Fshared%2Fvalue.ts:type-only",
          sourceNodeId: "file:src/types.ts",
          targetNodeId: "file:packages/shared/value.ts",
          kind: "type-only",
        },
      ]);

      const collectedGraphPath = await writeJsModuleDependencyGraph({
        scopePath: rootPath,
        sourcePaths: ["src/index.ts", "packages/shared/value.ts"],
      });
      try {
        const collectedGraph = dependencyDiagramGraphSchema.parse(
          JSON.parse(await readFile(collectedGraphPath, "utf8")),
        );
        expect(collectedGraph.nodes.find(({ nodeId }) => nodeId === "file:packages/shared/value.ts")).toEqual({
          type: "default",
          nodeId: "file:packages/shared/value.ts",
          title: "value.ts",
          groupId: "group:package:packages/shared",
          synthetic: false,
          links: [{ text: "source", href: "source:///packages/shared/value.ts" }],
        });
      } finally {
        await rm(dirname(collectedGraphPath), { recursive: true });
      }
    } finally {
      await rm(rootPath, { recursive: true });
      if (graphPath) await rm(dirname(graphPath), { recursive: true });
    }
  });

  it("does not restore excluded references or turn unresolved, outside-base, and npm imports into local boundaries", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "architecture-companion-js-module-dependencies-"));
    const scopePath = join(rootPath, "project");
    const outputs: string[] = [];
    let graphPath: string | undefined;

    try {
      await mkdir(join(scopePath, "src"), { recursive: true });
      await mkdir(join(scopePath, "shared/parent"), { recursive: true });
      await mkdir(join(scopePath, "shared/nested"));
      await mkdir(join(scopePath, "node_modules/sample-package"), { recursive: true });
      await writeFile(join(scopePath, "package.json"), '{"name":"fixture-package","type":"module"}\n');
      await writeFile(join(rootPath, "outside.js"), "export {};\n");
      await writeFile(
        join(scopePath, "src/index.js"),
        [
          'import "../shared/gitignored.js";',
          'import "../shared/inline.js";',
          'import "../shared/reincluded.js";',
          'import "../shared/explicit.js";',
          'import "../shared/parent/child.js";',
          'import "../shared/nested/hidden.js";',
          'import "../shared/missing.js";',
          'import "../../outside.js";',
          'import "node:fs";',
          'import "sample-package";',
          "",
        ].join("\n"),
      );
      await writeFile(
        join(scopePath, ".gitignore"),
        "shared/gitignored.js\nshared/reincluded.js\nshared/explicit.js\nshared/parent/\n",
      );
      await writeFile(join(scopePath, "shared/parent/.gitignore"), "!child.js\n");
      await writeFile(join(scopePath, "shared/nested/.gitignore"), "hidden.js\n");
      for (const path of [
        "gitignored.js",
        "inline.js",
        "reincluded.js",
        "explicit.js",
        "parent/child.js",
        "nested/hidden.js",
      ]) {
        await writeFile(join(scopePath, "shared", path), "export {};\n");
      }
      await writeFile(
        join(scopePath, "node_modules/sample-package/package.json"),
        '{"name":"sample-package","main":"index.js"}\n',
      );
      await writeFile(join(scopePath, "node_modules/sample-package/index.js"), "module.exports = true;\n");

      await executeJsModuleDependencyGraphCommand(
        [
          "--base",
          scopePath,
          "--ignore-path",
          "shared/inline.js",
          "--ignore-path",
          "shared/explicit.js",
          "--ignore-path",
          "!shared/reincluded.js",
          "src/index.js",
          "shared/explicit.js",
        ],
        { writeGraph: writeJsModuleDependencyGraph, writeStdout: (output) => outputs.push(output) },
      );
      ({ graphPath } = JSON.parse(outputs.join("")) as { graphPath: string });
      const graph = dependencyDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));

      expect(graph.nodes.map(({ nodeId }) => nodeId)).toEqual([
        "external:sample-package",
        "file:shared/explicit.js",
        "file:shared/reincluded.js",
        "file:src/index.js",
      ]);
      expect(graph.nodes.find(({ nodeId }) => nodeId === "file:shared/explicit.js")).not.toHaveProperty("description");
      expect(graph.nodes.find(({ nodeId }) => nodeId === "file:shared/reincluded.js")).toHaveProperty(
        "description",
        "Outside collection scope; internals not analyzed.",
      );
      expect(graph.nodes.find(({ nodeId }) => nodeId === "external:sample-package")).toHaveProperty(
        "kind",
        "External package",
      );
      expect(graph.edges.map(({ sourceNodeId, targetNodeId }) => [sourceNodeId, targetNodeId])).toEqual([
        ["file:src/index.js", "external:sample-package"],
        ["file:src/index.js", "file:shared/explicit.js"],
        ["file:src/index.js", "file:shared/reincluded.js"],
      ]);
    } finally {
      await rm(rootPath, { recursive: true });
      if (graphPath) await rm(dirname(graphPath), { recursive: true });
    }
  });

  it("writes only deterministic graph data to a temporary file", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "architecture-companion-js-module-dependencies-"));

    try {
      await writeFile(join(rootPath, "package.json"), '{"name":"fixture-package","type":"module"}\n');
      await mkdir(join(rootPath, "lib"));
      await writeFile(join(rootPath, "index.js"), 'import { value } from "./lib/value.js";\nexport { value };\n');
      await writeFile(join(rootPath, "lib/value.js"), "export const value = 1;\n");
      const options = { scopePath: rootPath, sourcePaths: ["index.js", "lib/value.js"] } as const;

      const [firstGraph, secondGraph] = await Promise.all([buildModuleGraph(options), buildModuleGraph(options)]);
      const graphPath = await writeJsModuleDependencyGraph(options);
      const writtenGraph = JSON.parse(await readFile(graphPath, "utf8")) as z.input<
        typeof dependencyDiagramGraphSchema
      >;

      expect(secondGraph).toEqual(firstGraph);
      expect(dependencyDiagramGraphSchema.parse(writtenGraph)).toEqual(firstGraph);
      expect(writtenGraph.groups).toHaveLength(1);
      expect(writtenGraph.nodes).toHaveLength(2);
      expect(writtenGraph.edges).toHaveLength(1);
      expect(
        [...writtenGraph.groups, ...writtenGraph.nodes, ...writtenGraph.edges].every(
          (element) => element.type === undefined,
        ),
      ).toBe(true);
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
