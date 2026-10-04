import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { version as fallbackVersion } from "typescript/package.json";

import type { DiagramGraph } from "@/features/diagram/diagram-graph";

import { buildComponentGraph } from "./build-component-graph";

const compilerPath = createRequire(import.meta.url).resolve("typescript");
const typescriptRoot = dirname(dirname(compilerPath));
const fallbackInstaller = `
  const { cpSync } = require("node:fs");
  const { join } = require("node:path");
  if (!process.argv.includes(${JSON.stringify(`typescript@${fallbackVersion}`)})) process.exit(1);
  cpSync(${JSON.stringify(typescriptRoot)}, join(process.cwd(), "node_modules/typescript"), { recursive: true });
`;

function fallbackCachePath(): string {
  const user = createHash("sha256").update(homedir()).digest("hex").slice(0, 16);
  return join(tmpdir(), `architecture-companion-typescript-${user}`, fallbackVersion);
}

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
  return graph.edges.map(({ source, target }) => ({
    source: titlesById.get(source),
    target: titlesById.get(target),
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
      expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Child" }]);
    });
  });

  it("uses a reusable fallback without changing the target dependencies", async () => {
    const packageContents = JSON.stringify({ name: "target-project", private: true });
    await withFixture(
      { "package.json": packageContents, "src/app.tsx": arraySource.replace(".map(", ".flatMap(") },
      async (scopePath) => {
        await rm(join(scopePath, "node_modules"), { recursive: true });
        await withNpmFixture(scopePath, fallbackInstaller, async () => {
          const run = () => buildComponentGraph({ scopePath, sourcePaths: ["src"], rootPatterns: ["App"] });
          const [first, concurrent] = await Promise.all([run(), run()]);
          expect(edgeFacts(first)).toEqual([{ source: "App", target: "Child" }]);
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

  it.each(["package metadata", "compiler entry", "standard declarations"])(
    "recovers and reuses a fallback without %s",
    async (missing) => {
      await withFixture({ "src/app.tsx": arraySource }, async (scopePath) => {
        await rm(join(scopePath, "node_modules"), { recursive: true });
        await withNpmFixture(scopePath, fallbackInstaller, async () => {
          const packagePath = join(fallbackCachePath(), "node_modules/typescript");
          await mkdir(join(packagePath, "lib"), { recursive: true });
          if (missing !== "package metadata") {
            await copyFile(join(typescriptRoot, "package.json"), join(packagePath, "package.json"));
          }
          if (missing === "standard declarations") {
            await copyFile(compilerPath, join(packagePath, "lib/typescript.js"));
          }

          const options = { scopePath, sourcePaths: ["src"], rootPatterns: ["App"] };
          const graph = await buildComponentGraph(options);
          expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Child" }]);

          await writeFile(join(scopePath, "bin/npm-fixture.cjs"), `process.exit(1);`);
          expect(await buildComponentGraph(options)).toEqual(graph);
        });
      });
    },
  );

  it("shares a repaired fallback between concurrent analysis processes", async () => {
    await withFixture({ "src/app.tsx": arraySource }, async (scopePath) => {
      await rm(join(scopePath, "node_modules"), { recursive: true });
      const installer = `
        const { closeSync, openSync } = require("node:fs");
        closeSync(openSync(require("node:path").join(process.env.TMPDIR, "installation.claim"), "wx"));
        setTimeout(() => { ${fallbackInstaller} }, 500);
      `;
      await withNpmFixture(scopePath, installer, async () => {
        await mkdir(join(fallbackCachePath(), "node_modules/typescript/lib"), { recursive: true });
        const runnerPath = join(scopePath, "analyze.mts");
        const builderUrl = pathToFileURL(join(import.meta.dirname, "build-component-graph.ts")).href;
        await writeFile(
          runnerPath,
          `
          import { buildComponentGraph } from ${JSON.stringify(builderUrl)};
          const graph = await buildComponentGraph({
            scopePath: ${JSON.stringify(scopePath)}, sourcePaths: ["src"], rootPatterns: ["App"],
          });
          process.stdout.write(JSON.stringify(graph));
        `,
        );
        const run = () => promisify(execFile)(process.execPath, ["--import", "tsx", runnerPath]);
        const results = await Promise.allSettled([run(), run()]);
        for (const result of results) {
          if (result.status === "rejected") throw result.reason;
          expect(edgeFacts(JSON.parse(result.value.stdout) as DiagramGraph)).toEqual([
            { source: "App", target: "Child" },
          ]);
        }
      });
    });
  });

  it("can retry fallback installation after an installer failure", async () => {
    await withFixture({ "src/app.tsx": arraySource }, async (scopePath) => {
      await rm(join(scopePath, "node_modules"), { recursive: true });
      await withNpmFixture(scopePath, `process.exit(1);`, async () => {
        await mkdir(join(fallbackCachePath(), "node_modules/typescript/lib"), { recursive: true });
        const options = { scopePath, sourcePaths: ["src"], rootPatterns: ["App"] };
        await expect(buildComponentGraph(options)).rejects.toThrow("Cannot install fallback TypeScript");

        await writeFile(join(scopePath, "bin/npm-fixture.cjs"), fallbackInstaller);
        expect(edgeFacts(await buildComponentGraph(options))).toEqual([{ source: "App", target: "Child" }]);
      });
    });
  });

  it("reports an installation lock timeout instead of waiting indefinitely", async () => {
    await withFixture({ "src/app.tsx": arraySource }, async (scopePath) => {
      await rm(join(scopePath, "node_modules"), { recursive: true });
      await withNpmFixture(scopePath, `process.exit(1);`, async () => {
        await mkdir(`${fallbackCachePath()}.lock`, { recursive: true, mode: 0o700 });
        const clock = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(120_000);
        try {
          await expect(buildComponentGraph({ scopePath, sourcePaths: ["src"] })).rejects.toThrow(
            "Timed out waiting for TypeScript temporary installation lock",
          );
        } finally {
          clock.mockRestore();
        }
      });
    });
  });

  it.each(["root", "version"])("rejects a symlinked fallback cache %s", async (kind) => {
    await withFixture({ "src/app.tsx": arraySource }, async (scopePath) => {
      await rm(join(scopePath, "node_modules"), { recursive: true });
      await withNpmFixture(scopePath, `process.exit(1);`, async () => {
        const otherCache = join(scopePath, "other-cache");
        await mkdir(join(otherCache, "node_modules"), { recursive: true });
        await symlink(typescriptRoot, join(otherCache, "node_modules/typescript"), "junction");
        const cachePath = fallbackCachePath();
        const linkPath = kind === "root" ? dirname(cachePath) : cachePath;
        await mkdir(dirname(linkPath), { recursive: true, mode: 0o700 });
        await symlink(otherCache, linkPath, "junction");

        await expect(buildComponentGraph({ scopePath, sourcePaths: ["src"] })).rejects.toThrow(
          "Unsafe TypeScript temporary cache directory",
        );
      });
    });
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
