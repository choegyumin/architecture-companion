import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  generateJsModuleDependencyGraph,
  writeJsModuleDependencyGraph,
} from "@/features/js-module-dependency-graph/js-module-dependency-graph";

async function writeFixtureFile(rootPath: string, relativePath: string, content: string): Promise<void> {
  const filePath = join(rootPath, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function writePackage(
  rootPath: string,
  packageName: string,
  manifest: Readonly<Record<string, unknown>>,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  const packagePath = join(rootPath, "node_modules", packageName);
  await mkdir(packagePath, { recursive: true });
  await writeFile(
    join(packagePath, "package.json"),
    `${JSON.stringify({ name: packageName, ...manifest }, null, 2)}\n`,
  );
  await Promise.all(
    Object.entries(files).map(([relativePath, content]) => writeFixtureFile(packagePath, relativePath, content)),
  );
}

async function withFixture(run: (rootPath: string) => Promise<void>): Promise<void> {
  const rootPath = await mkdtemp(join(tmpdir(), "architecture-companion-js-module-dependencies-"));

  try {
    await writeFile(join(rootPath, "package.json"), '{"name":"fixture-package","type":"module"}\n');
    await run(rootPath);
  } finally {
    await rm(rootPath, { recursive: true });
  }
}

describe("JavaScript module dependency graph generator", () => {
  it("maps confirmed files, package boundaries, type-only dependencies, groups, and generation-time filters", async () => {
    await withFixture(async (rootPath) => {
      await writePackage(rootPath, "sample-package", { exports: "./index.js" }, { "index.js": "export default 1;\n" });
      await writeFixtureFile(
        rootPath,
        "src/index.ts",
        [
          'import "node:fs";',
          'import { runtimeValue } from "./runtime.js";',
          'import type { Shape } from "./types.js";',
          'import sample from "sample-package";',
          'import { ignored } from "./ignored.js";',
          'import { generated } from "./model.generated.js";',
          'import "./missing.js";',
          "export const value: Shape = { value: runtimeValue + sample + ignored + generated };",
          "",
        ].join("\n"),
      );
      await writeFixtureFile(rootPath, "src/runtime.ts", "export const runtimeValue = 1;\n");
      await writeFixtureFile(rootPath, "src/types.ts", "export type Shape = { value: number };\n");
      await writeFixtureFile(rootPath, "src/ignored.ts", "export const ignored = 1;\n");
      await writeFixtureFile(rootPath, "src/model.generated.ts", "export const generated = 1;\n");
      await writeFixtureFile(rootPath, "src/hidden.test.ts", "export const hidden = true;\n");
      await writeFixtureFile(rootPath, "dist/built.js", "export const built = true;\n");

      const graph = await generateJsModuleDependencyGraph({
        scopePath: rootPath,
        sourcePaths: ["src", "dist"],
        exclude: ["src/ignored.ts"],
      });

      expect(graph.groups).toEqual([
        {
          id: "group:external-packages",
          title: "External packages",
        },
      ]);
      expect(graph.nodes).toEqual([
        {
          type: "default",
          id: "external:sample-package",
          kind: "External package",
          title: "sample-package",
          groupId: "group:external-packages",
        },
        {
          type: "default",
          id: "file:src/index.ts",
          title: "index.ts",
          links: [{ text: "source", href: "source:///src/index.ts" }],
        },
        {
          type: "default",
          id: "file:src/runtime.ts",
          title: "runtime.ts",
          links: [{ text: "source", href: "source:///src/runtime.ts" }],
        },
        {
          type: "default",
          id: "file:src/types.ts",
          title: "types.ts",
          links: [{ text: "source", href: "source:///src/types.ts" }],
        },
      ]);
      expect(graph.edges).toEqual([
        {
          type: "default",
          id: "dependency:file%3Asrc%2Findex.ts:external%3Asample-package:runtime",
          source: "file:src/index.ts",
          target: "external:sample-package",
        },
        {
          type: "default",
          id: "dependency:file%3Asrc%2Findex.ts:file%3Asrc%2Fruntime.ts:runtime",
          source: "file:src/index.ts",
          target: "file:src/runtime.ts",
        },
        {
          type: "default",
          id: "dependency:file%3Asrc%2Findex.ts:file%3Asrc%2Ftypes.ts:type-only",
          source: "file:src/index.ts",
          target: "file:src/types.ts",
          kind: "type-only",
        },
      ]);
    });
  });

  it("omits the scope package group while preserving nested package boundaries", async () => {
    await withFixture(async (rootPath) => {
      await writeFixtureFile(rootPath, "root.ts", "export const root = true;\n");
      await writeFixtureFile(rootPath, "src/index.ts", "export const source = true;\n");
      await writeFixtureFile(rootPath, "packages/nested/package.json", '{"name":"nested-package","type":"module"}\n');
      await writeFixtureFile(rootPath, "packages/nested/index.ts", "export const nested = true;\n");

      const graph = await generateJsModuleDependencyGraph({
        scopePath: rootPath,
        sourcePaths: ["root.ts", "src", "packages/nested"],
      });

      expect(graph.groups).toEqual([
        {
          id: "group:directory:src",
          title: "src",
        },
        {
          id: "group:package:packages/nested",
          title: "nested-package",
          description: "Package packages/nested",
        },
      ]);
      expect(graph.nodes).toEqual([
        {
          type: "default",
          id: "file:packages/nested/index.ts",
          title: "index.ts",
          groupId: "group:package:packages/nested",
          links: [{ text: "source", href: "source:///packages/nested/index.ts" }],
        },
        {
          type: "default",
          id: "file:root.ts",
          title: "root.ts",
          links: [{ text: "source", href: "source:///root.ts" }],
        },
        {
          type: "default",
          id: "file:src/index.ts",
          title: "index.ts",
          groupId: "group:directory:src",
          links: [{ text: "source", href: "source:///src/index.ts" }],
        },
      ]);
    });
  });

  it("elides one normalized local root and promotes its direct contents", async () => {
    await withFixture(async (rootPath) => {
      await writeFixtureFile(rootPath, "src/index.ts", "export const index = true;\n");
      await writeFixtureFile(rootPath, "src/client/index.ts", "export const client = true;\n");
      await writeFixtureFile(rootPath, "src/server/index.ts", "export const server = true;\n");

      const graph = await generateJsModuleDependencyGraph({
        scopePath: rootPath,
        sourcePaths: ["src/index.ts", "src/client", "src/server"],
      });

      expect(graph.groups).toEqual([
        {
          id: "group:directory:src/client",
          title: "client",
        },
        {
          id: "group:directory:src/server",
          title: "server",
        },
      ]);
      expect(graph.nodes).toEqual([
        expect.objectContaining({
          id: "file:src/client/index.ts",
          groupId: "group:directory:src/client",
        }),
        expect.not.objectContaining({ groupId: expect.anything() }),
        expect.objectContaining({
          id: "file:src/server/index.ts",
          groupId: "group:directory:src/server",
        }),
      ]);
      expect(graph.nodes.at(1)).toEqual(expect.objectContaining({ id: "file:src/index.ts" }));
    });
  });

  it("keeps distinct local roots as groups", async () => {
    await withFixture(async (rootPath) => {
      await writeFixtureFile(rootPath, "scripts/build.ts", "export const build = true;\n");
      await writeFixtureFile(rootPath, "src/index.ts", "export const source = true;\n");

      const graph = await generateJsModuleDependencyGraph({
        scopePath: rootPath,
        sourcePaths: ["src", "scripts"],
      });

      expect(graph.groups).toEqual([
        {
          id: "group:directory:scripts",
          title: "scripts",
        },
        {
          id: "group:directory:src",
          title: "src",
        },
      ]);
      expect(graph.nodes).toEqual([
        expect.objectContaining({
          id: "file:scripts/build.ts",
          groupId: "group:directory:scripts",
        }),
        expect.objectContaining({
          id: "file:src/index.ts",
          groupId: "group:directory:src",
        }),
      ]);
    });
  });

  it("applies sole-root elision to a package boundary", async () => {
    await withFixture(async (rootPath) => {
      await writeFixtureFile(rootPath, "packages/nested/package.json", '{"name":"nested-package","type":"module"}\n');
      await writeFixtureFile(rootPath, "packages/nested/index.ts", "export const index = true;\n");
      await writeFixtureFile(rootPath, "packages/nested/lib/value.ts", "export const value = true;\n");

      const graph = await generateJsModuleDependencyGraph({
        scopePath: rootPath,
        sourcePaths: ["packages/nested"],
      });

      expect(graph.groups).toEqual([
        {
          id: "group:directory:packages/nested/lib",
          title: "lib",
        },
      ]);
      expect(graph.nodes).toEqual([
        expect.not.objectContaining({ groupId: expect.anything() }),
        expect.objectContaining({
          id: "file:packages/nested/lib/value.ts",
          groupId: "group:directory:packages/nested/lib",
        }),
      ]);
      expect(graph.nodes.at(0)).toEqual(expect.objectContaining({ id: "file:packages/nested/index.ts" }));
    });
  });

  it("resolves TypeScript paths relative to a tsconfig without baseUrl", async () => {
    await withFixture(async (rootPath) => {
      await writeFixtureFile(
        rootPath,
        "tsconfig.json",
        `${JSON.stringify({ compilerOptions: { paths: { "@/*": ["src/*"] } } }, null, 2)}\n`,
      );
      await writeFixtureFile(rootPath, "src/index.ts", 'import { aliased } from "@/aliased";\nexport { aliased };\n');
      await writeFixtureFile(rootPath, "src/aliased.ts", "export const aliased = true;\n");

      const graph = await generateJsModuleDependencyGraph({
        scopePath: rootPath,
        sourcePaths: ["src"],
        tsConfigPath: "tsconfig.json",
      });

      expect(graph.edges).toContainEqual({
        type: "default",
        id: "dependency:file%3Asrc%2Findex.ts:file%3Asrc%2Faliased.ts:runtime",
        source: "file:src/index.ts",
        target: "file:src/aliased.ts",
      });
    });
  });

  it("resolves package export subpaths with syntax-specific import and require conditions", async () => {
    await withFixture(async (rootPath) => {
      await writePackage(
        rootPath,
        "subpath-package",
        { exports: { "./feature": "./feature.js" } },
        { "feature.js": "export const feature = true;\n" },
      );
      await writePackage(
        rootPath,
        "import-condition-package",
        {
          type: "module",
          exports: { require: "./missing.cjs", import: "./import.mjs", default: "./missing-default.js" },
        },
        { "import.mjs": "export default true;\n" },
      );
      await writePackage(
        rootPath,
        "require-condition-package",
        {
          exports: { import: "./missing.mjs", require: "./require.cjs", default: "./missing-default.js" },
        },
        { "require.cjs": "module.exports = true;\n" },
      );
      await writeFixtureFile(
        rootPath,
        "src/importer.mts",
        [
          'import { feature } from "subpath-package/feature";',
          'import imported from "import-condition-package";',
          "export const value = feature && imported;",
          "",
        ].join("\n"),
      );
      await writeFixtureFile(
        rootPath,
        "src/requirer.cts",
        'const required = require("require-condition-package");\nexport { required };\n',
      );

      const graph = await generateJsModuleDependencyGraph({ scopePath: rootPath, sourcePaths: ["src"] });
      const externalNodeIds = graph.nodes
        .filter(({ kind }) => kind === "External package")
        .map(({ id }) => id)
        .toSorted();

      expect(externalNodeIds).toEqual([
        "external:import-condition-package",
        "external:require-condition-package",
        "external:subpath-package",
      ]);
    });
  });

  it("excludes test, generated, and build paths before analysis", async () => {
    await withFixture(async (rootPath) => {
      await writeFixtureFile(rootPath, "src/index.ts", "export const value = true;\n");
      await writeFixtureFile(rootPath, "src/example.spec.d.ts", "export type Spec = true;\n");
      await writeFixtureFile(rootPath, "src/model.generated.d.ts", "export type Generated = true;\n");
      await writeFixtureFile(rootPath, "src/generated/helper.ts", "export const generated = true;\n");
      await writeFixtureFile(rootPath, "test/helper.ts", "export const test = true;\n");
      await writeFixtureFile(rootPath, "tests/helper.ts", "export const tests = true;\n");
      await writeFixtureFile(rootPath, "dist/hidden.ts", "export const hidden = true;\n");
      await chmod(join(rootPath, "dist"), 0o000);

      try {
        const graph = await generateJsModuleDependencyGraph({ scopePath: rootPath, sourcePaths: ["."] });
        expect(graph.nodes.filter(({ id }) => id.startsWith("file:"))).toEqual([
          expect.objectContaining({ id: "file:src/index.ts" }),
        ]);
      } finally {
        await chmod(join(rootPath, "dist"), 0o755);
      }
    });
  });

  it("resolves CommonJS-emitted imports, types exports, and package imports aliases", async () => {
    await withFixture(async (rootPath) => {
      await writeFile(
        join(rootPath, "package.json"),
        `${JSON.stringify(
          {
            name: "fixture-package",
            type: "module",
            imports: { "#sample": "sample-package" },
          },
          null,
          2,
        )}\n`,
      );
      await writeFixtureFile(
        rootPath,
        "tsconfig.json",
        `${JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" } }, null, 2)}\n`,
      );
      await writePackage(
        rootPath,
        "require-only-package",
        { exports: { require: "./require.cjs" } },
        { "require.cjs": "module.exports = true;\n" },
      );
      await writePackage(
        rootPath,
        "types-only-package",
        { exports: { types: "./index.d.ts" } },
        { "index.d.ts": "export interface Shape { value: boolean }\n" },
      );
      await writePackage(
        rootPath,
        "sample-package",
        { exports: "./index.js", type: "module" },
        { "index.js": "export default true;\n" },
      );
      await writeFixtureFile(
        rootPath,
        "src/index.cts",
        [
          'import required from "require-only-package";',
          'import type { Shape } from "types-only-package";',
          'import sample from "#sample";',
          "export const value: Shape = { value: required && sample };",
          "",
        ].join("\n"),
      );

      const graph = await generateJsModuleDependencyGraph({
        scopePath: rootPath,
        sourcePaths: ["src"],
        tsConfigPath: "tsconfig.json",
      });

      expect(
        graph.nodes
          .filter(({ kind }) => kind === "External package")
          .map(({ id }) => id)
          .toSorted(),
      ).toEqual(["external:require-only-package", "external:sample-package", "external:types-only-package"]);
      expect(graph.edges).toContainEqual(
        expect.objectContaining({
          source: "file:src/index.cts",
          target: "external:types-only-package",
          kind: "type-only",
        }),
      );
    });
  });

  it("includes JSDoc type imports as type-only dependencies", async () => {
    await withFixture(async (rootPath) => {
      await writeFixtureFile(
        rootPath,
        "src/index.js",
        '/** @type {import("./types.js").Shape} */\nexport const value = { enabled: true };\n',
      );
      await writeFixtureFile(rootPath, "src/types.js", "export {};\n");

      const graph = await generateJsModuleDependencyGraph({ scopePath: rootPath, sourcePaths: ["src"] });

      expect(graph.edges).toContainEqual(
        expect.objectContaining({
          source: "file:src/index.js",
          target: "file:src/types.js",
          kind: "type-only",
        }),
      );
    });
  });

  it("rejects source and tsconfig symlinks that escape the scope", async () => {
    await withFixture(async (rootPath) => {
      const outsideRoot = await mkdtemp(join(tmpdir(), "architecture-companion-outside-scope-"));

      try {
        await writeFixtureFile(rootPath, "src/index.ts", "export const value = true;\n");
        await writeFixtureFile(outsideRoot, "outside.ts", "export const outside = true;\n");
        await writeFixtureFile(outsideRoot, "tsconfig.json", "{}\n");
        await symlink(join(outsideRoot, "outside.ts"), join(rootPath, "src", "leak.ts"));
        await symlink(join(outsideRoot, "tsconfig.json"), join(rootPath, "tsconfig.json"));

        await expect(
          generateJsModuleDependencyGraph({ scopePath: rootPath, sourcePaths: ["src"], tsConfigPath: "tsconfig.json" }),
        ).rejects.toThrow("TypeScript config must stay within the scope");

        await rm(join(rootPath, "tsconfig.json"));
        await expect(generateJsModuleDependencyGraph({ scopePath: rootPath, sourcePaths: ["src"] })).rejects.toThrow(
          "Source path resolves outside the scope",
        );
      } finally {
        await rm(outsideRoot, { recursive: true });
      }
    });
  });

  it("keeps distinct dependencies when file names contain edge delimiters", async () => {
    await withFixture(async (rootPath) => {
      await writeFixtureFile(rootPath, "src/a.ts", 'import "./b.ts->file:src/c.js";\n');
      await writeFixtureFile(rootPath, "src/b.ts->file:src/c.ts", "export {};\n");
      await writeFixtureFile(rootPath, "src/a.ts->file:src/b.ts", 'import "../c.js";\n');
      await writeFixtureFile(rootPath, "src/c.ts", "export {};\n");

      const graph = await generateJsModuleDependencyGraph({ scopePath: rootPath, sourcePaths: ["src"] });
      const collidingEdges = graph.edges.filter(({ source }) =>
        ["file:src/a.ts", "file:src/a.ts->file:src/b.ts"].includes(source),
      );

      expect(collidingEdges).toHaveLength(2);
      expect(collidingEdges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "file:src/a.ts",
            target: "file:src/b.ts->file:src/c.ts",
          }),
          expect.objectContaining({
            source: "file:src/a.ts->file:src/b.ts",
            target: "file:src/c.ts",
          }),
        ]),
      );
    });
  });

  it("does not change the process working directory while resolving tsconfig paths", async () => {
    await withFixture(async (rootPath) => {
      await writeFixtureFile(
        rootPath,
        "tsconfig.json",
        `${JSON.stringify({ compilerOptions: { paths: { "@/*": ["src/*"] } } }, null, 2)}\n`,
      );
      await writeFixtureFile(rootPath, "src/index.ts", 'import "@/value";\n');
      await writeFixtureFile(rootPath, "src/value.ts", "export const value = true;\n");
      const changeWorkingDirectory = vi.spyOn(process, "chdir");

      try {
        await generateJsModuleDependencyGraph({
          scopePath: rootPath,
          sourcePaths: ["src"],
          tsConfigPath: "tsconfig.json",
        });
        expect(changeWorkingDirectory).not.toHaveBeenCalled();
      } finally {
        changeWorkingDirectory.mockRestore();
      }
    });
  });

  it("returns deterministic graph data and writes only the graph candidate to a temporary file", async () => {
    await withFixture(async (rootPath) => {
      await writeFixtureFile(rootPath, "src/index.js", 'import { value } from "./value.js";\nexport { value };\n');
      await writeFixtureFile(rootPath, "src/value.js", "export const value = 1;\n");
      const options = { scopePath: rootPath, sourcePaths: ["src"] } as const;

      const [firstGraph, secondGraph] = await Promise.all([
        generateJsModuleDependencyGraph(options),
        generateJsModuleDependencyGraph(options),
      ]);
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
      expect(writtenGraph).not.toHaveProperty("generatorId");
      expect(writtenGraph).not.toHaveProperty("layout");
    });
  });
});
