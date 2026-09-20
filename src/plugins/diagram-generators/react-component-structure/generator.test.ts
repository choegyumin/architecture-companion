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
          { source: "Layout", target: "Content", kind: "NODE (children)", label: "from App" },
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
          { source: "Frame", target: "Body", kind: "RENDER (renderBody)", label: "from App" },
          {
            source: "Frame",
            target: "Footer",
            kind: "COMPONENT (footerComponent)",
            label: "from App",
          },
          { source: "Frame", target: "Header", kind: "NODE (header)", label: "from App" },
        ]);
      },
    );
  });

  it("keeps original suppliers when multiple components forward values to one renderer", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { ParentA, ParentB } from "./components";
          export function App() { return <><ParentA /><ParentB /></>; }
        `,
        "src/components.tsx": `
          export function Content() { return <main />; }
          export function Renderer({ body }: { body: unknown }) { return <>{body}</>; }
          export function Wrapper({ content }: { content: unknown }) { return <Renderer body={content} />; }
          export function ParentA() { return <Wrapper content={<Content />} />; }
          export function ParentB() { return <Wrapper content={<Content />} />; }
        `,
      },
      async (scopePath) => {
        const first = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });
        const second = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });
        const contentId = first.nodes.find(({ title }) => title === "Content")?.id;
        const relationship = first.edges.find(({ target }) => target === contentId);
        const repeatedRelationship = second.edges.find(({ target }) => target === contentId);

        expect(relationship).toMatchObject({
          source: first.nodes.find(({ title }) => title === "Renderer")?.id,
          target: contentId,
          kind: "NODE (body)",
          label: "from ParentA, ParentB",
        });
        expect(repeatedRelationship?.id).toBe(relationship?.id);
      },
    );
  });

  it("keeps a local render-prop invoker inside an external wrapper", async () => {
    await withFixture(
      {
        "node_modules/ui-kit/index.d.ts": `export declare function ExternalPanel(props: unknown): unknown;`,
        "node_modules/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.d.ts" } },
        }),
        "src/app.tsx": `
          import { Body, Frame } from "./frame";
          export function App() { return <Frame>{() => <Body />}</Frame>; }
        `,
        "src/frame.tsx": `
          import { ExternalPanel } from "ui-kit";
          export function Body() { return <main />; }
          export function Frame({ children }: { children: () => unknown }) {
            return <ExternalPanel>{children()}</ExternalPanel>;
          }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Frame", kind: "direct-render", label: undefined },
          { source: "Frame", target: "Body", kind: "RENDER (children)", label: "from App" },
          { source: "Frame", target: "ExternalPanel", kind: "direct-render", label: undefined },
        ]);
      },
    );
  });

  it("follows render props wrapped in callbacks to the final invoker", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { Body, Wrapper } from "./components";
          export function App() { return <Wrapper render={() => <Body />} />; }
        `,
        "src/components.tsx": `
          export function Body() { return <main />; }
          export function Primitive({ render }: { render: () => unknown }) { return <>{render()}</>; }
          export function Wrapper({ render }: { render: () => unknown }) {
            return <Primitive render={() => render()} />;
          }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Wrapper", kind: "direct-render", label: undefined },
          { source: "Primitive", target: "Body", kind: "RENDER (render)", label: "from App" },
          { source: "Wrapper", target: "Primitive", kind: "direct-render", label: undefined },
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
          { source: "Primitive", target: "Content", kind: "NODE (children)", label: "from App" },
          { source: "Primitive", target: "Content", kind: "NODE (content)", label: "from App" },
          { source: "Wrapper", target: "Primitive", kind: "direct-render", label: undefined },
        ]);
      },
    );
  });

  it("uses external boundaries as confirmed node-prop connection points", async () => {
    await withFixture(
      {
        "node_modules/ui-kit/index.d.ts": `
          export declare function ExternalFrame(props: unknown): unknown;
          export declare function ExternalLeaf(props: unknown): unknown;
        `,
        "node_modules/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.d.ts" } },
        }),
        "src/app.tsx": `
          import { ExternalFrame, ExternalLeaf } from "ui-kit";
          import { Body, Header } from "./local";

          export function App() {
            return (
              <ExternalFrame header={<Header />}>
                <ExternalLeaf />
                <Body />
                <Unresolved />
              </ExternalFrame>
            );
          }
        `,
        "src/local.tsx": `
          export function Body() { return <main />; }
          export function Header() { return <header />; }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual([
          "App",
          "Body",
          "ExternalFrame",
          "ExternalLeaf",
          "Header",
        ]);
        expect(graph.nodes.find(({ title }) => title === "ExternalFrame")).toMatchObject({
          kind: "External React component",
          description: "ui-kit boundary",
        });
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "ExternalFrame", kind: "direct-render", label: undefined },
          {
            source: "ExternalFrame",
            target: "Body",
            kind: "NODE (children)",
            label: "from App",
          },
          {
            source: "ExternalFrame",
            target: "ExternalLeaf",
            kind: "NODE (children)",
            label: "from App",
          },
          {
            source: "ExternalFrame",
            target: "Header",
            kind: "NODE (header)",
            label: "from App",
          },
        ]);
      },
    );
  });

  it("uses external boundaries as render and component prop connection points", async () => {
    await withFixture(
      {
        "node_modules/ui-kit/index.d.ts": `export declare function ExternalFlow(props: unknown): unknown;`,
        "node_modules/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.d.ts" } },
        }),
        "src/app.tsx": `
          import { ExternalFlow } from "ui-kit";
          import { CardNode, Fallback, Panel } from "./local";

          const nodeTypes = { card: CardNode };

          export function App() {
            return (
              <ExternalFlow
                fallbackComponent={Fallback}
                nodeTypes={nodeTypes}
                renderPanel={() => <Panel />}
              />
            );
          }
        `,
        "src/local.tsx": `
          export function CardNode() { return <article />; }
          export function Fallback() { return <aside />; }
          export function Panel() { return <section />; }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "ExternalFlow", kind: "direct-render", label: undefined },
          {
            source: "ExternalFlow",
            target: "CardNode",
            kind: "COMPONENT (nodeTypes)",
            label: "from App",
          },
          {
            source: "ExternalFlow",
            target: "Fallback",
            kind: "COMPONENT (fallbackComponent)",
            label: "from App",
          },
          {
            source: "ExternalFlow",
            target: "Panel",
            kind: "RENDER (renderPanel)",
            label: "from App",
          },
        ]);
      },
    );
  });

  it("resolves static JSX prop bags without promoting event results or external constants", async () => {
    await withFixture(
      {
        "node_modules/ui-kit/index.d.ts": `
          export declare function ExternalFlow(props: unknown): unknown;
          export declare const darkTheme: string;
        `,
        "node_modules/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.d.ts" } },
        }),
        "src/app.tsx": `
          import { darkTheme, ExternalFlow } from "ui-kit";
          import { Body, CardNode, Fallback, Ignored, Panel } from "./local";

          const panel = <Panel />;
          const renderPanel = () => <Body />;
          const props = {
            fallbackComponent: Fallback,
            nodeTypes: { card: CardNode },
            onClick: () => <Ignored />,
            panel,
            renderPanel,
          };

          export function App() {
            return <ExternalFlow {...props} config={{ theme: darkTheme }} theme={darkTheme} />;
          }
        `,
        "src/local.tsx": `
          export function Body() { return <main />; }
          export function CardNode() { return <article />; }
          export function Fallback() { return <aside />; }
          export function Ignored() { return <div />; }
          export function Panel() { return <section />; }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.some(({ title }) => title === "darkTheme")).toBe(false);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "ExternalFlow", kind: "direct-render", label: undefined },
          {
            source: "ExternalFlow",
            target: "Body",
            kind: "RENDER (renderPanel)",
            label: "from App",
          },
          {
            source: "ExternalFlow",
            target: "CardNode",
            kind: "COMPONENT (nodeTypes)",
            label: "from App",
          },
          {
            source: "ExternalFlow",
            target: "Fallback",
            kind: "COMPONENT (fallbackComponent)",
            label: "from App",
          },
          {
            source: "ExternalFlow",
            target: "Panel",
            kind: "NODE (panel)",
            label: "from App",
          },
        ]);
      },
    );
  });

  it("omits mutable aliases, unknown spread overrides, and non-component external callables", async () => {
    await withFixture(
      {
        "node_modules/ui-kit/index.d.ts": `
          export declare function ExternalFlow(props: unknown): unknown;
          export declare function format(value: string): string;
        `,
        "node_modules/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.d.ts" } },
        }),
        "src/app.tsx": `
          import { ExternalFlow, format } from "ui-kit";
          import { A, B } from "./local";

          let panel = <A />;
          panel = <B />;
          function replacement() { return { panel: <B /> }; }
          const props = { panel: <A />, ...replacement() };

          export function App() {
            return <><ExternalFlow panel={panel} /><ExternalFlow {...props} component={format} /></>;
          }
        `,
        "src/local.tsx": `
          export function A() { return <main />; }
          export function B() { return <aside />; }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.some(({ title }) => title === "format")).toBe(false);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "ExternalFlow", kind: "direct-render", label: undefined },
        ]);
      },
    );
  });

  it("follows rest props repacked through a static object", async () => {
    await withFixture(
      {
        "node_modules/ui-kit/index.d.ts": `export declare function ExternalFlow(props: unknown): unknown;`,
        "node_modules/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.d.ts" } },
        }),
        "src/app.tsx": `
          import { CardNode, Content, Wrapper } from "./components";
          export function App() {
            return <Wrapper content={<Content />} nodeTypes={{ card: CardNode }} skip="ignored" />;
          }
        `,
        "src/components.tsx": `
          import { ExternalFlow } from "ui-kit";
          export function CardNode() { return <article />; }
          export function Content() { return <main />; }
          export function Wrapper({ skip, ...props }: {
            content: unknown;
            nodeTypes: { card: () => unknown };
            skip: string;
          }) {
            const repacked = { ...props };
            return <ExternalFlow {...repacked} />;
          }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Wrapper", kind: "direct-render", label: undefined },
          {
            source: "ExternalFlow",
            target: "CardNode",
            kind: "COMPONENT (nodeTypes)",
            label: "from App",
          },
          {
            source: "ExternalFlow",
            target: "Content",
            kind: "NODE (content)",
            label: "from App",
          },
          { source: "Wrapper", target: "ExternalFlow", kind: "direct-render", label: undefined },
        ]);
      },
    );
  });

  it("follows values read through static object properties", async () => {
    await withFixture(
      {
        "node_modules/ui-kit/index.d.ts": `export declare function ExternalFlow(props: unknown): unknown;`,
        "node_modules/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.d.ts" } },
        }),
        "src/app.tsx": `
          import { Body, Child, Wrapper } from "./components";
          export function App() {
            return <><Wrapper><Child /></Wrapper><Wrapper>{() => <Body />}</Wrapper></>;
          }
        `,
        "src/components.tsx": `
          import { ExternalFlow } from "ui-kit";
          export function Body() { return <main />; }
          export function Child() { return <div />; }
          export function Wrapper({ children }: { children: unknown }) {
            const bag = { children };
            return <ExternalFlow children={bag.children} />;
          }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Wrapper", kind: "direct-render", label: undefined },
          {
            source: "ExternalFlow",
            target: "Body",
            kind: "RENDER (children)",
            label: "from App",
          },
          {
            source: "ExternalFlow",
            target: "Child",
            kind: "NODE (children)",
            label: "from App",
          },
          { source: "Wrapper", target: "ExternalFlow", kind: "direct-render", label: undefined },
        ]);
      },
    );
  });

  it("follows repacked props and createElement callback children to an external boundary", async () => {
    await withFixture(
      {
        "node_modules/ui-kit/index.d.ts": `export declare function ExternalFlow(props: unknown): unknown;`,
        "node_modules/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.d.ts" } },
        }),
        "src/app.tsx": `
          import { Body, CardNode, Child, Panel, Wrapper } from "./components";

          export function App() {
            return (
              <Wrapper cardComponent={CardNode} panel={<Panel />} renderBody={() => <Body />}>
                {() => <Child />}
              </Wrapper>
            );
          }
        `,
        "src/components.tsx": `
          import React from "react";
          import { ExternalFlow } from "ui-kit";

          export function Body() { return <main />; }
          export function CardNode() { return <article />; }
          export function Child() { return <div />; }
          export function Panel() { return <section />; }
          export function Wrapper({ cardComponent, children, panel, renderBody }: {
            cardComponent: () => unknown;
            children: () => unknown;
            panel: unknown;
            renderBody: () => unknown;
          }) {
            const nodeTypes = { card: cardComponent };
            const externalProps = { nodeTypes, panel, renderBody };
            return React.createElement(ExternalFlow, externalProps, () => children());
          }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Wrapper", kind: "direct-render", label: undefined },
          {
            source: "ExternalFlow",
            target: "Body",
            kind: "RENDER (renderBody)",
            label: "from App",
          },
          {
            source: "ExternalFlow",
            target: "CardNode",
            kind: "COMPONENT (nodeTypes)",
            label: "from App",
          },
          {
            source: "ExternalFlow",
            target: "Child",
            kind: "RENDER (children)",
            label: "from App",
          },
          {
            source: "ExternalFlow",
            target: "Panel",
            kind: "NODE (panel)",
            label: "from App",
          },
          { source: "Wrapper", target: "ExternalFlow", kind: "direct-render", label: undefined },
        ]);
      },
    );
  });

  it("resolves createElement prop bags and aliased supplied values", async () => {
    await withFixture(
      {
        "node_modules/ui-kit/index.d.ts": `export declare function ExternalFlow(props: unknown): unknown;`,
        "node_modules/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.d.ts" } },
        }),
        "src/app.ts": `
          import React from "react";
          import { ExternalFlow } from "ui-kit";
          import { Body, CardNode, Child, Panel } from "./components";

          const panel = React.createElement(Panel);
          const renderPanel = () => React.createElement(Body);
          const child = () => React.createElement(Child);
          const props = { nodeTypes: { card: CardNode }, panel, renderPanel };

          export function App() {
            return React.createElement(ExternalFlow, props, child);
          }
        `,
        "src/components.ts": `
          import React from "react";
          export function Body() { return React.createElement("main"); }
          export function CardNode() { return React.createElement("article"); }
          export function Child() { return React.createElement("div"); }
          export function Panel() { return React.createElement("section"); }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "ExternalFlow", kind: "direct-render", label: undefined },
          {
            source: "ExternalFlow",
            target: "Body",
            kind: "RENDER (renderPanel)",
            label: "from App",
          },
          {
            source: "ExternalFlow",
            target: "CardNode",
            kind: "COMPONENT (nodeTypes)",
            label: "from App",
          },
          {
            source: "ExternalFlow",
            target: "Child",
            kind: "RENDER (children)",
            label: "from App",
          },
          {
            source: "ExternalFlow",
            target: "Panel",
            kind: "NODE (panel)",
            label: "from App",
          },
        ]);
      },
    );
  });

  it("follows local prop forwarding to an external boundary", async () => {
    await withFixture(
      {
        "node_modules/ui-kit/index.d.ts": `export declare function ExternalPanel(props: unknown): unknown;`,
        "node_modules/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.d.ts" } },
        }),
        "src/app.tsx": `
          import { Body, Fallback, Panel, Wrapper } from "./components";

          export function App() {
            return (
              <Wrapper
                fallbackComponent={Fallback}
                panel={<Panel />}
                renderBody={() => <Body />}
              />
            );
          }
        `,
        "src/components.tsx": `
          import { ExternalPanel } from "ui-kit";

          export function Body() { return <main />; }
          export function Fallback() { return <aside />; }
          export function Panel() { return <section />; }
          export function Wrapper({ fallbackComponent, panel, renderBody }: {
            fallbackComponent: () => unknown;
            panel: unknown;
            renderBody: () => unknown;
          }) {
            return (
              <ExternalPanel
                fallbackComponent={fallbackComponent}
                panel={panel}
                renderBody={renderBody}
              />
            );
          }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Wrapper", kind: "direct-render", label: undefined },
          {
            source: "ExternalPanel",
            target: "Body",
            kind: "RENDER (renderBody)",
            label: "from App",
          },
          {
            source: "ExternalPanel",
            target: "Fallback",
            kind: "COMPONENT (fallbackComponent)",
            label: "from App",
          },
          {
            source: "ExternalPanel",
            target: "Panel",
            kind: "NODE (panel)",
            label: "from App",
          },
          { source: "Wrapper", target: "ExternalPanel", kind: "direct-render", label: undefined },
        ]);
      },
    );
  });

  it("does not misclassify local path aliases as external component boundaries", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { AliasWrapper } from "@/factory";
          export function App() { return <AliasWrapper />; }
        `,
        "src/factory.ts": `
          function createWrapper() { return Symbol("wrapper"); }
          export const AliasWrapper = createWrapper();
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App"]);
        expect(graph.edges).toEqual([]);
      },
    );
  });

  it("does not treat unrelated createElement, memo, or callback factories as React output", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { Child } from "./child";
          const Other = { createElement: (value: unknown) => value };
          const cache = (value: unknown) => value;
          const memo = (value: unknown) => value;

          export function CustomCreate() { return Other.createElement(Child); }
          export function Cached() { return cache(() => <Child />); }
          export function Factory() { return () => <Child />; }
          export const Wrapped = memo(() => <Child />);
        `,
        "src/child.tsx": `export function Child() { return <main />; }`,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ title }) => title)).toEqual(["Child"]);
        expect(graph.edges).toEqual([]);
      },
    );
  });

  it("keeps confirmed Array.map component rendering", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { Child } from "./child";
          export function App() { return [1].map(() => <Child />); }
        `,
        "src/child.tsx": `export function Child() { return <main />; }`,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Child"]);
        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Child", kind: "direct-render", label: undefined }]);
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

  it("follows shorthand and quoted createElement props to the final renderer", async () => {
    await withFixture(
      {
        "src/app.ts": `
          import React from "react";
          import { Primitive, QuotedContent, QuotedLayout, ShorthandContent, ShorthandLayout } from "./components";
          export function App() {
            return [
              React.createElement(ShorthandLayout, null, React.createElement(ShorthandContent)),
              React.createElement(QuotedLayout, null, React.createElement(QuotedContent)),
            ];
          }
        `,
        "src/components.ts": `
          import React from "react";
          export function Primitive({ children }: { children: unknown }) {
            return React.createElement("section", null, children);
          }
          export function ShorthandContent() { return React.createElement("main"); }
          export function QuotedContent() { return React.createElement("aside"); }
          export function ShorthandLayout({ children }: { children: unknown }) {
            return React.createElement(Primitive, { children });
          }
          export function QuotedLayout({ children }: { children: unknown }) {
            return React.createElement(Primitive, { "children": children });
          }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "QuotedLayout", kind: "direct-render", label: undefined },
          { source: "App", target: "ShorthandLayout", kind: "direct-render", label: undefined },
          { source: "Primitive", target: "QuotedContent", kind: "NODE (children)", label: "from App" },
          { source: "Primitive", target: "ShorthandContent", kind: "NODE (children)", label: "from App" },
          { source: "QuotedLayout", target: "Primitive", kind: "direct-render", label: undefined },
          { source: "ShorthandLayout", target: "Primitive", kind: "direct-render", label: undefined },
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

  it("uses canonical external export names instead of local aliases", async () => {
    await withFixture(
      {
        "node_modules/ui-kit/index.d.ts": `export declare function Button(props: unknown): unknown;`,
        "node_modules/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.d.ts" } },
        }),
        "src/app.tsx": `
          import { Button as PrimaryButton } from "ui-kit";
          export function App() { return <PrimaryButton />; }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });
        const external = graph.nodes.find(({ kind }) => kind === "External React component");

        expect(external).toMatchObject({ id: "external:ui-kit#Button", title: "Button" });
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Button", kind: "direct-render", label: undefined },
        ]);
      },
    );
  });

  it("resolves local component value aliases", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { Child } from "./child";
          const Alias = Child;
          export function App() { return <Alias />; }
        `,
        "src/child.tsx": `export function Child() { return <main />; }`,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Child"]);
        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Child", kind: "direct-render", label: undefined }]);
      },
    );
  });

  it("collapses component and file filters through the same parent-supplied path", async () => {
    await withFixture(
      {
        "dist/built.tsx": `export function Built() { return <div />; }`,
        "src/app.tsx": `
          import { Content } from "./content";
          import { Layout } from "./layout";
          export function App() { return <Layout><Content /></Layout>; }
        `,
        "src/content.tsx": `export function Content() { return <main />; }`,
        "src/feature.test.tsx": `export function TestOnly() { return <div />; }`,
        "src/generated.generated.tsx": `export function Generated() { return <div />; }`,
        "src/layout.tsx": `
          export function Header() { return <header />; }
          export function Layout({ children }: { children: unknown }) {
            return <section><Header />{children}</section>;
          }
        `,
      },
      async (scopePath) => {
        const common = { scopePath, sourcePaths: ["src", "dist"] } as const;
        const [componentFiltered, fileFiltered] = await Promise.all([
          generateReactComponentStructureGraph({ ...common, excludeComponentPatterns: ["Layout"] }),
          generateReactComponentStructureGraph({ ...common, excludeFilePatterns: ["src/layout.tsx"] }),
        ]);

        for (const graph of [componentFiltered, fileFiltered]) {
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Content"]);
          expect(edgeFacts(graph)).toEqual([
            { source: "App", target: "Content", kind: "NODE (children)", label: "from App" },
          ]);
        }
      },
    );
  });

  it("passes every supplied relationship kind through a hidden component", async () => {
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
          export function Internal() { return <aside />; }
          export function Frame({ header, renderBody, footerComponent: FooterComponent }: {
            header: unknown;
            renderBody: () => unknown;
            footerComponent: () => unknown;
          }) {
            return <><Internal />{header}{renderBody()}<FooterComponent /></>;
          }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["Frame"],
        });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Body", "Footer", "Header"]);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Body", kind: "RENDER (renderBody)", label: "from App" },
          {
            source: "App",
            target: "Footer",
            kind: "COMPONENT (footerComponent)",
            label: "from App",
          },
          { source: "App", target: "Header", kind: "NODE (header)", label: "from App" },
        ]);
      },
    );
  });

  it("uses the last visible public prop when forwarding reaches a hidden implementation", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { Content, Wrapper } from "./components";
          export function App() { return <Wrapper><Content /></Wrapper>; }
        `,
        "src/components.tsx": `
          export function Content() { return <main />; }
          export function Internal() { return <aside />; }
          export function Hidden({ slot }: { slot: unknown }) { return <><Internal />{slot}</>; }
          export function Wrapper({ children }: { children: unknown }) { return <Hidden slot={children} />; }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["Hidden"],
        });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Content", "Wrapper"]);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Wrapper", kind: "direct-render", label: undefined },
          { source: "Wrapper", target: "Content", kind: "NODE (children)", label: "from App" },
        ]);
      },
    );
  });

  it("does not pass a supplied value through a later prop override", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { Content, Wrapper } from "./components";
          export function App() { return <Wrapper><Content /></Wrapper>; }
        `,
        "src/components.tsx": `
          export function Content() { return <main />; }
          export function Own() { return <aside />; }
          export function Primitive({ children }: { children: unknown }) { return <section>{children}</section>; }
          export function Wrapper({ children }: { children: unknown }) {
            return <Primitive {...{ children }} children={<Own />} />;
          }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["Wrapper"],
        });

        expect(graph.nodes.map(({ title }) => title)).toEqual(["App"]);
        expect(graph.edges).toEqual([]);
      },
    );
  });

  it("respects JSX spread override order in forwarded consumer rules", async () => {
    await withFixture(
      {
        "node_modules/ui-kit/index.d.ts": `export declare function External(props: unknown): unknown;`,
        "node_modules/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.d.ts" } },
        }),
        "src/app.tsx": `
          import { ExplicitWrapper, StaticSpreadWrapper, UnknownSpreadWrapper } from "./components";
          export function A() { return <main />; }
          export function App() {
            return <>
              <ExplicitWrapper panel={<A />} />
              <StaticSpreadWrapper panel={<A />} />
              <UnknownSpreadWrapper panel={<A />} replacement={{}} />
            </>;
          }
        `,
        "src/components.tsx": `
          import { External } from "ui-kit";
          export function B() { return <aside />; }
          export function ExplicitWrapper({ panel }: { panel: unknown }) {
            const props = { panel };
            return <External {...props} panel={<B />} />;
          }
          export function StaticSpreadWrapper({ panel }: { panel: unknown }) {
            return <External panel={panel} {...{ panel: <B /> }} />;
          }
          export function UnknownSpreadWrapper({ panel, replacement }: { panel: unknown; replacement: object }) {
            return <External panel={panel} {...replacement} />;
          }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.some(({ title }) => title === "A")).toBe(false);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "ExplicitWrapper", kind: "direct-render", label: undefined },
          { source: "App", target: "StaticSpreadWrapper", kind: "direct-render", label: undefined },
          { source: "App", target: "UnknownSpreadWrapper", kind: "direct-render", label: undefined },
          { source: "ExplicitWrapper", target: "External", kind: "direct-render", label: undefined },
          {
            source: "External",
            target: "B",
            kind: "NODE (panel)",
            label: "from ExplicitWrapper, StaticSpreadWrapper",
          },
          { source: "StaticSpreadWrapper", target: "External", kind: "direct-render", label: undefined },
          { source: "UnknownSpreadWrapper", target: "External", kind: "direct-render", label: undefined },
        ]);
      },
    );
  });

  it("keeps children forwarding through whitespace and comment-only JSX bodies", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { Content, Wrapper } from "./components";
          export function App() { return <Wrapper><Content /></Wrapper>; }
        `,
        "src/components.tsx": `
          export function Content() { return <main />; }
          export function Primitive({ children }: { children: unknown }) { return <section>{children}</section>; }
          export function Wrapper({ children }: { children: unknown }) {
            return <Primitive {...{ children }}>
              {/* spacing only */}
            </Primitive>;
          }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["Wrapper"],
        });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Content"]);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Content", kind: "NODE (children)", label: "from App" },
        ]);
      },
    );
  });

  it("passes nested supplied values through a hidden supplied target", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { Content, Hidden, Layout } from "./components";
          export function App() { return <Layout><Hidden><Content /></Hidden></Layout>; }
        `,
        "src/components.tsx": `
          export function Content() { return <main />; }
          export function Internal() { return <aside />; }
          export function Hidden({ children }: { children: unknown }) { return <><Internal />{children}</>; }
          export function Layout({ children }: { children: unknown }) { return <section>{children}</section>; }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["Hidden"],
        });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Content", "Layout"]);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Layout", kind: "direct-render", label: undefined },
          { source: "Layout", target: "Content", kind: "NODE (children)", label: "from App" },
        ]);
      },
    );
  });

  it("keeps the visible relationship kind across consecutive hidden supplied targets", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { Content, Hidden, Layout } from "./components";
          export function App() { return <Layout render={() => <Hidden slot={<Content />} />} />; }
        `,
        "src/components.tsx": `
          export function Content() { return <main />; }
          export function Hidden({ slot }: { slot: unknown }) { return <section>{slot}</section>; }
          export function Layout({ render }: { render: () => unknown }) { return <>{render()}</>; }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["Hidden"],
        });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Content", "Layout"]);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Layout", kind: "direct-render", label: undefined },
          { source: "Layout", target: "Content", kind: "RENDER (render)", label: "from App" },
        ]);
      },
    );
  });

  it("keeps supplied targets with their own parent when a hidden definition is reused", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { ParentA, ParentB } from "./parents";
          export function App() { return <><ParentA /><ParentB /></>; }
        `,
        "src/parents.tsx": `
          export function ContentA() { return <main>A</main>; }
          export function ContentB() { return <main>B</main>; }
          export function Layout({ children }: { children: unknown }) { return <section>{children}</section>; }
          export function ParentA() { return <Layout><ContentA /></Layout>; }
          export function ParentB() { return <Layout><ContentB /></Layout>; }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["Layout"],
        });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "ParentA", kind: "direct-render", label: undefined },
          { source: "App", target: "ParentB", kind: "direct-render", label: undefined },
          { source: "ParentA", target: "ContentA", kind: "NODE (children)", label: "from ParentA" },
          { source: "ParentB", target: "ContentB", kind: "NODE (children)", label: "from ParentB" },
        ]);
      },
    );
  });

  it("collapses an explicitly hidden external boundary without expanding package internals", async () => {
    await withFixture(
      {
        "node_modules/ui-kit/index.d.ts": `export declare function ExternalLayout(props: unknown): unknown;`,
        "node_modules/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.d.ts" } },
        }),
        "src/app.tsx": `
          import { ExternalLayout } from "ui-kit";
          export function Content() { return <main />; }
          export function App() { return <ExternalLayout><Content /></ExternalLayout>; }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["ExternalLayout"],
        });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Content"]);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Content", kind: "NODE (children)", label: "from App" },
        ]);
      },
    );
  });

  it("keeps a shared definition when a visible path still reaches it", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { Hidden, Shared } from "./components";
          export function App() { return <><Hidden /><Shared /></>; }
        `,
        "src/components.tsx": `
          export function Shared() { return <main />; }
          export function Hidden() { return <Shared />; }
        `,
      },
      async (scopePath) => {
        const graph = await generateReactComponentStructureGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["Hidden"],
        });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Shared"]);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Shared", kind: "direct-render", label: undefined },
        ]);
      },
    );
  });

  it("preserves source cycles without making hidden implementations new roots", async () => {
    await withFixture(
      {
        "src/cycle.tsx": `
          export function A() { return <B />; }
          export function B() { return <A />; }
        `,
      },
      async (scopePath) => {
        const baseline = await generateReactComponentStructureGraph({ scopePath, sourcePaths: ["src"] });
        const filtered = await generateReactComponentStructureGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["B"],
        });

        expect(edgeFacts(baseline)).toEqual([
          { source: "A", target: "B", kind: "direct-render", label: undefined },
          { source: "B", target: "A", kind: "direct-render", label: undefined },
        ]);
        expect(filtered.nodes.map(({ title }) => title)).toEqual(["A"]);
        expect(filtered.edges).toEqual([]);
      },
    );
  });

  it("rejects filters that would violate the nonempty Diagram.graph schema", async () => {
    await withFixture({ "src/app.tsx": `export function App() { return <main />; }` }, async (scopePath) => {
      await expect(
        generateReactComponentStructureGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["**"],
        }),
      ).rejects.toThrow("No React component definitions remain after filtering.");
    });
  });

  it("rejects caller-selected output paths", async () => {
    await withFixture({ "src/app.tsx": `export function App() { return <main />; }` }, async (scopePath) => {
      const outputs: string[] = [];

      await expect(
        executeReactComponentStructureCommand(["--scope", scopePath, "--source", "src", "--output", "tracked.json"], {
          writeStdout: (output) => outputs.push(output),
        }),
      ).rejects.toThrow("Unknown argument: --output");
      expect(outputs).toEqual([]);
    });
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
