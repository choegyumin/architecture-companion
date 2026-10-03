import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import type { DiagramGraph } from "@/features/diagram/diagram-graph";

import { buildComponentGraph } from "./build-component-graph";

const compilerPath = createRequire(import.meta.url).resolve("typescript");

async function withFixture(
  files: Readonly<Record<string, string>>,
  run: (scopePath: string) => Promise<void>,
): Promise<void> {
  const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-react-compiler-"));
  try {
    await Promise.all(
      Object.entries(files).map(async ([relativePath, content]) => {
        const filePath = join(scopePath, relativePath);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content);
      }),
    );
    await mkdir(join(scopePath, "node_modules"), { recursive: true });
    if (!Object.keys(files).some((path) => path.startsWith("node_modules/typescript/"))) {
      await symlink(dirname(dirname(compilerPath)), join(scopePath, "node_modules/typescript"), "junction");
    }
    await run(scopePath);
  } finally {
    await rm(scopePath, { recursive: true });
  }
}

function edgeFacts(graph: DiagramGraph) {
  const titlesById = new Map(graph.nodes.map(({ id, title }) => [id, title]));
  return graph.edges.map(({ source, target, kind }) => ({
    source: titlesById.get(source),
    target: titlesById.get(target),
    kind,
  }));
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

const arraySource = `
  export function Child() { return <span />; }
  export function App() { return [1, 2].map(() => <Child />); }
`;

describe("React component structure compiler", () => {
  it("keeps flatMap rendering without a tsconfig", async () => {
    await withFixture({ "src/app.tsx": arraySource.replace(".map(", ".flatMap(") }, async (scopePath) => {
      const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"], rootPatterns: ["App"] });
      expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Child", kind: "direct-render" }]);
    });
  });

  it("uses a reusable fallback without changing the target dependencies", async () => {
    const packageContents = JSON.stringify({ name: "target-project", private: true });
    await withFixture(
      { "package.json": packageContents, "src/app.tsx": arraySource.replace(".map(", ".flatMap(") },
      async (scopePath) => {
        await rm(join(scopePath, "node_modules"), { recursive: true });
        const typescriptRoot = dirname(dirname(compilerPath));
        const version = JSON.parse(await readFile(join(typescriptRoot, "package.json"), "utf8")).version;
        const installer = `
          const { cpSync } = require("node:fs");
          const { join } = require("node:path");
          if (!process.argv.includes(${JSON.stringify(`typescript@${version}`)})) process.exit(1);
          cpSync(${JSON.stringify(typescriptRoot)}, join(process.cwd(), "node_modules/typescript"), { recursive: true });
        `;
        await withNpmFixture(scopePath, installer, async () => {
          const run = () => buildComponentGraph({ scopePath, sourcePaths: ["src"], rootPatterns: ["App"] });
          const [first, concurrent] = await Promise.all([run(), run()]);
          expect(edgeFacts(first)).toEqual([{ source: "App", target: "Child", kind: "direct-render" }]);
          expect(concurrent).toEqual(first);
          await writeFile(join(scopePath, "bin/npm-fixture.cjs"), `process.exit(1);`);
          expect(await run()).toEqual(first);
          expect(await readFile(join(scopePath, "package.json"), "utf8")).toBe(packageContents);
          await expect(readFile(join(scopePath, "node_modules/typescript/package.json"))).rejects.toMatchObject({
            code: "ENOENT",
          });
        });
      },
    );
  });

  it.each([
    { compilerOptions: { noLib: true }, error: "Cannot find global type" },
    { compilerOptions: { types: ["vitest/globals"] }, error: "Cannot find type definition file for 'vitest/globals'" },
  ])("rejects analysis initialization failures: $error", async ({ compilerOptions, error }) => {
    await withFixture(
      {
        "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "preserve", ...compilerOptions } }),
        "src/app.tsx": arraySource,
      },
      async (scopePath) => {
        await expect(buildComponentGraph({ scopePath, sourcePaths: ["src"] })).rejects.toThrow(error);
      },
    );
  });

  it("does not borrow fallback declarations when the target compiler package is incomplete", async () => {
    await withFixture(
      {
        "node_modules/typescript/package.json": JSON.stringify({ name: "typescript", main: "lib/typescript.js" }),
        "src/app.tsx": arraySource,
      },
      async (scopePath) => {
        const targetCompilerPath = join(scopePath, "node_modules/typescript/lib/typescript.js");
        await mkdir(dirname(targetCompilerPath), { recursive: true });
        await copyFile(compilerPath, targetCompilerPath);

        await expect(buildComponentGraph({ scopePath, sourcePaths: ["src"] })).rejects.toThrow(
          join("node_modules", "typescript", "lib", "lib.esnext.full.d.ts"),
        );
      },
    );
  });
});
