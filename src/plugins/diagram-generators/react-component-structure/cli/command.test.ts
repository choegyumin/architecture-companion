import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { DiagramGraph } from "@/features/diagram/diagram-graph";

import { executeReactComponentStructureCommand } from "./command";

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
    await run(scopePath);
  } finally {
    await rm(scopePath, { recursive: true });
  }
}

describe("React component structure command", () => {
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
        const graph = JSON.parse(await readFile(graphPath, "utf8")) as DiagramGraph;
        expect(outputs).toEqual([`${JSON.stringify({ graphPath: graphPath })}\n`]);
        expect(graph).toEqual({
          groups: [],
          nodes: [expect.objectContaining({ type: "default", title: "App" })],
          edges: [],
        });
        expect(graph.nodes.at(0)).not.toHaveProperty("kind");
      } finally {
        await rm(dirname(graphPath), { recursive: true });
      }
    });
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
          const graph = JSON.parse(await readFile(graphPath, "utf8")) as DiagramGraph;
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["Content", "Layout"]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });
});
