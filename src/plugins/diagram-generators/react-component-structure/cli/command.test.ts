import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

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

  it("installs fallback outside the scope and reuses it without npm on later runs", async () => {
    const packageContents = JSON.stringify({ name: "target-project", private: true });
    await withFixture(
      {
        "package.json": packageContents,
        "src/app.tsx": `
          const items: readonly number[] = [1, 2];
          export function Child() { return <span />; }
          export function App() { return items.map(() => <Child />); }
        `,
      },
      async (scopePath) => {
        await rm(join(scopePath, "node_modules"), { recursive: true });
        const typescriptRoot = dirname(dirname(createRequire(import.meta.url).resolve("typescript")));
        const version = JSON.parse(await readFile(join(typescriptRoot, "package.json"), "utf8")).version;
        const installer = `
          const { cpSync } = require("node:fs");
          const { join } = require("node:path");
          if (!process.argv.includes(${JSON.stringify(`typescript@${version}`)})) process.exit(1);
          cpSync(${JSON.stringify(typescriptRoot)}, join(process.cwd(), "node_modules/typescript"), { recursive: true });
          process.stdout.write("npm installation output\\n");
        `;
        await withNpmFixture(scopePath, installer, async () => {
          const outputs: string[] = [];
          const graphPaths: string[] = [];
          const run = async () => {
            const graphPath = await executeReactComponentStructureCommand(
              ["--base", scopePath, "--root", "App", "src"],
              { writeStdout: (output) => outputs.push(output) },
            );
            graphPaths.push(graphPath);
            return JSON.parse(await readFile(graphPath, "utf8")) as DiagramGraph;
          };
          try {
            const [first, concurrent] = await Promise.all([run(), run()]);
            expect(first.edges).toEqual([
              expect.objectContaining({
                source: "component:src/app.tsx#App",
                target: "component:src/app.tsx#Child",
                kind: "direct-render",
              }),
            ]);
            expect(concurrent).toEqual(first);
            await writeFile(join(scopePath, "bin/npm-fixture.cjs"), `process.exit(1);`);
            expect(await run()).toEqual(first);
            expect(outputs.map((output) => JSON.parse(output).graphPath).toSorted()).toEqual(graphPaths.toSorted());
            expect(await readFile(join(scopePath, "package.json"), "utf8")).toBe(packageContents);
            await expect(readFile(join(scopePath, "node_modules/typescript/package.json"))).rejects.toMatchObject({
              code: "ENOENT",
            });
          } finally {
            await Promise.all(graphPaths.map((path) => rm(dirname(path), { recursive: true })));
          }
        });
      },
    );
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
