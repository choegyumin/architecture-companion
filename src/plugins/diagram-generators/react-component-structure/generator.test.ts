import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { DiagramGraph } from "@/features/diagram/diagram-graph";

import { executeReactComponentStructureCommand } from "./command";
import { generateReactComponentStructureGraph } from "./generator";

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
            jsx: "preserve",
            module: "ESNext",
            moduleResolution: "Bundler",
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

function edgeFacts(graph: DiagramGraph) {
  const titlesById = new Map(graph.nodes.map((node) => [node.id, node.title]));
  return graph.edges
    .map((edge) => ({
      source: titlesById.get(edge.source),
      target: titlesById.get(edge.target),
      kind: edge.kind,
      label: edge.label,
    }))
    .toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

describe("React component structure generator", () => {
  it("uses the component that renders children as the visual parent", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { Content } from "./content";
          import { Layout } from "./layout";

          export function App() {
            return <Layout><Content /></Layout>;
          }
        `,
        "src/content.tsx": `export function Content() { return <main>Content</main>; }`,
        "src/layout.tsx": `
          export function Layout({ children }: { children: unknown }) {
            return <section>{children}</section>;
          }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Content", "Layout"]);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Layout", kind: "direct-render", label: undefined },
          { source: "Layout", target: "Content", kind: "node-prop", label: "Node prop · children" },
        ]);
      },
    );
  });

  it("labels node, render, and component prop relationships with their actual prop names", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { Body, Footer, Frame, Header } from "./frame";

          export function App() {
            return <Frame header={<Header />} renderBody={() => <Body />} footerComponent={Footer} />;
          }
        `,
        "src/frame.tsx": `
          export function Header() { return <header />; }
          export function Body() { return <main />; }
          export function Footer() { return <footer />; }

          export function Frame({ header, renderBody, footerComponent: FooterComponent }: {
            header: unknown;
            renderBody: () => unknown;
            footerComponent: () => unknown;
          }) {
            return <>{header}{renderBody()}<FooterComponent /></>;
          }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Frame", kind: "direct-render", label: undefined },
          { source: "Frame", target: "Body", kind: "render-prop", label: "Render prop · renderBody" },
          {
            source: "Frame",
            target: "Footer",
            kind: "component-prop",
            label: "Component prop · footerComponent",
          },
          { source: "Frame", target: "Header", kind: "node-prop", label: "Node prop · header" },
        ]);
      },
    );
  });

  it("follows named and rest-prop forwarding to the final renderer", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { Content, Layout, Wrapper } from "./components";

          export function App() {
            return <><Layout><Content /></Layout><Wrapper content={<Content />} /></>;
          }
        `,
        "src/components.tsx": `
          export function Content() { return <main />; }
          export function Primitive({ children, content }: { children?: unknown; content?: unknown }) {
            return <section>{children}{content}</section>;
          }
          export function Layout({ children }: { children: unknown }) {
            return <Primitive>{children}</Primitive>;
          }
          export function Wrapper({ className, ...props }: { className?: string; content: unknown }) {
            return <Primitive {...props} />;
          }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Layout", kind: "direct-render", label: undefined },
          { source: "App", target: "Wrapper", kind: "direct-render", label: undefined },
          { source: "Layout", target: "Primitive", kind: "direct-render", label: undefined },
          { source: "Primitive", target: "Content", kind: "node-prop", label: "Node prop · children" },
          { source: "Primitive", target: "Content", kind: "node-prop", label: "Node prop · content" },
          { source: "Wrapper", target: "Primitive", kind: "direct-render", label: undefined },
        ]);
      },
    );
  });

  it("shows confirmed external components and omits unresolved relationships", async () => {
    await withFixture(
      {
        "node_modules/ui-kit/index.d.ts": `export declare function ExternalFrame(props: unknown): unknown;`,
        "node_modules/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.d.ts" } },
        }),
        "src/app.tsx": `
          import { ExternalFrame } from "ui-kit";
          import { Local } from "./local";

          export function App() {
            return <ExternalFrame><Local /><Unresolved /></ExternalFrame>;
          }
        `,
        "src/local.tsx": `export function Local() { return <div />; }`,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "ExternalFrame", "Local"]);
        expect(graph.nodes.find(({ title }) => title === "ExternalFrame")).toMatchObject({
          kind: "External React component",
          description: "ui-kit boundary",
        });
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "ExternalFrame", kind: "direct-render", label: undefined },
        ]);
      },
    );
  });

  it("supports JS, JSX, TS, and TSX component definitions", async () => {
    await withFixture(
      {
        "src/js-component.js": `
          import React from "react";
          import { JsxComponent } from "./jsx-component.jsx";
          export function JsComponent() { return React.createElement(JsxComponent); }
        `,
        "src/jsx-component.jsx": `
          import { TsComponent } from "./ts-component";
          export function JsxComponent() { return <TsComponent />; }
        `,
        "src/ts-component.ts": `
          import React from "react";
          import { TsxComponent } from "./tsx-component";
          export function TsComponent() { return React.createElement(TsxComponent); }
        `,
        "src/tsx-component.tsx": `export function TsxComponent() { return <div />; }`,
      },
      async (scopePath) => {
        const first = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });
        const second = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(second).toEqual(first);
        expect(first.nodes.map(({ title }) => title).toSorted()).toEqual([
          "JsComponent",
          "JsxComponent",
          "TsComponent",
          "TsxComponent",
        ]);
        expect(edgeFacts(first)).toEqual([
          { source: "JsComponent", target: "JsxComponent", kind: "direct-render", label: undefined },
          { source: "JsxComponent", target: "TsComponent", kind: "direct-render", label: undefined },
          { source: "TsComponent", target: "TsxComponent", kind: "direct-render", label: undefined },
        ]);
      },
    );
  });

  it("resolves aliased re-exports to class component definitions", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { RenamedButton } from "./index";
          export function App() { return <RenamedButton />; }
        `,
        "src/button.tsx": `
          import React from "react";
          export class Button extends React.Component {
            render() { return <button />; }
          }
        `,
        "src/index.ts": `export { Button as RenamedButton } from "./button";`,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Button"]);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Button", kind: "direct-render", label: undefined },
        ]);
      },
    );
  });

  it("applies default and explicit glob filters without shortcut edges", async () => {
    await withFixture(
      {
        "dist/built.tsx": `export function Built() { return <div />; }`,
        "src/app.tsx": `
          import { Hidden } from "./hidden";
          import { Visible } from "./visible";
          export function App() { return <><Hidden /><Visible /></>; }
        `,
        "src/feature.test.tsx": `export function TestOnly() { return <div />; }`,
        "src/generated.generated.tsx": `export function Generated() { return <div />; }`,
        "src/hidden.tsx": `export function Hidden() { return <div />; }`,
        "src/visible.tsx": `export function Visible() { return <div />; }`,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({
          scopePath,
          sourcePaths: ["src", "dist"],
          excludeComponentPatterns: ["Hidden"],
          excludeFilePatterns: ["src/visible.tsx"],
        });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App"]);
        expect(graph.edges).toEqual([]);
      },
    );
  });

  it("writes only a graph candidate to a temporary file through the command seam", async () => {
    await withFixture({ "src/app.tsx": `export function App() { return <main />; }` }, async (scopePath) => {
      const outputs: string[] = [];
      const graphPath = await executeReactComponentStructureCommand(["--scope", scopePath, "--source", "src"], {
        writeStdout: (output) => outputs.push(output),
      });

      try {
        expect(outputs).toEqual([`${graphPath}\n`]);
        expect(JSON.parse(await readFile(graphPath, "utf8"))).toEqual({
          groups: [],
          nodes: [expect.objectContaining({ type: "default", kind: "React component", title: "App" })],
          edges: [],
        });
      } finally {
        await rm(dirname(graphPath), { recursive: true });
      }
    });
  });
});
