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
