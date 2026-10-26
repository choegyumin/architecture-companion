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

  it("connects resolved local references outside collection without analyzing their implementations", async () => {
    await withFixture(
      {
        "src/pages/app.tsx": `
          import { AliasPanel } from "@/shared/alias-panel";
          import RelativePanel from "../shared/relative-panel";
          export function App() { return <><AliasPanel /><RelativePanel /></>; }
        `,
        "src/shared/alias-panel.tsx": `
          import { DeepLeaf } from "./deep-leaf";
          export function AliasPanel() { return <DeepLeaf />; }
          export function Unused() { return <aside />; }
        `,
        "src/shared/relative-panel.tsx": `export default function RelativePanel() { return <footer />; }`,
        "src/shared/deep-leaf.tsx": `export function DeepLeaf() { return <span />; }`,
      },
      async (scopePath) => {
        const outputs: string[] = [];
        const warnings: string[] = [];
        const graphPath = await executeReactComponentStructureCommand(
          ["--base", scopePath, "src/pages", "--root", "App"],
          {
            writeStdout: (output) => outputs.push(output),
            writeStderr: (output) => warnings.push(output),
          },
        );
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["AliasPanel", "App", "RelativePanel"]);
          expect(graph.edges.map(({ sourceNodeId, targetNodeId }) => [sourceNodeId, targetNodeId]).toSorted()).toEqual([
            ["component:src/pages/app.tsx#App", "component:src/shared/alias-panel.tsx#AliasPanel"],
            ["component:src/pages/app.tsx#App", "component:src/shared/relative-panel.tsx#RelativePanel"],
          ]);
          expect(graph.nodes.find(({ title }) => title === "AliasPanel")).toMatchObject({
            description: "src/shared/alias-panel.tsx\nOutside collection scope; internals not analyzed.",
            links: [{ href: "source:///src/shared/alias-panel.tsx" }],
            layoutContext: { definitionId: "component:src/shared/alias-panel.tsx#AliasPanel", origins: [] },
          });
          expect(graph.layoutContext).toMatchObject({ rootNodeIds: ["component:src/pages/app.tsx#App"], controls: [] });
          expect(outputs).toEqual([`${JSON.stringify({ graphPath })}\n`]);
          expect(warnings).toEqual([]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it.each<{ name: string; files: Record<string, string>; paths: string[]; expected: string[] }>([
    {
      name: "an ignored ancestor directory",
      files: { ".gitignore": "src/shared/\n" },
      paths: ["src/pages"],
      expected: ["App"],
    },
    {
      name: "a nested ignore rule",
      files: { "src/shared/.gitignore": "src/shared/panel.tsx\n" },
      paths: ["src/pages"],
      expected: ["App"],
    },
    {
      name: "an ignored parent that its own rules cannot re-include",
      files: { ".gitignore": "src/shared/\n", "src/shared/.gitignore": "!src/shared/\n!src/shared/panel.tsx\n" },
      paths: ["src/pages"],
      expected: ["App"],
    },
    {
      name: "a later re-inclusion",
      files: { ".gitignore": "src/shared/*\n!src/shared/panel.tsx\n" },
      paths: ["src/pages"],
      expected: ["App", "Panel"],
    },
    {
      name: "an explicit ignored file",
      files: { ".gitignore": "src/shared/\n" },
      paths: ["src/pages", "src/shared/panel.tsx"],
      expected: ["App", "Leaf", "Panel"],
    },
  ])("preserves collection exclusion priority for $name", async ({ files, paths, expected }) => {
    await withFixture(
      {
        ...files,
        "src/pages/app.tsx": `import { Panel } from "../shared/panel"; export function App() { return <Panel />; }`,
        "src/shared/panel.tsx": `function Leaf() { return <span />; } export function Panel() { return <Leaf />; }`,
      },
      async (scopePath) => {
        const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, ...paths], {
          writeStdout: () => undefined,
        });
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(expected);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it.each([
    { flags: [], visible: true },
    { flags: ["--exclude-path", "src/shared/"], visible: false },
    { flags: ["--exclude-component", "Panel"], visible: false },
    { flags: ["--exclude-path", "src/shared/*", "--exclude-path", "!src/shared/panel.tsx"], visible: true },
  ])(
    "applies display filters to an uncollected boundary without losing supplied composition: $flags",
    async ({ flags, visible }) => {
      await withFixture(
        {
          "src/app.tsx": `
          import { Panel } from "./shared/panel";
          function Content() { return <span />; }
          export function App({ ready }) { return ready ? <Panel header={<Content />} /> : null; }
        `,
          "src/shared/panel.tsx": `
          function Internal() { return <aside />; }
          export function Panel({ header }) { return <><Internal />{header}</>; }
        `,
        },
        async (scopePath) => {
          const graphPath = await executeReactComponentStructureCommand(
            ["--base", scopePath, "src/app.tsx", ...flags],
            {
              writeStdout: () => undefined,
            },
          );
          try {
            const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
            expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(
              visible ? ["App", "Content", "Panel"] : ["App", "Content"],
            );
            const supplied = graph.edges.find(({ targetNodeId }) => targetNodeId === "component:src/app.tsx#Content");
            expect(supplied).toMatchObject({
              sourceNodeId: visible ? "component:src/shared/panel.tsx#Panel" : "component:src/app.tsx#App",
              layoutContext: {
                composition: {
                  type: "node",
                  slot: "header",
                  origins: [{ supplierDefinitionId: "component:src/app.tsx#App", slot: "header" }],
                },
              },
            });
            expect(graph.layoutContext.controls).toHaveLength(1);
            expect(graph.layoutContext.controls.at(0)).toMatchObject({
              ownerNodeId: "component:src/app.tsx#App",
              label: "ready",
            });
            expect(graph.edges.filter(({ type }) => type === "control")).toHaveLength(1);
          } finally {
            await rm(dirname(graphPath), { recursive: true });
          }
        },
      );
    },
  );

  it("connects static wrappers and loaders to uncollected component identities without analyzing their bodies", async () => {
    await withFixture(
      {
        "node_modules/react/index.d.ts": `export function memo<T>(component: T): T;`,
        "node_modules/@loadable/component/index.d.ts": `export default function loadable<T>(load: () => Promise<{ default: T }>): T;`,
        "src/app.tsx": `
          import { memo } from "react";
          import loadable from "@loadable/component";
          import { Card, Part } from "./shared/card";
          const Wrapped = Object.assign(memo(Card), { Sub: Part });
          const Loaded = loadable(() => import("@/shared/panel"));
          export function App() { return <><Wrapped /><Wrapped.Sub /><Loaded /></>; }
        `,
        "src/shared/card.tsx": `
          const Internal = () => <span />;
          export const Card = () => <Internal />;
          export const Part = () => <footer />;
        `,
        "src/shared/panel.tsx": `export default function () { return <article />; }`,
      },
      async (scopePath) => {
        const warnings: string[] = [];
        const graphPath = await executeReactComponentStructureCommand(
          ["--base", scopePath, "src/app.tsx", "--loader", "@loadable/component"],
          {
            writeStdout: () => undefined,
            writeStderr: (output) => warnings.push(output),
          },
        );
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ nodeId }) => nodeId).toSorted()).toEqual([
            "component:src/app.tsx#App",
            "component:src/shared/card.tsx#Card",
            "component:src/shared/card.tsx#Part",
            "component:src/shared/panel.tsx#default",
          ]);
          expect(graph.edges.map(({ targetNodeId }) => targetNodeId).toSorted()).toEqual([
            "component:src/shared/card.tsx#Card",
            "component:src/shared/card.tsx#Part",
            "component:src/shared/panel.tsx#default",
          ]);
          expect(graph.edges.every(({ sourceNodeId }) => sourceNodeId === "component:src/app.tsx#App")).toBe(true);
          expect(warnings).toEqual([]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("keeps unresolved, unsupported, and out-of-base references out of local boundaries while retaining npm boundaries", async () => {
    await withFixture(
      {
        "node_modules/ui-kit/index.d.ts": `export declare function External(): any;`,
        "outside/panel.tsx": `export function Outside() { return <aside />; }`,
        "src/shared.tsx": `
          function helper() { return () => <footer />; }
          export const Unknown = helper();
        `,
        "src/app.tsx": `
          import { External } from "ui-kit";
          import { Missing } from "./missing";
          import { Unknown } from "./shared";
          import { Outside } from "../outside/panel";
          import { Outside as Linked } from "./link";
          export function App() { return <><External /><Missing /><Unknown /><Outside /><Linked /></>; }
        `,
      },
      async (scopePath) => {
        await symlink(join(scopePath, "node_modules"), join(scopePath, "src/node_modules"), "junction");
        await symlink(join(scopePath, "outside/panel.tsx"), join(scopePath, "src/link.tsx"), "file");
        const graphPath = await executeReactComponentStructureCommand(["--base", join(scopePath, "src"), "app.tsx"], {
          writeStdout: () => undefined,
        });
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ nodeId }) => nodeId).toSorted()).toEqual([
            "component:app.tsx#App",
            "external:ui-kit#External",
          ]);
          expect(graph.edges).toHaveLength(1);
          expect(graph.nodes.find(({ title }) => title === "External")).toMatchObject({
            description: "ui-kit boundary",
          });
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("connects a const-bound memo export to its original component and rendering body", async () => {
    await withFixture(
      {
        "node_modules/react/index.d.ts": `export function memo<T>(component: T, compare?: unknown): T;`,
        "src/panel.tsx": `
          import * as React from "react";
          function Leaf() { return <span />; }
          function Panel() { return <Leaf />; }
          const Wrapped = React.memo(Panel);
          export default Wrapped;
        `,
        "src/app.tsx": `
          import Panel from "@/panel";
          export function App() { return <Panel />; }
        `,
      },
      async (scopePath) => {
        const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, "src", "--root", "App"], {
          writeStdout: () => undefined,
        });
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ nodeId }) => nodeId).toSorted()).toEqual([
            "component:src/app.tsx#App",
            "component:src/panel.tsx#Leaf",
            "component:src/panel.tsx#Panel",
          ]);
          expect(graph.edges.map(({ sourceNodeId, targetNodeId }) => [sourceNodeId, targetNodeId]).toSorted()).toEqual([
            ["component:src/app.tsx#App", "component:src/panel.tsx#Panel"],
            ["component:src/panel.tsx#Panel", "component:src/panel.tsx#Leaf"],
          ]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("connects an Object.assign export and only its rendered component members", async () => {
    await withFixture(
      {
        "src/panel.tsx": `
          function Leaf() { return <span />; }
          function Panel() { return <Leaf />; }
          function Sub() { return <aside />; }
          function Unused() { return <footer />; }
          export default Object.assign(Panel, { Sub, Other: Sub, Unused });
        `,
        "src/app.tsx": `
          import Panel from "@/panel";
          export function App() { return <><Panel /><Panel.Sub /><Panel.Other /></>; }
        `,
      },
      async (scopePath) => {
        const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, "src", "--root", "App"], {
          writeStdout: () => undefined,
        });
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ nodeId }) => nodeId).toSorted()).toEqual([
            "component:src/app.tsx#App",
            "component:src/panel.tsx#Leaf",
            "component:src/panel.tsx#Panel",
            "component:src/panel.tsx#Sub",
          ]);
          expect(graph.edges.map(({ sourceNodeId, targetNodeId }) => [sourceNodeId, targetNodeId]).toSorted()).toEqual([
            ["component:src/app.tsx#App", "component:src/panel.tsx#Panel"],
            ["component:src/app.tsx#App", "component:src/panel.tsx#Sub"],
            ["component:src/panel.tsx#Panel", "component:src/panel.tsx#Leaf"],
          ]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it.each(["./panel", "@/panel"])(
    "connects a static loadable import through %s to the collected default component",
    async (specifier) => {
      await withFixture(
        {
          "node_modules/@loadable/component/index.d.ts": `
          export default function loadable<T>(load: () => Promise<{ default: T }>): T;
        `,
          "src/panel.tsx": `
          function Leaf() { return <span />; }
          export default function Panel() { return <Leaf />; }
        `,
          "src/app.tsx": `
          import loadable from "@loadable/component";
          const Loaded = loadable(() => import("${specifier}"));
          export function App() { return <Loaded />; }
        `,
        },
        async (scopePath) => {
          const graphPath = await executeReactComponentStructureCommand(
            ["--base", scopePath, "src", "--root", "App", "--loader", "@loadable/component"],
            {
              writeStdout: () => undefined,
            },
          );
          try {
            const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
            expect(graph.nodes.map(({ nodeId }) => nodeId).toSorted()).toEqual([
              "component:src/app.tsx#App",
              "component:src/panel.tsx#Leaf",
              "component:src/panel.tsx#Panel",
            ]);
            expect(
              graph.edges.map(({ sourceNodeId, targetNodeId }) => [sourceNodeId, targetNodeId]).toSorted(),
            ).toEqual([
              ["component:src/app.tsx#App", "component:src/panel.tsx#Panel"],
              ["component:src/panel.tsx#Panel", "component:src/panel.tsx#Leaf"],
            ]);
          } finally {
            await rm(dirname(graphPath), { recursive: true });
          }
        },
      );
    },
  );

  it("connects a supplied loadable component through a package receiver", async () => {
    await withFixture(
      {
        "node_modules/@loadable/component/index.d.ts": `export default function loadable<T>(load: () => Promise<{ default: T }>): T;`,
        "node_modules/shell-out/index.d.ts": `export function Shell(props: { component: unknown }): null;`,
        "src/panel.tsx": `
          function Leaf() { return <span />; }
          export default function Panel() { return <Leaf />; }
        `,
        "src/app.tsx": `
          import loadable from "@loadable/component";
          import { Shell } from "shell-out";
          const Loaded = loadable(() => import("./panel"));
          export function App() { return <Shell component={Loaded} />; }
        `,
      },
      async (scopePath) => {
        const warnings: string[] = [];
        const graphPath = await executeReactComponentStructureCommand(
          ["--base", scopePath, "src", "--root", "App", "--loader", "@loadable/component"],
          {
            writeStdout: () => undefined,
            writeStderr: (output) => warnings.push(output),
          },
        );
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Leaf", "Panel", "Shell"]);
          const titles = new Map(graph.nodes.map((node) => [node.nodeId, node.title]));
          expect(
            graph.edges
              .map(({ sourceNodeId, targetNodeId }) => `${titles.get(sourceNodeId)} -> ${titles.get(targetNodeId)}`)
              .toSorted(),
          ).toEqual(["App -> Shell", "Panel -> Leaf", "Shell -> Panel"]);
          expect(warnings).toEqual([]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("connects a supplied memoized component through a package receiver", async () => {
    await withFixture(
      {
        "node_modules/react/index.d.ts": `export function memo<T>(component: T): T;`,
        "node_modules/shell-out/index.d.ts": `export function Shell(props: { component: unknown }): null;`,
        "src/panel.tsx": `
          function Leaf() { return <span />; }
          export default function Panel() { return <Leaf />; }
        `,
        "src/app.tsx": `
          import { memo } from "react";
          import Panel from "./panel";
          import { Shell } from "shell-out";
          const Memoized = memo(Panel);
          export function App() { return <Shell component={Memoized} />; }
        `,
      },
      async (scopePath) => {
        const warnings: string[] = [];
        const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, "src", "--root", "App"], {
          writeStdout: () => undefined,
          writeStderr: (output) => warnings.push(output),
        });
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Leaf", "Panel", "Shell"]);
          const titles = new Map(graph.nodes.map((node) => [node.nodeId, node.title]));
          expect(
            graph.edges
              .map(({ sourceNodeId, targetNodeId }) => `${titles.get(sourceNodeId)} -> ${titles.get(targetNodeId)}`)
              .toSorted(),
          ).toEqual(["App -> Shell", "Panel -> Leaf", "Shell -> Panel"]);
          expect(warnings).toEqual([]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("connects a declared hoc result to its original component", async () => {
    await withFixture(
      {
        "node_modules/router-hoc/index.d.ts": `export declare function withRouter<T>(component: T): T;`,
        "src/login.tsx": `
          import { withRouter } from "router-hoc";
          function RawLogin() { return <form />; }
          const Login = withRouter(RawLogin);
          export default Login;
        `,
        "src/app.tsx": `
          import Login from "./login";
          export function App() { return <Login />; }
        `,
      },
      async (scopePath) => {
        const undeclaredPath = await executeReactComponentStructureCommand(
          ["--base", scopePath, "src", "--root", "App"],
          { writeStdout: () => undefined },
        );
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(undeclaredPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title)).toEqual(["App"]);
          expect(graph.edges).toEqual([]);
        } finally {
          await rm(dirname(undeclaredPath), { recursive: true });
        }

        const warnings: string[] = [];
        const graphPath = await executeReactComponentStructureCommand(
          ["--base", scopePath, "src", "--root", "App", "--hoc", "withRouter"],
          {
            writeStdout: () => undefined,
            writeStderr: (output) => warnings.push(output),
          },
        );
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "RawLogin"]);
          expect(graph.edges.map(({ sourceNodeId, targetNodeId }) => [sourceNodeId, targetNodeId])).toEqual([
            ["component:src/app.tsx#App", "component:src/login.tsx#RawLogin"],
          ]);
          expect(warnings).toEqual([]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("connects a supplied declared hoc component through a package receiver", async () => {
    await withFixture(
      {
        "node_modules/router-hoc/index.d.ts": `export declare function withRouter<T>(component: T): T;`,
        "node_modules/shell-out/index.d.ts": `export function Shell(props: { component: unknown }): null;`,
        "src/login.tsx": `
          import { withRouter } from "router-hoc";
          function RawLogin() { return <form />; }
          const Login = withRouter(RawLogin);
          export default Login;
        `,
        "src/app.tsx": `
          import Login from "./login";
          import { Shell } from "shell-out";
          export function App() { return <Shell component={Login} />; }
        `,
      },
      async (scopePath) => {
        const warnings: string[] = [];
        const graphPath = await executeReactComponentStructureCommand(
          ["--base", scopePath, "src", "--root", "App", "--hoc", "withRouter"],
          {
            writeStdout: () => undefined,
            writeStderr: (output) => warnings.push(output),
          },
        );
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "RawLogin", "Shell"]);
          const titles = new Map(graph.nodes.map((node) => [node.nodeId, node.title]));
          expect(
            graph.edges
              .map(({ sourceNodeId, targetNodeId }) => `${titles.get(sourceNodeId)} -> ${titles.get(targetNodeId)}`)
              .toSorted(),
          ).toEqual(["App -> Shell", "Shell -> RawLogin"]);
          expect(warnings).toEqual([]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("warns when a declared hoc receives an unprovable argument", async () => {
    await withFixture(
      {
        "node_modules/router-hoc/index.d.ts": `export declare function withRouter(component: unknown): unknown;`,
        "src/app.tsx": `
          import { withRouter } from "router-hoc";
          function Panel() { return <main />; }
          function choose(value) { return value; }
          const Wrapped = withRouter(choose(Panel));
          export function App() { return <Wrapped />; }
        `,
      },
      async (scopePath) => {
        const warnings: string[] = [];
        const graphPath = await executeReactComponentStructureCommand(
          ["--base", scopePath, "src", "--root", "App", "--hoc", "withRouter"],
          {
            writeStdout: () => undefined,
            writeStderr: (output) => warnings.push(output),
          },
        );
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title)).toEqual(["App"]);
          expect(graph.edges).toEqual([]);
          expect(warnings).toEqual([
            expect.stringMatching(
              /^\[unsupported-hoc\] src\/app\.tsx:\d+:\d+: Expected a static component reference\.\n$/,
            ),
          ]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("does not treat an undeclared loader package as a factory", async () => {
    await withFixture(
      {
        "node_modules/@loadable/component/index.d.ts": `export default function loadable<T>(load: () => Promise<{ default: T }>): T;`,
        "src/panel.tsx": `export default function Panel() { return <span />; }`,
        "src/app.tsx": `
          import loadable from "@loadable/component";
          const Loaded = loadable(() => import("./panel"));
          export function App() { return <Loaded />; }
        `,
      },
      async (scopePath) => {
        const warnings: string[] = [];
        const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, "src", "--root", "App"], {
          writeStdout: () => undefined,
          writeStderr: (output) => warnings.push(output),
        });
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title)).toEqual(["App"]);
          expect(graph.edges).toEqual([]);
          expect(warnings).toEqual([]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("warns once for a used unsupported loader without warning about unused factories or changing stdout", async () => {
    await withFixture(
      {
        "node_modules/@loadable/component/index.d.ts": `export default function loadable(load: unknown, options?: unknown): any;`,
        "src/loader.tsx": [
          `import loadable from "@loadable/component";`,
          `export const Loaded = loadable(() => import("./panel"), { ssr: false });`,
          `const Unused = loadable((props) => import(props.path));`,
        ].join("\n"),
        "src/panel.tsx": `export default function Panel() { return <span />; }`,
        "src/app.tsx": `
          import { Loaded } from "./loader";
          export function App() { return <><Loaded /><Loaded /></>; }
        `,
      },
      async (scopePath) => {
        const outputs: string[] = [];
        const warnings: string[] = [];
        const environment = {
          writeStdout: (output: string) => outputs.push(output),
          writeStderr: (output: string) => warnings.push(output),
        };
        const graphPath = await executeReactComponentStructureCommand(
          ["--base", scopePath, "src", "--root", "App", "--loader", "@loadable/component"],
          environment,
        );
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title)).toEqual(["App"]);
          expect(graph.edges).toEqual([]);
          expect(outputs).toEqual([`${JSON.stringify({ graphPath })}\n`]);
          expect(warnings).toEqual([
            `[unsupported-loader] src/loader.tsx:2:23: Expected loader(() => import("static string")) without options.\n`,
          ]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it.each([
    "Alias.Sub = Other;",
    'Alias["Sub"] = Other;',
    'Alias[true ? "Sub" : "renamed"] = Other;',
    "delete Alias.Sub;",
    "Object.assign(Alias, { Sub: Other });",
    "({ replacement: Alias.Sub } = { replacement: Other });",
    "for (Alias.Sub of [Other]) {}",
  ])("keeps the callable base but rejects an explicitly changed assigned member: %s", async (mutation) => {
    await withFixture(
      {
        "src/panel.tsx": `
            function Leaf() { return <span />; }
            function Panel() { return <Leaf />; }
            function Sub() { return <aside />; }
            function Other() { return <footer />; }
            export const Wrapped = Object.assign(Panel, { Sub });
            const Alias = Wrapped;
            ${mutation}
          `,
        "src/app.tsx": `
            import { Wrapped } from "./panel";
            export function App() { return <><Wrapped /><Wrapped.Sub /></>; }
          `,
      },
      async (scopePath) => {
        const warnings: string[] = [];
        const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, "src", "--root", "App"], {
          writeStdout: () => undefined,
          writeStderr: (output) => warnings.push(output),
        });
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Leaf", "Panel"]);
          expect(warnings).toEqual([
            expect.stringMatching(
              /^\[unsupported-object-assign-member\] src\/panel\.tsx:\d+:\d+: Cannot statically resolve Object.assign member "Sub"\.\n$/,
            ),
          ]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("connects assigned members despite unrelated base metadata writes", async () => {
    await withFixture(
      {
        "src/panel.tsx": `
            function Leaf() { return <span />; }
            function Panel() { return <Leaf />; }
            function Sub() { return <aside />; }
            export const Wrapped = Object.assign(Panel, { Sub });
            Wrapped.displayName = "Panel";
            Panel.displayName = "Panel";
          `,
        "src/app.tsx": `
            import { Wrapped } from "./panel";
            export function App() { return <><Wrapped /><Wrapped.Sub /></>; }
          `,
      },
      async (scopePath) => {
        const warnings: string[] = [];
        const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, "src", "--root", "App"], {
          writeStdout: () => undefined,
          writeStderr: (output) => warnings.push(output),
        });
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ nodeId }) => nodeId).toSorted()).toEqual([
            "component:src/app.tsx#App",
            "component:src/panel.tsx#Leaf",
            "component:src/panel.tsx#Panel",
            "component:src/panel.tsx#Sub",
          ]);
          expect(graph.edges.map(({ sourceNodeId, targetNodeId }) => [sourceNodeId, targetNodeId]).toSorted()).toEqual([
            ["component:src/app.tsx#App", "component:src/panel.tsx#Panel"],
            ["component:src/app.tsx#App", "component:src/panel.tsx#Sub"],
            ["component:src/panel.tsx#Panel", "component:src/panel.tsx#Leaf"],
          ]);
          expect(warnings).toEqual([]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it.each([
    "let Wrapped = memo(Panel);",
    "let Base = Panel; const Wrapped = memo(Base);",
    "const Core = memo(Panel); let Wrapped = Core;",
    "const Wrapped = memo(Panel); Wrapped = Other;",
  ])("does not infer a component through a mutable wrapper reference: %s", async (binding) => {
    await withFixture(
      {
        "node_modules/react/index.d.ts": `export function memo<T>(component: T): T;`,
        "src/app.tsx": `
          import { memo } from "react";
          function Panel() { return <span />; }
          function Other() { return <aside />; }
          ${binding}
          export function App() { return <Wrapped />; }
        `,
      },
      async (scopePath) => {
        const warnings: string[] = [];
        const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, "src", "--root", "App"], {
          writeStdout: () => undefined,
          writeStderr: (output) => warnings.push(output),
        });
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title)).toEqual(["App"]);
          expect(graph.edges).toEqual([]);
          expect(warnings).toEqual([
            expect.stringMatching(/^\[unsupported-component-binding\] src\/app\.tsx:\d+:\d+: /),
          ]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it.each([
    "{ get Sub() { return Sub; } }",
    "{ ...{ Sub } }",
    '{ ["Sub"]: Sub }',
    "{ Sub, Sub: Other }",
    "{ Sub }, { Sub: Other }",
    "unknownMembers",
    "{ __proto__: { Sub }, Sub }",
    "{ Sub: choose(Sub) }",
    "{ Sub: Wrapped.Sub }",
  ])("does not guess unsupported assigned members from %s", async (source) => {
    await withFixture(
      {
        "src/app.tsx": `
          function Panel() { return <main />; }
          function Sub() { return <aside />; }
          function Other() { return <footer />; }
          declare const unknownMembers: { Sub: typeof Sub };
          declare function choose(value: typeof Sub): typeof Sub;
          const Wrapped = Object.assign(Panel, ${source});
          export function App() { return <><Wrapped /><Wrapped.Sub /></>; }
        `,
      },
      async (scopePath) => {
        const warnings: string[] = [];
        const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, "src", "--root", "App"], {
          writeStdout: () => undefined,
          writeStderr: (output) => warnings.push(output),
        });
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Panel"]);
          expect(warnings).toEqual([expect.stringMatching(/^\[unsupported-object-assign-member\] /)]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it.each([
    "const React = { memo: (value) => value }; const Wrapped = React.memo(Panel);",
    "const Object = { assign: (value, source) => value }; const Wrapped = Object.assign(Panel, {});",
    'const loadable = (load) => Panel; const Wrapped = loadable(() => import("./panel"));',
  ])("does not recognize a shadowed wrapper or loader API: %s", async (binding) => {
    await withFixture(
      {
        "src/app.tsx": `
          function Panel() { return <main />; }
          ${binding}
          export function App() { return <Wrapped />; }
        `,
        "src/panel.tsx": `export default function Other() { return <aside />; }`,
      },
      async (scopePath) => {
        const warnings: string[] = [];
        const graphPath = await executeReactComponentStructureCommand(
          ["--base", scopePath, "src", "--root", "App", "--loader", "@loadable/component"],
          {
            writeStdout: () => undefined,
            writeStderr: (output) => warnings.push(output),
          },
        );
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title)).toEqual(["App"]);
          expect(graph.edges).toEqual([]);
          expect(warnings).toEqual([]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("does not expand collection or warn about uncollected factories while preserving aliases to collected components", async () => {
    await withFixture(
      {
        "node_modules/react/index.d.ts": `export function memo<T>(component: T): T;`,
        "node_modules/@loadable/component/index.d.ts": `export default function loadable(load: unknown, options?: unknown): any;`,
        ".gitignore": "src/ignored.tsx\nsrc/uncollected.tsx\n",
        "src/ignored.tsx": `
          import { memo } from "react";
          import loadable from "@loadable/component";
          import Panel from "./panel";
          export const Direct = memo(Panel);
          export const Deferred = loadable(() => import("./panel"));
          export const Unsupported = loadable(() => import("./panel"), { ssr: false });
        `,
        "src/panel.tsx": `
          function Leaf() { return <span />; }
          export default function Panel() { return <Leaf />; }
        `,
        "src/uncollected.tsx": `export default function Uncollected() { return <footer />; }`,
        "src/app.tsx": `
          import loadable from "@loadable/component";
          import { Direct, Deferred, Unsupported } from "./ignored";
          const Outside = loadable(() => import("./uncollected"));
          export function App() { return <><Direct /><Deferred /><Unsupported /><Outside /></>; }
        `,
      },
      async (scopePath) => {
        const warnings: string[] = [];
        const graphPath = await executeReactComponentStructureCommand(
          ["--base", scopePath, "src", "--root", "App", "--loader", "@loadable/component"],
          {
            writeStdout: () => undefined,
            writeStderr: (output) => warnings.push(output),
          },
        );
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Leaf", "Panel"]);
          expect(graph.edges.map(({ sourceNodeId, targetNodeId }) => [sourceNodeId, targetNodeId]).toSorted()).toEqual([
            ["component:src/app.tsx#App", "component:src/panel.tsx#Panel"],
            ["component:src/panel.tsx#Panel", "component:src/panel.tsx#Leaf"],
          ]);
          expect(warnings).toEqual([]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("keeps analysis warnings independent of display filters and suppresses them on fatal failure", async () => {
    await withFixture(
      {
        "node_modules/@loadable/component/index.d.ts": `export default function loadable(load: unknown, options?: unknown): any;`,
        "src/app.tsx": `
          import loadable from "@loadable/component";
          const Loaded = loadable((props) => import(props.path));
          export function App() { return <Loaded />; }
          export function Healthy() { return <main />; }
        `,
      },
      async (scopePath) => {
        for (const filter of [
          ["--root", "Healthy"],
          ["--exclude-component", "App"],
        ]) {
          const warnings: string[] = [];
          const graphPath = await executeReactComponentStructureCommand(
            ["--base", scopePath, "src", ...filter, "--loader", "@loadable/component"],
            {
              writeStdout: () => undefined,
              writeStderr: (output) => warnings.push(output),
            },
          );
          try {
            const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
            expect(graph.nodes.map(({ title }) => title)).toEqual(["Healthy"]);
            expect(warnings).toEqual([expect.stringMatching(/^\[unsupported-loader\] /)]);
          } finally {
            await rm(dirname(graphPath), { recursive: true });
          }
        }
        const outputs: string[] = [];
        const warnings: string[] = [];
        await expect(
          executeReactComponentStructureCommand(["--base", scopePath, "src", "--root", "Missing"], {
            writeStdout: (output) => outputs.push(output),
            writeStderr: (output) => warnings.push(output),
          }),
        ).rejects.toThrow();
        expect(outputs).toEqual([]);
        expect(warnings).toEqual([]);
      },
    );
  });

  it.each([
    { binding: "let Sub = Other;", source: "{ Sub }" },
    { binding: "let Member = Other;", source: "{ Sub: Member }" },
  ])("does not infer an assigned component member through $binding", async ({ binding, source }) => {
    await withFixture(
      {
        "src/app.tsx": `
          function Panel() { return <main />; }
          function Other() { return <aside />; }
          ${binding}
          const Wrapped = Object.assign(Panel, ${source});
          export function App() { return <><Wrapped /><Wrapped.Sub /></>; }
        `,
      },
      async (scopePath) => {
        const warnings: string[] = [];
        const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, "src", "--root", "App"], {
          writeStdout: () => undefined,
          writeStderr: (output) => warnings.push(output),
        });
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Panel"]);
          expect(warnings).toEqual([expect.stringMatching(/^\[unsupported-object-assign-member\] /)]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("preserves class slots and branch controls through a memo, assignment, and loader chain", async () => {
    await withFixture(
      {
        "node_modules/react/index.d.ts": `
          export class Component<P> { props: P; }
          export function memo<T>(component: T): T;
        `,
        "node_modules/@loadable/component/index.d.ts": `export default function loadable(load: unknown): any;`,
        "src/panel.tsx": `
          import * as React from "react";
          class Panel extends React.Component<{ children: unknown }> {
            render() { return <>{this.props.children}</>; }
          }
          function Sub() { return <aside />; }
          const Cached = React.memo(Panel);
          export default Object.assign(Cached, { Sub });
        `,
        "src/app.tsx": `
          import loadable from "@loadable/component";
          import Compound from "./panel";
          function Leaf() { return <span />; }
          const Loaded = loadable(() => import("./panel"));
          export function App({ ready }) { return <Loaded>{ready ? <Compound.Sub /> : <Leaf />}</Loaded>; }
        `,
      },
      async (scopePath) => {
        const warnings: string[] = [];
        const graphPath = await executeReactComponentStructureCommand(
          ["--base", scopePath, "src", "--root", "App", "--loader", "@loadable/component"],
          {
            writeStdout: () => undefined,
            writeStderr: (output) => warnings.push(output),
          },
        );
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Leaf", "Panel", "Sub"]);
          expect(graph.edges.map(({ sourceNodeId, targetNodeId }) => [sourceNodeId, targetNodeId]).toSorted()).toEqual([
            ["component:src/app.tsx#App", "component:src/panel.tsx#Panel"],
            ["component:src/panel.tsx#Panel", "component:src/app.tsx#Leaf"],
            ["component:src/panel.tsx#Panel", "component:src/panel.tsx#Sub"],
          ]);
          const ready = graph.layoutContext.controls.find(({ label }) => label === "ready")!;
          for (const [targetNodeId, value] of [
            ["component:src/panel.tsx#Sub", "true"],
            ["component:src/app.tsx#Leaf", "false"],
          ]) {
            expect(graph.edges.find((edge) => edge.targetNodeId === targetNodeId)).toMatchObject({
              type: "control",
              activeWhen: [[{ controlId: ready.controlId, value }]],
              layoutContext: {
                composition: {
                  type: "node",
                  slot: "children",
                  origins: [{ supplierDefinitionId: "component:src/app.tsx#App", slot: "children" }],
                },
              },
            });
          }
          expect(warnings).toEqual([]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("routes children rendered inside a context provider subtree", async () => {
    await withFixture(
      {
        "node_modules/react/index.d.ts": `
          export function createContext<T>(defaultValue: T): { Provider: unknown; Consumer: unknown };
        `,
        "src/app.tsx": `
          import { createContext } from "react";

          const OverlayContext = createContext(null);
          const Unrelated = {};

          function Target() { return <span />; }
          function Missed() { return <aside />; }

          function Layer({ children }) {
            return (
              <OverlayContext.Provider value={null}>
                <section>{children}</section>
              </OverlayContext.Provider>
            );
          }

          function Static({ children }) {
            return (
              <Unrelated.Provider value={null}>
                <div>{children}</div>
              </Unrelated.Provider>
            );
          }

          export function App() {
            return (
              <>
                <Layer><Target /></Layer>
                <Static><Missed /></Static>
              </>
            );
          }
        `,
      },
      async (scopePath) => {
        const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, "src", "--root", "App"], {
          writeStdout: () => undefined,
        });
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Layer", "Static", "Target"]);
          const target = graph.nodes.find(({ title }) => title === "Target")!;
          expect(
            graph.edges.find(
              ({ sourceNodeId, targetNodeId }) =>
                sourceNodeId === "component:src/app.tsx#Layer" && targetNodeId === target.nodeId,
            ),
          ).toMatchObject({
            layoutContext: {
              composition: {
                type: "node",
                slot: "children",
                origins: [{ supplierDefinitionId: "component:src/app.tsx#App", slot: "children" }],
              },
            },
          });
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("routes children cloned through element iteration", async () => {
    await withFixture(
      {
        "node_modules/react/index.d.ts": `
          export function cloneElement<P>(element: any, props?: P, ...children: unknown[]): any;
          export const Children: {
            map<T, C>(children: any, fn: (child: any, index: number) => C): C[];
          };
        `,
        "src/app.tsx": `
          import * as React from "react";

          function Target() { return <span />; }

          function Row({ children }) {
            return (
              <ul>
                {React.Children.map(children, (child) => React.cloneElement(child, { className: "row" }))}
              </ul>
            );
          }

          function List({ children }: { children: any[] }) {
            return (
              <ol>
                {children.map((child) => React.cloneElement(child, { className: "item" }))}
              </ol>
            );
          }

          export function App() {
            return (
              <>
                <Row><Target /></Row>
                <List><Target /></List>
              </>
            );
          }
        `,
      },
      async (scopePath) => {
        const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, "src", "--root", "App"], {
          writeStdout: () => undefined,
        });
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "List", "Row", "Target"]);
          const target = graph.nodes.find(({ title }) => title === "Target")!;
          for (const source of ["component:src/app.tsx#Row", "component:src/app.tsx#List"]) {
            expect(
              graph.edges.find(
                ({ sourceNodeId, targetNodeId }) => sourceNodeId === source && targetNodeId === target.nodeId,
              ),
            ).toMatchObject({
              layoutContext: {
                composition: {
                  type: "node",
                  slot: "children",
                  origins: [{ supplierDefinitionId: "component:src/app.tsx#App", slot: "children" }],
                },
              },
            });
          }
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("routes children rendered through createElement with a dynamic tag", async () => {
    await withFixture(
      {
        "node_modules/react/index.d.ts": `
          export function createElement(type: any, props?: any, ...children: any[]): any;
        `,
        "src/app.tsx": `
          import * as React from "react";

          function Target() { return <span />; }
          function Inner() { return <b />; }

          function Host({ tagName = "div", children }) {
            return React.createElement(
              tagName,
              { className: "host" },
              React.createElement("div", null, children),
              <Inner />,
            );
          }

          export function App() {
            return <Host><Target /></Host>;
          }
        `,
      },
      async (scopePath) => {
        const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, "src", "--root", "App"], {
          writeStdout: () => undefined,
        });
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Host", "Inner", "Target"]);
          const host = "component:src/app.tsx#Host";
          const target = graph.nodes.find(({ title }) => title === "Target")!;
          expect(
            graph.edges.find(
              ({ sourceNodeId, targetNodeId }) => sourceNodeId === host && targetNodeId === target.nodeId,
            ),
          ).toMatchObject({
            layoutContext: {
              composition: {
                type: "node",
                slot: "children",
                origins: [{ supplierDefinitionId: "component:src/app.tsx#App", slot: "children" }],
              },
            },
          });
          expect(
            graph.edges.some(
              ({ sourceNodeId, targetNodeId }) =>
                sourceNodeId === host && targetNodeId === "component:src/app.tsx#Inner",
            ),
          ).toBe(true);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("routes children rendered through a portal", async () => {
    await withFixture(
      {
        "node_modules/react/index.d.ts": `
          export function cloneElement<P>(element: any, props?: P, ...children: unknown[]): any;
        `,
        "node_modules/react-dom/index.d.ts": `
          export function createPortal(children: any, container: any): any;
        `,
        "src/app.tsx": `
          import * as React from "react";
          import { createPortal } from "react-dom";

          function Target() { return <span />; }

          function Portal({ children }) {
            return createPortal(React.cloneElement(children, { "data-portal": "p" }), null);
          }

          export function App() {
            return <Portal><Target /></Portal>;
          }
        `,
      },
      async (scopePath) => {
        const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, "src", "--root", "App"], {
          writeStdout: () => undefined,
        });
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Portal", "Target"]);
          const target = graph.nodes.find(({ title }) => title === "Target")!;
          expect(
            graph.edges.find(
              ({ sourceNodeId, targetNodeId }) =>
                sourceNodeId === "component:src/app.tsx#Portal" && targetNodeId === target.nodeId,
            ),
          ).toMatchObject({
            layoutContext: {
              composition: {
                type: "node",
                slot: "children",
                origins: [{ supplierDefinitionId: "component:src/app.tsx#App", slot: "children" }],
              },
            },
          });
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("warns when a recognized React wrapper receives an arbitrary helper result", async () => {
    await withFixture(
      {
        "node_modules/react/index.d.ts": `export function memo<T>(component: T): T;`,
        "src/app.tsx": `
          import { memo } from "react";
          function Panel() { return <main />; }
          function choose(value) { return value; }
          const Wrapped = memo(choose(Panel));
          export function App() { return <Wrapped />; }
        `,
      },
      async (scopePath) => {
        const warnings: string[] = [];
        const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, "src", "--root", "App"], {
          writeStdout: () => undefined,
          writeStderr: (output) => warnings.push(output),
        });
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title)).toEqual(["App"]);
          expect(warnings).toEqual([expect.stringMatching(/^\[unsupported-react-wrapper\] /)]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("does not follow a mutable default export through a static loader", async () => {
    await withFixture(
      {
        "node_modules/@loadable/component/index.d.ts": `export default function loadable(load: unknown): any;`,
        "src/panel.tsx": `
          function Panel() { return <main />; }
          let Alias = Panel;
          export default Alias;
        `,
        "src/app.tsx": `
          import loadable from "@loadable/component";
          const Loaded = loadable(() => import("./panel"));
          export function App() { return <Loaded />; }
        `,
      },
      async (scopePath) => {
        const warnings: string[] = [];
        const graphPath = await executeReactComponentStructureCommand(
          ["--base", scopePath, "src", "--root", "App", "--loader", "@loadable/component"],
          {
            writeStdout: () => undefined,
            writeStderr: (output) => warnings.push(output),
          },
        );
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title)).toEqual(["App"]);
          expect(warnings).toEqual([expect.stringMatching(/^\[unsupported-component-binding\] /)]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
  });

  it("does not warn about assigned members when only the callable base is rendered", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          function Panel() { return <main />; }
          function Sub() { return <aside />; }
          const Wrapped = Object.assign(Panel, { get Sub() { return Sub; } });
          export function App() { return <Wrapped />; }
        `,
      },
      async (scopePath) => {
        const warnings: string[] = [];
        const graphPath = await executeReactComponentStructureCommand(["--base", scopePath, "src", "--root", "App"], {
          writeStdout: () => undefined,
          writeStderr: (output) => warnings.push(output),
        });
        try {
          const graph = componentStructureDiagramGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8")));
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Panel"]);
          expect(warnings).toEqual([]);
        } finally {
          await rm(dirname(graphPath), { recursive: true });
        }
      },
    );
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
