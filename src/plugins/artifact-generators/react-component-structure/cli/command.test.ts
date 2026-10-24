import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import type z from "zod";

import { componentStructureDiagramGraphSchema } from "@/features/diagram/diagram-graph";

import { executeReactComponentStructureCommand } from "./command";

type ComponentGraphInput = z.input<typeof componentStructureDiagramGraphSchema>;

async function withFixture(
  files: Readonly<Record<string, string>>,
  run: (scopePath: string) => Promise<void>,
): Promise<void> {
  const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-react-components-"));

  try {
    await Promise.all(
      Object.entries({
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            allowJs: true,
            baseUrl: ".",
            jsx: "preserve",
            module: "ESNext",
            moduleResolution: "Bundler",
            paths: { "@/*": ["src/*"] },
            skipLibCheck: true,
            target: "ESNext",
          },
        }),
        ...files,
      }).map(async ([relativePath, content]) => {
        const filePath = join(scopePath, relativePath);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content);
      }),
    );
    await mkdir(join(scopePath, "node_modules"), { recursive: true });
    await symlink(
      dirname(dirname(createRequire(import.meta.url).resolve("typescript"))),
      join(scopePath, "node_modules/typescript"),
      "junction",
    );
    await run(scopePath);
  } finally {
    await rm(scopePath, { recursive: true });
  }
}

async function withNpmFixture(scopePath: string, source: string, run: () => Promise<void>): Promise<void> {
  const binPath = join(scopePath, "bin");
  const temporaryPath = join(scopePath, "temporary");
  await mkdir(binPath);
  await mkdir(temporaryPath);
  const scriptPath = join(binPath, "npm-fixture.cjs");
  await writeFile(scriptPath, source);
  const commandPath = join(binPath, process.platform === "win32" ? "npm.cmd" : "npm");
  await writeFile(
    commandPath,
    process.platform === "win32"
      ? `@"${process.execPath}" "${scriptPath}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`,
  );
  await chmod(commandPath, 0o755);
  vi.stubEnv("PATH", `${binPath}${delimiter}${process.env.PATH ?? ""}`);
  for (const name of ["TMPDIR", "TEMP", "TMP"]) vi.stubEnv(name, temporaryPath);
  try {
    await run();
  } finally {
    vi.unstubAllEnvs();
  }
}

describe("React component structure command", () => {
  it("fails without a graph candidate when fallback installation fails", async () => {
    await withFixture({ "src/app.tsx": `export function App() { return <main />; }` }, async (scopePath) => {
      await rm(join(scopePath, "node_modules/typescript"), { recursive: true });
      await withNpmFixture(scopePath, `process.stderr.write("registry unavailable\\n"); process.exit(1);`, async () => {
        const outputs: string[] = [];
        await expect(
          executeReactComponentStructureCommand(["--base", scopePath, "src"], {
            writeStdout: (output) => outputs.push(output),
          }),
        ).rejects.toThrow("Cannot install fallback TypeScript");
        expect(outputs).toEqual([]);
      });
    });
  });

  it("rejects caller-selected output paths", async () => {
    await withFixture({ "src/app.tsx": `export function App() { return <main />; }` }, async (scopePath) => {
      const outputs: string[] = [];

      await expect(
        executeReactComponentStructureCommand(["--base", scopePath, "src", "--output", "tracked.json"], {
          writeStdout: (output) => outputs.push(output),
        }),
      ).rejects.toThrow("Unknown argument: --output");
      expect(outputs).toEqual([]);
    });
  });

  it("writes only a graph candidate to a temporary file through the command seam", async () => {
    await withFixture({ "src/app.tsx": `export function App() { return <main />; }` }, async (scopePath) => {
      const outputs: string[] = [];
      const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, "src"], {
        writeStdout: (output) => outputs.push(output),
      });

      try {
        const graph = JSON.parse(await readFile(graphPath, "utf8")) as ComponentGraphInput;
        expect(outputs).toEqual([`${JSON.stringify({ graphPath: graphPath })}\n`]);
        expect(graph).toEqual({
          groups: [],
          nodes: [
            expect.objectContaining({
              title: "App",
              layoutContext: { definitionId: "component:src/app.tsx#App", origins: [] },
            }),
          ],
          edges: [],
          layoutContext: { rootNodeIds: ["component:src/app.tsx#App"], controls: [] },
        });
        expect(graph.nodes.at(0)).not.toHaveProperty("kind");
      } finally {
        await rm(dirname(graphPath), { recursive: true });
      }
    });
  });

  it("omits stored defaults while preserving branch and prerequisite semantics", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          function Plain() { return <main />; }
          function First() { return <span />; }
          function Second() { return <aside />; }
          function Chooser({ mode }) {
            switch (mode) {
              case "first": return <First />;
              case "second": return <Second />;
              default: return <Plain />;
            }
          }
          export function App({ enabled, choice, mode }) {
            return <><Plain /><Chooser mode={mode} />{enabled && (choice ? <First /> : <Second />)}</>;
          }
        `,
      },
      async (scopePath) => {
        const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, "src"], {
          writeStdout: () => undefined,
        });
        try {
          const graph = JSON.parse(await readFile(graphPath, "utf8")) as ComponentGraphInput;
          const parsed = componentStructureDiagramGraphSchema.parse(graph);
          expect(graph.nodes.every((node) => node.type === undefined)).toBe(true);
          expect(graph.edges.some((edge) => edge.type === undefined)).toBe(true);
          expect(graph.edges.some((edge) => edge.type === "control")).toBe(true);
          expect(graph.edges.every((edge) => edge.layoutContext === undefined)).toBe(true);
          expect(graph.layoutContext).not.toHaveProperty("auxiliaryDefinitions");
          expect(graph.layoutContext.controls.find(({ label }) => label === "enabled")).not.toHaveProperty("dependsOn");
          expect(graph.layoutContext.controls.find(({ label }) => label === "mode")).not.toHaveProperty("polarityPair");
          expect(graph.layoutContext.controls.find(({ label }) => label === "choice")).toMatchObject({
            polarityPair: true,
            dependsOn: [[{ controlId: expect.any(String), value: "on" }]],
          });
          expect(parsed.nodes.every((node) => node.type === "default")).toBe(true);
          expect(parsed.edges.every((edge) => edge.layoutContext.composition === null)).toBe(true);
          expect(parsed.layoutContext.auxiliaryDefinitions).toEqual([]);
          expect(parsed.layoutContext.controls.find(({ label }) => label === "enabled")).toMatchObject({
            dependsOn: [[]],
          });
          expect(parsed.layoutContext.controls.find(({ label }) => label === "mode")).toMatchObject({
            polarityPair: false,
          });
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it.each([2, 8])(
    "preserves rendering paths in a chain of %i branches that reuses a condition",
    async (branchCount) => {
      await withFixture(
        {
          "src/app.tsx": `
          ${Array.from({ length: branchCount }, (_, index) => `function View${index + 1}() { return <span />; }`).join("\n")}
          function Fallback() { return <footer />; }
          export function App({ a, b, c, d, e, f, g, h }: Record<string, boolean>) {
            if (a && b) return <View1 />;
            else if (a) return <View2 />;
            ${["c", "d", "e", "f", "g", "h"]
              .slice(0, branchCount - 2)
              .map((condition, index) => `else if (${condition}) return <View${index + 3} />;`)
              .join("\n")}
            return <Fallback />;
          }
        `,
          "src/healthy.tsx": `
          function Leaf() { return <main />; }
          export function Healthy() { return <Leaf />; }
        `,
        },
        async (scopePath) => {
          const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, "src"], {
            writeStdout: () => undefined,
          });
          try {
            const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
            expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual([
              "App",
              "Fallback",
              "Healthy",
              "Leaf",
              ...Array.from({ length: branchCount }, (_, index) => `View${index + 1}`),
            ]);
            const app = graph.nodes.find(({ title }) => title === "App")!;
            const controls = graph.layoutContext.controls;
            const names = ["a", "b", "c", "d", "e", "f", "g", "h"].slice(0, branchCount);
            for (let bits = 0; bits < 2 ** branchCount; bits += 1) {
              const input = Object.fromEntries(names.map((name, index) => [name, Boolean(bits & (1 << index))]));
              const choices = new Map(
                controls.map((control) => {
                  expect(names).toContain(control.label);
                  const enabled = input[control.label];
                  const value =
                    control.type === "conditional"
                      ? enabled
                        ? "on"
                        : "off"
                      : control.cases.find(({ label }) => label === (enabled ? control.label : `!${control.label}`))!
                          .caseId;
                  return [control.controlId, value];
                }),
              );
              const targets = new Set(
                graph.edges
                  .filter(
                    (edge) =>
                      edge.sourceNodeId === app.nodeId &&
                      (edge.type !== "control" ||
                        edge.activeWhen.some((rule) =>
                          rule.every(({ controlId, value }) => choices.get(controlId) === value),
                        )),
                  )
                  .map(({ targetNodeId }) => graph.nodes.find(({ nodeId }) => nodeId === targetNodeId)!.title),
              );
              const expected =
                input.a && input.b
                  ? "View1"
                  : input.a
                    ? "View2"
                    : input.c
                      ? "View3"
                      : input.d
                        ? "View4"
                        : input.e
                          ? "View5"
                          : input.f
                            ? "View6"
                            : input.g
                              ? "View7"
                              : input.h
                                ? "View8"
                                : "Fallback";
              expect({ input, targets: [...targets] }).toEqual({ input, targets: [expected] });
            }
          } finally {
            await rm(dirname(graphPath), { recursive: true });
          }
        },
      );
    },
  );

  it.each([
    {
      kind: "direct",
      body: "if (ready) return <First />; else if (ready) return <Unreachable />; return <Fallback />;",
      titles: ["App", "Fallback", "First"],
    },
    {
      kind: "supplied",
      body: "return <Receiver>{ready ? <First /> : ready ? <Unreachable /> : <Fallback />}</Receiver>;",
      titles: ["App", "Fallback", "First", "Receiver"],
    },
  ])("omits unreachable $kind targets when a branch repeats an earlier condition", async ({ body, titles }) => {
    await withFixture(
      {
        "src/app.tsx": `
          function First() { return <span />; }
          function Unreachable() { return <aside />; }
          function Fallback() { return <footer />; }
          function Receiver({ children }) { return <>{children}</>; }
          export function App({ ready }) { ${body} }
        `,
      },
      async (scopePath) => {
        const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, "src", "--root", "App"], {
          writeStdout: () => undefined,
        });
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(titles);
          const ready = graph.layoutContext.controls.find(({ label }) => label === "ready")!;
          for (const [title, value] of [
            ["First", "ready"],
            ["Fallback", "!ready"],
          ]) {
            const target = graph.nodes.find((node) => node.title === title)!;
            expect(graph.edges.filter(({ targetNodeId }) => targetNodeId === target.nodeId)).toEqual([
              expect.objectContaining({ type: "control", activeWhen: [[{ controlId: ready.controlId, value }]] }),
            ]);
          }
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("applies --root through the command seam", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { Layout } from "./layout";

          export function App() {
            return <Layout />;
          }
        `,
        "src/layout.tsx": `
          import { Content } from "./content";

          export function Layout() {
            return <section><Content /></section>;
          }
        `,
        "src/content.tsx": `export function Content() { return <main>Content</main>; }`,
      },
      async (scopePath) => {
        const graphPath = await executeReactComponentStructureCommand(
          ["--base", scopePath, "src", "--root", "Layout"],
          {
            writeStdout: () => undefined,
          },
        );

        try {
          const graph = JSON.parse(await readFile(graphPath, "utf8")) as ComponentGraphInput;
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["Content", "Layout"]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });
});
