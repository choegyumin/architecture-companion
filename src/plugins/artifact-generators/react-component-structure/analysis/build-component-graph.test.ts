import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { ComponentStructureDiagramGraph } from "@/features/diagram/diagram-graph";

import { buildComponentGraph } from "./build-component-graph";

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

function originProps(graph: ComponentStructureDiagramGraph, nodeId: string): string[] {
  const node = graph.nodes.find(({ id }) => id === nodeId);
  return node?.type === "default"
    ? (node.component?.origins ?? []).map(({ supplierTitle, prop }) => `${supplierTitle}:${prop}`).toSorted()
    : [];
}

function edgeFacts(graph: ComponentStructureDiagramGraph) {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.edges
    .map((edge) => ({
      source: nodesById.get(edge.source)?.title,
      target: nodesById.get(edge.target)?.title,
      // Edges carry no labels any more; supplied targets record which prop
      // each supplier provided in their component origins.
      supplies: originProps(graph, edge.target),
    }))
    .toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function externalPackageFiles(declarations: string): Readonly<Record<string, string>> {
  return {
    "node_modules/ui-kit/index.d.ts": declarations,
    "node_modules/ui-kit/package.json": JSON.stringify({
      name: "ui-kit",
      type: "module",
      exports: { ".": { types: "./index.d.ts" } },
    }),
  };
}

describe("React component structure generator", () => {
  it("shares identical compositions without mixing different forwarded children", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          function Shared() { return <span />; }
          function First() { return <Shared />; }
          function Second() { return <Shared />; }
          function Renderer({ children }) { return <main>{children}</main>; }
          function Wrapper({ children }) { return <Renderer>{children}</Renderer>; }
          export function App() {
            return <>
              <Wrapper><First /></Wrapper>
              <Wrapper><Second /></Wrapper>
              <Wrapper><First /></Wrapper>
            </>;
          }
        `,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"], rootPatterns: ["App"] });
        const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
        const wrappers = graph.nodes.filter((node) => node.title === "Wrapper");
        expect(wrappers).toHaveLength(2);
        expect(graph.nodes.filter((node) => node.title === "Renderer")).toHaveLength(2);
        expect(graph.nodes.filter((node) => node.title === "Shared")).toHaveLength(1);
        expect(graph.nodes).toHaveLength(8);
        expect(graph.edges).toHaveLength(8);
        expect(graph.edges.filter((edge) => nodesById.get(edge.source)?.title === "App")).toHaveLength(2);
        const compositions = wrappers.map((wrapper) => {
          const rendererEdges = graph.edges.filter((edge) => edge.source === wrapper.id);
          expect(rendererEdges).toHaveLength(1);
          const renderer = nodesById.get(rendererEdges.at(0)!.target)!;
          expect(renderer.title).toBe("Renderer");
          const children = graph.edges.filter((edge) => edge.source === renderer.id);
          expect(children).toHaveLength(1);
          expect(originProps(graph, children.at(0)!.target)).toEqual(["App:children"]);
          return nodesById.get(children.at(0)!.target)?.title;
        });
        expect(compositions.toSorted()).toEqual(["First", "Second"]);
      },
    );
  });

  it.each([{ excludeComponentPatterns: ["Hidden"] }, { excludeFilePatterns: ["src/hidden.tsx"] }])(
    "keeps distinct forwarded contexts across a hidden boundary: %j",
    async (filters) => {
      await withFixture(
        {
          "src/app.tsx": `
          import { Hidden } from "./hidden";
          function First() { return <main />; }
          function Second() { return <aside />; }
          function Wrapper({ children }) { return <Hidden slot={children} />; }
          export function App() {
            return <><Wrapper><First /></Wrapper><Wrapper><Second /></Wrapper><Wrapper><First /></Wrapper></>;
          }
        `,
          "src/hidden.tsx": `
          function Internal() { return <header />; }
          function Renderer({ body }) { return <>{body}</>; }
          export function Hidden({ slot }) { return <><Internal /><Renderer body={slot} /></>; }
        `,
        },
        async (scopePath) => {
          const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"], ...filters });
          const titlesById = new Map(graph.nodes.map(({ id, title }) => [id, title]));
          const wrappers = graph.nodes.filter(({ title }) => title === "Wrapper");
          expect(wrappers).toHaveLength(2);
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual([
            "App",
            "First",
            "Second",
            "Wrapper",
            "Wrapper",
          ]);
          const compositions = wrappers.map(({ id }) => {
            const outgoing = graph.edges.filter(({ source }) => source === id);
            expect(outgoing).toHaveLength(1);
            expect(originProps(graph, outgoing.at(0)!.target)).toEqual(["App:children"]);
            return titlesById.get(outgoing.at(0)!.target);
          });
          expect(compositions.toSorted()).toEqual(["First", "Second"]);
          expect(graph.edges.filter(({ source }) => titlesById.get(source) === "App")).toHaveLength(2);
        },
      );
    },
  );

  it("keeps receiver usages apart when identical content arrives from structurally different suppliers", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          function Leaf() { return <span />; }
          function Child({ children }) { return <main>{children}</main>; }
          function Mark() { return <b />; }
          function Other() { return <i />; }
          function Sup({ extra }) {
            return <section>{extra}<Child><Leaf /></Child></section>;
          }
          export function App() {
            return <><Sup extra={<Mark />} /><Sup extra={<Other />} /></>;
          }
        `,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"], rootPatterns: ["App"] });
        const children = graph.nodes.filter(({ title }) => title === "Child");
        // Both Sup contexts render the same Child with the same Leaf content,
        // but the suppliers are structurally different usages, so the receiver
        // stays one node per customizing supplier instead of merging.
        expect(children).toHaveLength(2);
        for (const child of children) {
          const leafEdges = graph.edges.filter(({ source }) => source === child.id);
          expect(leafEdges).toHaveLength(1);
          expect(graph.nodes.find(({ id }) => id === leafEdges.at(0)!.target)?.title).toBe("Leaf");
        }
        expect(graph.nodes.filter(({ title }) => title === "Sup")).toHaveLength(2);
        expect(graph.nodes.filter(({ title }) => title === "Leaf")).toHaveLength(1);
      },
    );
  });

  it("keeps every supplied relationship kind attached to its own composition", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          function Marker() { return <span />; }
          function Left() { return <Marker />; }
          function Right() { return <Marker />; }
          function Renderer({ panel, render, component: Component }) {
            return <>{panel}{render()}<Component /></>;
          }
          function Wrapper(props) { return <Renderer {...props} />; }
          export function App() {
            return <>
              <Wrapper panel={<Left />} render={() => <Left />} component={Left} />
              <Wrapper panel={<Right />} render={() => <Right />} component={Right} />
            </>;
          }
        `,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });
        const titlesById = new Map(graph.nodes.map(({ id, title }) => [id, title]));
        const renderers = graph.nodes.filter(({ title }) => title === "Renderer");
        expect(renderers).toHaveLength(2);
        expect(graph.nodes.filter(({ title }) => title === "Marker")).toHaveLength(1);
        const compositions = renderers.map(({ id }) => {
          const edges = graph.edges.filter(({ source }) => source === id);
          expect(edges).toHaveLength(3);
          for (const edge of edges) {
            expect(originProps(graph, edge.target)).toEqual(["App:component", "App:panel", "App:render"]);
          }
          return edges.map(({ target }) => titlesById.get(target)).toSorted();
        });
        expect(compositions.toSorted()).toEqual([
          ["Left", "Left", "Left"],
          ["Right", "Right", "Right"],
        ]);
      },
    );
  });

  it("does not merge distinct supplier definitions with the same display name", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { Parent as First } from "./first";
          import { Parent as Second } from "./second";
          export function App() { return <><First /><Second /></>; }
        `,
        "src/first.tsx": `
          import { Content, Renderer } from "./renderer";
          export function Parent() { return <Renderer><Content /></Renderer>; }
        `,
        "src/second.tsx": `
          import { Content, Renderer } from "./renderer";
          export function Parent() { return <Renderer><Content /></Renderer>; }
        `,
        "src/renderer.tsx": `
          export function Content() { return <main />; }
          export function Renderer({ children }) { return <section>{children}</section>; }
        `,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });
        const renderers = graph.nodes.filter(({ title }) => title === "Renderer");
        expect(renderers).toHaveLength(2);
        const content = graph.nodes.filter(({ title }) => title === "Content");
        expect(content).toHaveLength(1);
        for (const { id } of renderers) {
          expect(graph.edges.filter(({ source }) => source === id)).toEqual([
            expect.objectContaining({ target: content.at(0)!.id }),
          ]);
          // Two distinct supplier definitions share the display name; both stay.
          expect(originProps(graph, content.at(0)!.id)).toEqual(["Parent:children", "Parent:children"]);
        }
        expect(new Set(graph.edges.map(({ id }) => id)).size).toBe(graph.edges.length);
      },
    );
  });

  it("shares identical recursive compositions and preserves their cycle", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          function A() { return <B />; }
          function B() { return <A />; }
          function First() { return <A />; }
          function Second() { return <A />; }
          export function App() { return <><First /><Second /></>; }
        `,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });
        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["A", "App", "B", "First", "Second"]);
        expect(edgeFacts(graph)).toEqual([
          { source: "A", target: "B", supplies: [] },
          { source: "App", target: "First", supplies: [] },
          { source: "App", target: "Second", supplies: [] },
          { source: "B", target: "A", supplies: [] },
          { source: "First", target: "A", supplies: [] },
          { source: "Second", target: "A", supplies: [] },
        ]);
      },
    );
  });

  it("keeps explicit nesting distinct from definition recursion", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          function Content() { return <main />; }
          function Layout({ children }) { return <section>{children}</section>; }
          export function App() { return <Layout><Layout><Content /></Layout></Layout>; }
        `,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });
        const appId = graph.nodes.find(({ title }) => title === "App")!.id;
        const contentId = graph.nodes.find(({ title }) => title === "Content")!.id;
        const outerId = graph.edges.find(({ source }) => source === appId)!.target;
        const innerId = graph.edges.find(({ source }) => source === outerId)!.target;
        expect(graph.nodes.filter(({ title }) => title === "Layout")).toHaveLength(2);
        expect(innerId).not.toBe(outerId);
        expect(graph.edges.filter(({ source }) => source === innerId)).toEqual([
          expect.objectContaining({ target: contentId }),
        ]);
        expect(originProps(graph, contentId)).toEqual(["App:children"]);
      },
    );
  });

  it("keeps distinct composition identities stable across bases and root selection", async () => {
    const files = {
      "src/app.tsx": `
        function Left() { return <main />; }
        function Right() { return <aside />; }
        function Layout({ children }) { return <section>{children}</section>; }
        export function App() { return <><Layout><Left /></Layout><Layout><Right /></Layout></>; }
      `,
    };
    await withFixture(files, async (scopePath) => {
      const options = { scopePath, sourcePaths: ["src"] };
      const graph = await buildComponentGraph({ ...options, rootPatterns: ["Layout"] });
      expect(await buildComponentGraph({ ...options, rootPatterns: ["component:src/app.tsx#Layout"] })).toEqual(graph);
      expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["Layout", "Layout", "Left", "Right"]);
      const leftId = graph.nodes.find(({ title }) => title === "Left")!.id;
      const leftLayoutId = graph.edges.find(({ target }) => target === leftId)!.source;
      const selected = await buildComponentGraph({ ...options, rootPatterns: [leftLayoutId] });
      expect(selected.nodes.map(({ title }) => title).toSorted()).toEqual(["Layout", "Left"]);
      await withFixture(files, async (secondScopePath) => {
        expect(await buildComponentGraph({ ...options, scopePath: secondScopePath, rootPatterns: ["Layout"] })).toEqual(
          graph,
        );
      });
    });
  });

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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Content", "Layout"]);
        expect(graph.nodes.every((node) => !("kind" in node))).toBe(true);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Layout", supplies: [] },
          { source: "Layout", target: "Content", supplies: ["App:children"] },
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Frame", supplies: [] },
          { source: "Frame", target: "Body", supplies: ["App:renderBody"] },
          {
            source: "Frame",
            target: "Footer",
            supplies: ["App:footerComponent"],
          },
          { source: "Frame", target: "Header", supplies: ["App:header"] },
        ]);
      },
    );
  });

  it("traces component props through default-exported resource objects", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { Frame } from "./frame";
          import slots from "./slots";
          export function App() { return <Frame {...slots} />; }
        `,
        "src/slots.ts": `
          import { Footer } from "./frame";
          export default { footerComponent: Footer };
        `,
        "src/frame.tsx": `
          export function Footer() { return <footer />; }

          export function Frame({ footerComponent: FooterComponent }: {
            footerComponent?: () => unknown;
          }) {
            return <FooterComponent />;
          }
        `,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toContainEqual({
          source: "Frame",
          target: "Footer",
          supplies: ["App:footerComponent"],
        });
      },
    );
  });

  it("keeps different suppliers separate while sharing identical supplied components", async () => {
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
        const first = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });
        const second = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });
        expect(second).toEqual(first);
        expect(first.nodes.filter(({ title }) => title === "Content")).toHaveLength(1);
        for (const title of ["Wrapper", "Renderer"]) {
          expect(first.nodes.filter((node) => node.title === title)).toHaveLength(2);
        }
        const contentId = first.nodes.find(({ title }) => title === "Content")!.id;
        for (const parent of ["ParentA", "ParentB"]) {
          const parentId = first.nodes.find(({ title }) => title === parent)!.id;
          const wrapperId = first.edges.find(({ source }) => source === parentId)!.target;
          const rendererId = first.edges.find(({ source }) => source === wrapperId)!.target;
          expect(first.nodes.find(({ id }) => id === wrapperId)?.title).toBe("Wrapper");
          expect(first.nodes.find(({ id }) => id === rendererId)?.title).toBe("Renderer");
          expect(first.edges.filter(({ source }) => source === rendererId)).toEqual([
            expect.objectContaining({ target: contentId }),
          ]);
        }
        expect(originProps(first, contentId)).toEqual(["ParentA:content", "ParentB:content"]);
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Frame", supplies: [] },
          { source: "Frame", target: "Body", supplies: ["App:children"] },
          { source: "Frame", target: "ExternalPanel", supplies: [] },
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Wrapper", supplies: [] },
          { source: "Primitive", target: "Body", supplies: ["App:render"] },
          { source: "Wrapper", target: "Primitive", supplies: [] },
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Layout", supplies: [] },
          { source: "App", target: "Wrapper", supplies: [] },
          { source: "Layout", target: "Primitive", supplies: [] },
          { source: "Primitive", target: "Content", supplies: ["App:children", "App:content"] },
          { source: "Primitive", target: "Content", supplies: ["App:children", "App:content"] },
          { source: "Wrapper", target: "Primitive", supplies: [] },
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual([
          "App",
          "Body",
          "ExternalFrame",
          "ExternalLeaf",
          "Header",
        ]);
        const externalFrame = graph.nodes.find(({ title }) => title === "ExternalFrame");
        expect(externalFrame).toMatchObject({ description: "ui-kit boundary" });
        expect(externalFrame).not.toHaveProperty("kind");
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "ExternalFrame", supplies: [] },
          {
            source: "ExternalFrame",
            target: "Body",
            supplies: ["App:children"],
          },
          {
            source: "ExternalFrame",
            target: "ExternalLeaf",
            supplies: ["App:children"],
          },
          {
            source: "ExternalFrame",
            target: "Header",
            supplies: ["App:header"],
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "ExternalFlow", supplies: [] },
          {
            source: "ExternalFlow",
            target: "CardNode",
            supplies: ["App:nodeTypes"],
          },
          {
            source: "ExternalFlow",
            target: "Fallback",
            supplies: ["App:fallbackComponent"],
          },
          {
            source: "ExternalFlow",
            target: "Panel",
            supplies: ["App:renderPanel"],
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.some(({ title }) => title === "darkTheme")).toBe(false);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "ExternalFlow", supplies: [] },
          {
            source: "ExternalFlow",
            target: "Body",
            supplies: ["App:renderPanel"],
          },
          {
            source: "ExternalFlow",
            target: "CardNode",
            supplies: ["App:nodeTypes"],
          },
          {
            source: "ExternalFlow",
            target: "Fallback",
            supplies: ["App:fallbackComponent"],
          },
          {
            source: "ExternalFlow",
            target: "Panel",
            supplies: ["App:panel"],
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.some(({ title }) => title === "format")).toBe(false);
        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "ExternalFlow", supplies: [] }]);
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Wrapper", supplies: [] },
          {
            source: "ExternalFlow",
            target: "CardNode",
            supplies: ["App:nodeTypes"],
          },
          {
            source: "ExternalFlow",
            target: "Content",
            supplies: ["App:content"],
          },
          { source: "Wrapper", target: "ExternalFlow", supplies: [] },
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.filter(({ title }) => title === "Wrapper")).toHaveLength(2);
        expect(graph.nodes.filter(({ title }) => title === "ExternalFlow")).toHaveLength(2);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Wrapper", supplies: [] },
          { source: "App", target: "Wrapper", supplies: [] },
          {
            source: "ExternalFlow",
            target: "Body",
            supplies: ["App:children"],
          },
          {
            source: "ExternalFlow",
            target: "Child",
            supplies: ["App:children"],
          },
          { source: "Wrapper", target: "ExternalFlow", supplies: [] },
          { source: "Wrapper", target: "ExternalFlow", supplies: [] },
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Wrapper", supplies: [] },
          {
            source: "ExternalFlow",
            target: "Body",
            supplies: ["App:renderBody"],
          },
          {
            source: "ExternalFlow",
            target: "CardNode",
            supplies: ["App:cardComponent"],
          },
          {
            source: "ExternalFlow",
            target: "Child",
            supplies: ["App:children"],
          },
          {
            source: "ExternalFlow",
            target: "Panel",
            supplies: ["App:panel"],
          },
          { source: "Wrapper", target: "ExternalFlow", supplies: [] },
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "ExternalFlow", supplies: [] },
          {
            source: "ExternalFlow",
            target: "Body",
            supplies: ["App:renderPanel"],
          },
          {
            source: "ExternalFlow",
            target: "CardNode",
            supplies: ["App:nodeTypes"],
          },
          {
            source: "ExternalFlow",
            target: "Child",
            supplies: ["App:children"],
          },
          {
            source: "ExternalFlow",
            target: "Panel",
            supplies: ["App:panel"],
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Wrapper", supplies: [] },
          {
            source: "ExternalPanel",
            target: "Body",
            supplies: ["App:renderBody"],
          },
          {
            source: "ExternalPanel",
            target: "Fallback",
            supplies: ["App:fallbackComponent"],
          },
          {
            source: "ExternalPanel",
            target: "Panel",
            supplies: ["App:panel"],
          },
          { source: "Wrapper", target: "ExternalPanel", supplies: [] },
        ]);
      },
    );
  });

  it.each([
    {
      name: "JSX",
      render: `<UI.Boundary panel={panel} renderBody={renderBody} component={component} packageValue={UI.content}>{children}</UI.Boundary>`,
    },
    {
      name: "createElement",
      render: `createElement(UI /* boundary */ . Boundary, { panel, renderBody, component, packageValue: UI.content }, children)`,
    },
  ])("keeps caller supplies across a CommonJS boundary rendered with $name", async ({ render }) => {
    await withFixture(
      {
        "packages/ui-kit/package.json": JSON.stringify({ name: "ui-kit", types: "index.tsx" }),
        "packages/ui-kit/index.tsx": `
          import { PackageOnly } from "primitives";
          function Boundary(props: unknown) { return <PackageOnly />; }
          const UI = { Boundary, content: <PackageOnly /> };
          export = UI;
        `,
        "node_modules/primitives/index.d.ts": `export declare function PackageOnly(): any;`,
        "src/local.ts": `import "../packages/ui-kit";`,
        "src/barrel.ts": `export * as UI from "ui-kit";`,
        "src/wrapper.tsx": `
          import { createElement } from "react";
          import * as Barrel from "./barrel";
          const UI = Barrel /* namespace */ . UI;
          export function Wrapper({ children, panel, renderBody, component }) { return ${render}; }
        `,
        "src/app.tsx": `
          import { Wrapper } from "./wrapper";
          function Child() { return <main />; }
          function Panel() { return <aside />; }
          function Body() { return <article />; }
          function Item() { return <button />; }
          export function App() {
            return <Wrapper panel={<Panel />} renderBody={() => <Body />} component={Item}><Child /></Wrapper>;
          }
        `,
      },
      async (scopePath) => {
        await symlink(join(scopePath, "packages/ui-kit"), join(scopePath, "node_modules/ui-kit"), "junction");
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual([
          "App",
          "Body",
          "Boundary",
          "Child",
          "Item",
          "Panel",
          "Wrapper",
        ]);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Wrapper", supplies: [] },
          { source: "Boundary", target: "Body", supplies: ["App:renderBody"] },
          { source: "Boundary", target: "Child", supplies: ["App:children"] },
          { source: "Boundary", target: "Item", supplies: ["App:component"] },
          { source: "Boundary", target: "Panel", supplies: ["App:panel"] },
          { source: "Wrapper", target: "Boundary", supplies: [] },
        ]);
      },
    );
  });

  it.each([
    { name: "package imports", moduleSpecifier: "ui-kit", localImport: "" },
    {
      name: "mixed package and relative imports",
      moduleSpecifier: "ui-kit",
      localImport: `import "../packages/ui-kit";`,
    },
    {
      name: "mixed barrel and relative imports",
      moduleSpecifier: "./barrel",
      localImport: `import "../packages/ui-kit";`,
    },
    {
      name: "mixed path-alias and relative imports",
      moduleSpecifier: "@/barrel",
      localImport: `import "../packages/ui-kit";`,
    },
  ])("keeps linked package boundaries with $name", async ({ moduleSpecifier, localImport }) => {
    await withFixture(
      {
        "packages/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.tsx" } },
        }),
        "packages/ui-kit/index.tsx": `
          function InternalButton({ children }: { children: unknown }) { return <button>{children}</button>; }
          export function Button({ children }: { children: unknown }) { return <InternalButton>{children}</InternalButton>; }
        `,
        "src/local.ts": localImport,
        "src/barrel.ts": `export * from "ui-kit";`,
        "src/app.tsx": `
          import { Button as LinkedButton } from "${moduleSpecifier}";
          export function Content() { return <main />; }
          export function App() { return <LinkedButton><Content /></LinkedButton>; }
        `,
      },
      async (scopePath) => {
        await symlink(join(scopePath, "packages/ui-kit"), join(scopePath, "node_modules/ui-kit"), "junction");

        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ id }) => id).toSorted()).toEqual([
          "component:src/app.tsx#App",
          "component:src/app.tsx#Content",
          "external:ui-kit#Button",
        ]);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Button", supplies: [] },
          { source: "Button", target: "Content", supplies: ["App:children"] },
        ]);
      },
    );
  });

  it.each([
    {
      name: "direct imports",
      imports: `
        import { Button as PackageButton } from "ui-kit";
        import { Button as LocalButton } from "../packages/ui-kit";
      `,
    },
    {
      name: "const aliases",
      imports: `
        import { Button as ImportedPackageButton } from "ui-kit";
        import { Button as ImportedLocalButton } from "../packages/ui-kit";
        const PackageButton = ImportedPackageButton;
        const LocalButton = ImportedLocalButton;
      `,
    },
    {
      name: "namespace barrel and path-alias imports",
      imports: `
        import * as Package from "./package-barrel";
        import * as Local from "@/local-barrel";
        const PackageButton = Package /* member */ . Button;
        const LocalButton = Local . Button;
      `,
    },
    {
      name: "explicit preserveSymlinks",
      imports: `
        import { Button as PackageButton } from "ui-kit";
        import { Button as LocalButton } from "../packages/ui-kit";
      `,
      preserveSymlinks: true,
    },
  ])(
    "keeps package and relative renderings distinct with selected source and $name",
    async ({ imports, preserveSymlinks }) => {
      await withFixture(
        {
          "tsconfig.json": JSON.stringify({
            compilerOptions: {
              module: "ESNext",
              moduleResolution: "Bundler",
              jsx: "preserve",
              baseUrl: ".",
              paths: { "@/*": ["src/*"] },
              preserveSymlinks,
            },
          }),
          "packages/ui-kit/package.json": JSON.stringify({ name: "ui-kit", types: "index.tsx" }),
          "packages/ui-kit/index.tsx": `
          function Internal() { return <button />; }
          export function Button() { return <Internal />; }
        `,
          "src/package-barrel.ts": `export * from "ui-kit";`,
          "src/local-barrel.ts": `export { Button } from "../packages/ui-kit"; export * from "ui-kit";`,
          "src/app.tsx": `
          ${imports}
          export function App() { return <><PackageButton /><LocalButton /></>; }
        `,
        },
        async (scopePath) => {
          await symlink(join(scopePath, "packages/ui-kit"), join(scopePath, "node_modules/ui-kit"), "junction");
          const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src", "packages/ui-kit"] });

          expect(graph.nodes.map(({ id }) => id)).toEqual([
            "component:packages/ui-kit/index.tsx#Button",
            "component:packages/ui-kit/index.tsx#Internal",
            "component:src/app.tsx#App",
            "external:ui-kit#Button",
          ]);
          expect(graph.edges.map(({ source, target }) => [source, target]).toSorted()).toEqual([
            ["component:packages/ui-kit/index.tsx#Button", "component:packages/ui-kit/index.tsx#Internal"],
            ["component:src/app.tsx#App", "component:packages/ui-kit/index.tsx#Button"],
            ["component:src/app.tsx#App", "external:ui-kit#Button"],
          ]);
        },
      );
    },
  );

  it("keeps package provenance for component props whose source is also selected locally", async () => {
    await withFixture(
      {
        "packages/ui-kit/package.json": JSON.stringify({ name: "ui-kit", types: "index.tsx" }),
        "packages/ui-kit/index.tsx": `export function Button() { return <button />; }`,
        "node_modules/host-kit/index.d.ts": `export declare function Host(props: unknown): any;`,
        "src/app.tsx": `
          import { Host } from "host-kit";
          import { Button as PackageButton } from "ui-kit";
          import { Button as LocalButton } from "../packages/ui-kit";
          const registry = { PackageButton, LocalButton };
          export function App() { return <Host components={registry} />; }
        `,
      },
      async (scopePath) => {
        await symlink(join(scopePath, "packages/ui-kit"), join(scopePath, "node_modules/ui-kit"), "junction");
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src", "packages/ui-kit"] });

        expect(graph.nodes.map(({ id }) => id)).toEqual([
          "component:packages/ui-kit/index.tsx#Button",
          "component:src/app.tsx#App",
          "external:host-kit#Host",
          "external:ui-kit#Button",
        ]);
        expect(
          graph.edges
            .map((edge) => ({ source: edge.source, target: edge.target, supplies: originProps(graph, edge.target) }))
            .toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
        ).toEqual([
          {
            source: "component:src/app.tsx#App",
            target: "external:host-kit#Host",
            supplies: [],
          },
          {
            source: "external:host-kit#Host",
            target: "component:packages/ui-kit/index.tsx#Button",
            supplies: ["App:components"],
          },
          {
            source: "external:host-kit#Host",
            target: "external:ui-kit#Button",
            supplies: ["App:components"],
          },
        ]);
      },
    );
  });

  it("keeps workspace package provenance through export-star barrels", async () => {
    await withFixture(
      {
        "packages/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./dist/index.d.ts" } },
        }),
        "packages/ui-kit/dist/package.json": JSON.stringify({ type: "module" }),
        "packages/ui-kit/dist/index.d.ts": `export { Button } from "./button";`,
        "packages/ui-kit/dist/button.d.ts": `export declare function Button(props: unknown): unknown;`,
        "src/barrel.ts": `export * from "ui-kit";`,
        "src/app.tsx": `
          import { Button as LinkedButton } from "./barrel";
          export function App() { return <LinkedButton />; }
        `,
      },
      async (scopePath) => {
        await symlink(join(scopePath, "packages/ui-kit"), join(scopePath, "node_modules/ui-kit"), "junction");

        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ id }) => id).toSorted()).toEqual([
          "component:src/app.tsx#App",
          "external:ui-kit#Button",
        ]);
        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Button", supplies: [] }]);
      },
    );
  });

  it.each([
    { name: "a package namespace", imports: `import * as UI from "ui-kit";`, tag: "UI.Button", mixed: false },
    { name: "a mixed package namespace", imports: `import * as UI from "ui-kit";`, tag: "UI.Button", mixed: true },
    {
      name: "a renamed barrel export",
      imports: `import * as UI from "./named-barrel";`,
      tag: "UI.Action",
      mixed: true,
    },
    {
      name: "a renamed barrel export without mixed imports",
      imports: `import * as UI from "./named-barrel";`,
      tag: "UI.Action",
      mixed: false,
    },
    {
      name: "a package re-export from another package",
      imports: `import * as UI from "ui-kit";`,
      tag: "UI.Button",
      mixed: false,
      packageSource: `export { Primitive as Button } from "primitives";`,
    },
    {
      name: "a package namespace re-export from another package",
      imports: `import * as UI from "ui-kit";`,
      tag: "UI.Components.Primitive",
      mixed: false,
      packageSource: `export * as Components from "primitives";`,
      target: "Components.Primitive",
    },
    {
      name: "a renamed default barrel export",
      imports: `import * as UI from "./default-barrel";`,
      tag: "UI.Renamed",
      mixed: false,
      packageSource: `export default function NamedDefault() { return <button />; }`,
      target: "NamedDefault",
    },
    {
      name: "a nested namespace export",
      imports: `import * as Barrel from "./namespace-barrel";`,
      tag: "Barrel.UI.Button",
      mixed: true,
    },
    {
      name: "a nested namespace alias",
      imports: `import * as Barrel from "./namespace-barrel"; const UI = Barrel.UI;`,
      tag: "UI.Button",
      mixed: true,
    },
    {
      name: "a nested star namespace",
      imports: `import * as Barrel from "./namespace-star";`,
      tag: "Barrel.UI.Button",
      mixed: true,
    },
  ])(
    "keeps canonical package export identities through $name",
    async ({ imports, tag, mixed, packageSource, target = "Button" }) => {
      await withFixture(
        {
          "packages/ui-kit/package.json": JSON.stringify({
            name: "ui-kit",
            type: "module",
            exports: { ".": { types: "./index.tsx" } },
          }),
          "packages/ui-kit/index.tsx":
            packageSource ??
            `
          import { Primitive } from "primitives";
          function InternalButton(props: unknown) { return <Primitive />; }
          export { InternalButton as Button };
        `,
          "node_modules/primitives/index.d.ts": `export declare function Primitive(props: unknown): unknown;`,
          "src/local.ts": mixed ? `import "../packages/ui-kit";` : "",
          "src/named-barrel.ts": `export { Button as Action } from "ui-kit";`,
          "src/default-barrel.ts": `export { default as Renamed } from "ui-kit";`,
          "src/namespace-barrel.ts": `export * as UI from "ui-kit";`,
          "src/namespace-star.ts": `export * from "./namespace-barrel";`,
          "src/app.tsx": `
          ${imports}
          export function Child() { return <main />; }
          export function App() { return <${tag}><Child /></${tag}>; }
        `,
        },
        async (scopePath) => {
          await symlink(join(scopePath, "packages/ui-kit"), join(scopePath, "node_modules/ui-kit"), "junction");
          const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

          expect(graph.nodes.map(({ id }) => id)).toEqual([
            "component:src/app.tsx#App",
            "component:src/app.tsx#Child",
            `external:ui-kit#${target}`,
          ]);
          expect(edgeFacts(graph)).toEqual([
            { source: "App", target, supplies: [] },
            { source: target, target: "Child", supplies: ["App:children"] },
          ]);
        },
      );
    },
  );

  it.each([
    {
      name: "namespace imports",
      imports: `import * as UI from "ui-kit";`,
      tag: "UI.Button",
      missing: "UI.Missing",
      target: "Button",
    },
    {
      name: "default imports",
      imports: `import UI from "ui-kit";`,
      tag: "UI.Button",
      missing: "UI.Missing",
      target: "UI.Button",
    },
    {
      name: "named imports",
      imports: `import { Button, Missing } from "ui-kit";`,
      tag: "Button",
      missing: "Missing",
      target: "Button",
    },
    {
      name: "spaced member aliases",
      imports: `import * as UI from "ui-kit"; const Button = UI . Button; const Missing = UI . Missing;`,
      tag: "Button",
      missing: "Missing",
      target: "Button",
    },
    {
      name: "commented nested barrel aliases",
      imports: `
        import * as Barrel from "./barrel";
        const Kit = Barrel /* namespace */ . UI;
        const Button = Kit /* member */ . Button;
        const Missing = Kit /* member */ . Missing;
      `,
      tag: "Button",
      missing: "Missing",
      target: "Button",
    },
  ])(
    "keeps declared CommonJS members and omits missing members through $name",
    async ({ imports, tag, missing, target }) => {
      await withFixture(
        {
          "node_modules/ui-kit/package.json": JSON.stringify({ name: "ui-kit", types: "index.d.ts" }),
          "node_modules/ui-kit/index.d.ts": `
          declare const UI: { Button: (props: unknown) => any };
          export = UI;
        `,
          "src/barrel.ts": `export * as UI from "ui-kit";`,
          "src/app.tsx": `
          ${imports}
          export function App() { return <><${tag} /><${missing} /></>; }
        `,
        },
        async (scopePath) => {
          const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

          expect(graph.nodes.map(({ id }) => id)).toEqual(["component:src/app.tsx#App", `external:ui-kit#${target}`]);
          expect(edgeFacts(graph)).toEqual([{ source: "App", target, supplies: [] }]);
        },
      );
    },
  );

  it.each([".", " . ", " /* member */ . "])("keeps ESM member identities and omissions with %j", async (separator) => {
    await withFixture(
      {
        ...externalPackageFiles(`export declare function Button(props: unknown): any;`),
        "src/app.tsx": `
          import * as UI from "ui-kit";
          const Button = UI${separator}Button;
          const Missing = UI${separator}Missing;
          export function App() { return <><UI.Button /><UI.Missing /><Button /><Missing /></>; }
        `,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ id }) => id)).toEqual(["component:src/app.tsx#App", "external:ui-kit#Button"]);
        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Button", supplies: [] }]);
      },
    );
  });

  it.each([
    {
      name: "a mapped type",
      declaration: `export declare const Controls: { [K in "Button" | "Link"]: (props: unknown) => unknown };`,
      imports: `import { Controls } from "ui-kit";`,
      tag: "Controls.Button",
      missingTag: "Controls.Missing",
      target: "Controls.Button",
    },
    {
      name: "Record",
      declaration: `export declare const Controls: Record<"Button" | "Link", (props: unknown) => unknown>;`,
      imports: `import { Controls } from "ui-kit";`,
      tag: "Controls.Button",
      missingTag: "Controls.Missing",
      target: "Controls.Button",
    },
    {
      name: "a namespace Record member",
      declaration: `export declare const Controls: Record<"Button" | "Link", (props: unknown) => unknown>;`,
      imports: `import * as UI from "ui-kit";`,
      tag: "UI.Controls.Button",
      missingTag: "UI.Controls.Missing",
      target: "Controls.Button",
    },
    {
      name: "nested Record members",
      declaration: `export declare const Controls: Record<"Buttons", Record<"Primary", (props: unknown) => unknown>>;`,
      imports: `import * as UI from "./barrel"; const Kit = UI;`,
      tag: "Kit.Controls.Buttons.Primary",
      missingTag: "Kit.Controls.Buttons.Missing",
      target: "Controls.Buttons.Primary",
    },
    {
      name: "a string index signature",
      declaration: `export declare const Controls: { [name: string]: (props: unknown) => unknown };`,
      imports: `import { Controls } from "ui-kit";`,
      tag: "Controls.Button",
      missingTag: "Controls.Button.Missing",
      target: "Controls.Button",
    },
    {
      name: "a string-indexed Record",
      declaration: `export declare const Controls: Record<string, (props: unknown) => unknown>;`,
      imports: `import * as UI from "ui-kit";`,
      tag: "UI.Controls.Button",
      missingTag: "UI.Controls.Button.Missing",
      target: "Controls.Button",
    },
    {
      name: "a template-string index signature",
      declaration: "export declare const Controls: { [name: `Comp${string}`]: (props: unknown) => unknown };",
      imports: `import { Controls } from "ui-kit";`,
      tag: "Controls.CompButton",
      missingTag: "Controls.Wrong",
      target: "Controls.CompButton",
    },
    {
      name: "an aliased template-string index signature",
      declaration: "export declare const Controls: { [name: `Comp${string}`]: (props: unknown) => unknown };",
      imports: `import * as UI from "./barrel"; const Kit = UI;`,
      tag: "Kit.Controls.CompButton",
      missingTag: "Kit.Controls.CompButton.Missing",
      target: "Controls.CompButton",
    },
    {
      name: "a template-string Record",
      declaration: "export declare const Controls: Record<`Comp${string}`, (props: unknown) => unknown>;",
      imports: `import * as UI from "ui-kit";`,
      tag: "UI.Controls.CompButton",
      missingTag: "UI.Controls.Wrong",
      target: "Controls.CompButton",
    },
  ])(
    "keeps confirmed external components supplied by $name",
    async ({ declaration, imports, tag, missingTag, target }) => {
      await withFixture(
        {
          ...externalPackageFiles(declaration),
          "src/barrel.ts": `export * from "ui-kit";`,
          "src/app.tsx": `
          ${imports}
          export function App() { return <><${tag} /><${missingTag} /></>; }
        `,
        },
        async (scopePath) => {
          const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

          expect(graph.nodes.map(({ id }) => id)).toEqual(["component:src/app.tsx#App", `external:ui-kit#${target}`]);
          expect(edgeFacts(graph)).toEqual([{ source: "App", target, supplies: [] }]);
        },
      );
    },
  );

  it.each([
    {
      format: "ESM",
      declaration: "export declare const Controls:",
      alias: "Barrel . UI . Controls",
      target: "Controls.CompPanel.Button",
    },
    { format: "CommonJS", declaration: "declare const Controls:", alias: "Barrel . UI", target: "CompPanel.Button" },
  ])(
    "checks template-index keys and nested members through commented $format aliases",
    async ({ format, declaration, alias, target }) => {
      await withFixture(
        {
          "node_modules/ui-kit/package.json": JSON.stringify({ name: "ui-kit", types: "index.d.ts" }),
          "node_modules/ui-kit/index.d.ts":
            declaration +
            " { [key: `Comp${string}`]: { Button: (props: unknown) => any } };" +
            (format === "CommonJS" ? "export = Controls;" : ""),
          "src/barrel.ts": `export * as UI from "ui-kit";`,
          "src/app.tsx": `
          import * as Barrel from "./barrel";
          const Kit = ${alias};
          const Button = Kit /* key */ . CompPanel /* member */ . Button;
          const WrongKey = Kit /* key */ . Wrong . Button;
          const Missing = Kit . CompPanel /* member */ . Missing;
          export function App() { return <><Button /><WrongKey /><Missing /></>; }
        `,
        },
        async (scopePath) => {
          const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

          expect(graph.nodes.map(({ id }) => id)).toEqual(["component:src/app.tsx#App", `external:ui-kit#${target}`]);
          expect(edgeFacts(graph)).toEqual([{ source: "App", target, supplies: [] }]);
        },
      );
    },
  );

  it("keeps direct external references separate from component-prop eligibility", async () => {
    await withFixture(
      {
        "node_modules/ui-kit/package.json": JSON.stringify({ name: "ui-kit", types: "index.d.ts" }),
        "node_modules/ui-kit/index.d.ts": `
          declare const UI: {
            Boundary: (props: unknown) => any;
            Loose: any;
            Opaque: unknown;
            Known: (props: unknown) => any;
            format: (value: string) => string;
          };
          export = UI;
        `,
        "src/app.tsx": `
          import * as UI from "ui-kit";
          export function App() {
            return <>
              <UI.Loose /><UI.Opaque /><UI.format /><UI.Missing />
              <UI.Boundary loose={UI.Loose} component={UI.Opaque} format={UI.format} registry={{ Known: UI.Known }} />
            </>;
          }
        `,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Boundary", supplies: [] },
          { source: "App", target: "format", supplies: [] },
          { source: "App", target: "Loose", supplies: [] },
          { source: "App", target: "Opaque", supplies: [] },
          { source: "Boundary", target: "Known", supplies: ["App:registry"] },
        ]);
      },
    );
  });

  it.each([
    { name: "a named import", imports: `import { Missing } from "ui-kit";`, tag: "Missing" },
    { name: "a named barrel import", imports: `import { Missing } from "./barrel";`, tag: "Missing" },
    { name: "a namespace member", imports: `import * as UI from "ui-kit";`, tag: "UI.Missing" },
    { name: "a barrel namespace member", imports: `import * as UI from "./barrel";`, tag: "UI.Missing" },
    {
      name: "an aliased namespace member",
      imports: `import * as UI from "ui-kit"; const Kit = UI;`,
      tag: "Kit.Missing",
    },
    {
      name: "an invalid re-export through a const alias",
      imports: `import { Missing } from "./named-barrel"; const Alias = Missing;`,
      tag: "Alias",
    },
    { name: "a default import through export-star", imports: `import Missing from "./barrel";`, tag: "Missing" },
    { name: "a nested missing member", imports: `import * as UI from "ui-kit";`, tag: "UI.Button.Missing" },
    {
      name: "a nested barrel namespace member",
      imports: `import * as Barrel from "./namespace-barrel";`,
      tag: "Barrel.UI.Missing",
    },
    {
      name: "a nested aliased namespace member",
      imports: `import * as Barrel from "./namespace-barrel"; const Kit = Barrel.UI;`,
      tag: "Kit.Button.Missing",
    },
  ])("does not invent external components for missing exports through $name", async ({ imports, tag }) => {
    await withFixture(
      {
        ...externalPackageFiles(`
          export declare function Button(props: unknown): unknown;
          export default function DefaultButton(props: unknown): unknown;
        `),
        "src/barrel.ts": `export * from "ui-kit";`,
        "src/named-barrel.ts": `export { Missing } from "ui-kit";`,
        "src/namespace-barrel.ts": `export * as UI from "ui-kit";`,
        "src/app.tsx": `
          import { Button } from "ui-kit";
          ${imports}
          export function App() { return <><Button /><${tag} /></>; }
        `,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ id }) => id)).toEqual(["component:src/app.tsx#App", "external:ui-kit#Button"]);
        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Button", supplies: [] }]);
      },
    );
  });

  it("does not expand JSX values created inside linked packages", async () => {
    await withFixture(
      {
        "packages/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.tsx" } },
        }),
        "packages/ui-kit/index.tsx": `
          import { Button } from "primitives";
          export const content = <Button />;
          export function Boundary({ children }: { children: unknown }) { return <section>{children}</section>; }
        `,
        "node_modules/primitives/index.d.ts": `export declare function Button(props: unknown): unknown;`,
        "src/app.tsx": `
          import { Boundary, content } from "ui-kit";
          export function App() { return <Boundary>{content}</Boundary>; }
        `,
      },
      async (scopePath) => {
        await symlink(join(scopePath, "packages/ui-kit"), join(scopePath, "node_modules/ui-kit"), "junction");

        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Boundary", supplies: [] }]);
      },
    );
  });

  it.each([
    { name: "a named import", imports: `import { Boundary, content } from "ui-kit";`, value: "content" },
    {
      name: "a namespace import",
      imports: `import { Boundary } from "ui-kit"; import * as UI from "ui-kit";`,
      value: "UI.content",
    },
    {
      name: "a namespace alias",
      imports: `import { Boundary } from "ui-kit"; import * as UI from "ui-kit"; const Kit = UI;`,
      value: "Kit.content",
    },
    {
      name: "a local barrel namespace",
      imports: `import { Boundary } from "ui-kit"; import * as UI from "./barrel";`,
      value: "UI.content",
    },
    {
      name: "a local barrel namespace alias",
      imports: `import { Boundary } from "ui-kit"; import * as UI from "./barrel"; const Kit = UI;`,
      value: "Kit.content",
    },
    {
      name: "a named barrel namespace export",
      imports: `import { Boundary } from "ui-kit"; import { UI } from "./namespace-barrel";`,
      value: "UI.content",
    },
    {
      name: "a path-alias barrel namespace",
      imports: `import { Boundary } from "ui-kit"; import * as UI from "@/barrel";`,
      value: "UI.content",
    },
    {
      name: "a nested namespace export",
      imports: `import { Boundary } from "ui-kit"; import * as Barrel from "./namespace-barrel";`,
      value: "Barrel.UI.content",
    },
    {
      name: "a nested namespace export alias",
      imports: `import { Boundary } from "ui-kit"; import * as Barrel from "./namespace-barrel"; const Kit = Barrel.UI;`,
      value: "Kit.content",
    },
    {
      name: "a nested namespace export through export-star",
      imports: `import { Boundary } from "ui-kit"; import * as Barrel from "./namespace-star";`,
      value: "Barrel.UI.content",
    },
    { name: "a default import", imports: `import content, { Boundary } from "ui-kit";`, value: "content" },
    {
      name: "a namespace default member",
      imports: `import { Boundary } from "ui-kit"; import * as UI from "ui-kit";`,
      value: "UI.default",
    },
    {
      name: "a commented default member alias",
      imports: `import { Boundary } from "ui-kit"; import * as UI from "ui-kit"; const content = UI /* default */ . default;`,
      value: "content",
    },
    {
      name: "a default barrel import",
      imports: `import { Boundary } from "ui-kit"; import content from "./default-barrel";`,
      value: "content",
    },
    {
      name: "a renamed default barrel import",
      imports: `import { Boundary } from "ui-kit"; import { content } from "./default-barrel";`,
      value: "content",
    },
    {
      name: "a renamed default barrel namespace",
      imports: `import { Boundary } from "ui-kit"; import * as UI from "./default-barrel";`,
      value: "UI /* content */ . content",
    },
    {
      name: "a nested namespace default member",
      imports: `import { Boundary } from "ui-kit"; import * as Barrel from "./namespace-star";`,
      value: "Barrel . UI /* default */ . default",
    },
  ])("does not expand package values through $name when the real path is also imported", async ({ imports, value }) => {
    await withFixture(
      {
        "packages/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.tsx" } },
        }),
        "packages/ui-kit/index.tsx": `
          import { Button } from "primitives";
          export const content = <Button />;
          export default <Button />;
          export function Boundary({ children }: { children: unknown }) { return <section>{children}</section>; }
        `,
        "node_modules/primitives/index.d.ts": `export declare function Button(props: unknown): unknown;`,
        "src/default-barrel.ts": `export { default, default as content } from "ui-kit";`,
        "src/local.ts": `import "../packages/ui-kit";`,
        "src/barrel.ts": `export * from "ui-kit";`,
        "src/namespace-barrel.ts": `export * as UI from "ui-kit";`,
        "src/namespace-star.ts": `export * from "./namespace-barrel";`,
        "src/app.tsx": `
          ${imports}
          export function App() { return <Boundary>{${value}}</Boundary>; }
        `,
      },
      async (scopePath) => {
        await symlink(join(scopePath, "packages/ui-kit"), join(scopePath, "node_modules/ui-kit"), "junction");

        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Boundary", supplies: [] }]);
      },
    );
  });

  it("keeps an explicit local re-export ahead of a package star re-export", async () => {
    await withFixture(
      {
        "packages/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.tsx" } },
        }),
        "packages/ui-kit/index.tsx": `export function Button() { return <button />; }`,
        "src/barrel.ts": `
          export { Button } from "../packages/ui-kit";
          export * from "ui-kit";
        `,
        "src/app.tsx": `
          import { Button } from "./barrel";
          export function App() { return <Button />; }
        `,
      },
      async (scopePath) => {
        await symlink(join(scopePath, "packages/ui-kit"), join(scopePath, "node_modules/ui-kit"), "junction");

        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ id }) => id)).toEqual(["component:src/app.tsx#App"]);
        expect(graph.edges).toEqual([]);
      },
    );
  });

  it.each([
    { name: "a named import", imports: `import { Kit } from "./barrel";`, tag: "Kit.Widget" },
    { name: "a namespace import", imports: `import * as UI from "./barrel";`, tag: "UI.Kit.Widget" },
    {
      name: "a namespace alias",
      imports: `import * as UI from "./barrel"; const Kit = UI.Kit;`,
      tag: "Kit.Widget",
    },
  ])("keeps an explicit relative namespace ahead of package star exports through $name", async ({ imports, tag }) => {
    await withFixture(
      {
        "packages/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.tsx" } },
        }),
        "packages/ui-kit/index.tsx": `
          export * as Kit from "./components";
          export function Boundary() { return <section />; }
        `,
        "packages/ui-kit/components.tsx": `export function Widget() { return <button />; }`,
        "src/local.ts": `import "../packages/ui-kit";`,
        "src/barrel.ts": `
          export * as Kit from "../packages/ui-kit/components";
          export * from "ui-kit";
        `,
        "src/app.tsx": `
          import { Boundary } from "ui-kit";
          ${imports}
          export function App() { return <><Boundary /><${tag} /></>; }
        `,
      },
      async (scopePath) => {
        await symlink(join(scopePath, "packages/ui-kit"), join(scopePath, "node_modules/ui-kit"), "junction");
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ id }) => id)).toEqual(["component:src/app.tsx#App", "external:ui-kit#Boundary"]);
        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Boundary", supplies: [] }]);
      },
    );
  });

  it.each([
    { name: "a barrel namespace", imports: `import * as UI from "./barrel";` },
    { name: "a path-alias namespace", imports: `import * as UI from "@/barrel";` },
    { name: "a namespace alias", imports: `import * as Kit from "./barrel"; const UI = Kit;` },
  ])("keeps local export precedence and caller supplies through $name", async ({ imports }) => {
    await withFixture(
      {
        "package.json": JSON.stringify({ name: "fixture-app", type: "module" }),
        "packages/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          type: "module",
          exports: { ".": { types: "./index.tsx" } },
        }),
        "packages/ui-kit/index.tsx": `
          import { Button } from "primitives";
          export const content = <Button />;
          export const packageContent = <Button />;
          export function Boundary(props: unknown) { return <section />; }
        `,
        "node_modules/primitives/index.d.ts": `export declare function Button(props: unknown): unknown;`,
        "src/local.tsx": `
          import "../packages/ui-kit";
          export function LocalContent() { return <main />; }
          export function LocalBody() { return <aside />; }
          export const content = <LocalContent />;
        `,
        "src/barrel.ts": `export { content } from "./local"; export * from "ui-kit";`,
        "src/app.tsx": `
          ${imports}
          import { LocalBody } from "./local";
          export function App() {
            return <UI.Boundary panel={UI.packageContent} renderBody={() => <LocalBody />}>{UI.content}</UI.Boundary>;
          }
        `,
      },
      async (scopePath) => {
        await symlink(join(scopePath, "packages/ui-kit"), join(scopePath, "node_modules/ui-kit"), "junction");

        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ id }) => id)).toEqual([
          "component:src/app.tsx#App",
          "component:src/local.tsx#LocalBody",
          "component:src/local.tsx#LocalContent",
          "external:ui-kit#Boundary",
        ]);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Boundary", supplies: [] },
          { source: "Boundary", target: "LocalBody", supplies: ["App:renderBody"] },
          { source: "Boundary", target: "LocalContent", supplies: ["App:children"] },
        ]);
      },
    );
  });

  it("terminates alias and barrel cycles without dropping reachable package exports", async () => {
    await withFixture(
      {
        ...externalPackageFiles(`export declare function Button(props: unknown): any;`),
        "src/first.ts": `export * from "./second";`,
        "src/second.ts": `export * from "./first"; export * from "ui-kit";`,
        "src/app.tsx": `
          import * as UI from "./first";
          const First = Second;
          const Second = First;
          const Button = UI /* member */ . Button;
          const Missing = UI . Missing;
          export function App() { return <><First /><Second /><Button /><Missing /></>; }
        `,
      },
      async (scopePath) => {
        const options = { scopePath, sourcePaths: ["src"] };
        const graph = await buildComponentGraph(options);

        expect(graph.nodes.map(({ id }) => id)).toEqual(["component:src/app.tsx#App", "external:ui-kit#Button"]);
        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Button", supplies: [] }]);
        expect(await buildComponentGraph(options)).toEqual(graph);
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App"]);
        expect(graph.edges).toEqual([]);
      },
    );
  });

  it("traces createElement through a linked React namespace re-export", async () => {
    await withFixture(
      {
        "packages/react/package.json": JSON.stringify({ name: "react", types: "index.d.ts" }),
        "packages/react/index.d.ts": `export declare function createElement(type: unknown): unknown;`,
        "src/react.ts": `export * as React from "react";`,
        "src/app.tsx": `
          import { React } from "./react";
          export function Child() { return <main />; }
          export function App() { return React.createElement(Child); }
        `,
      },
      async (scopePath) => {
        await symlink(join(scopePath, "packages/react"), join(scopePath, "node_modules/react"), "junction");

        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Child", supplies: [] }]);
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Child"]);
        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Child", supplies: [] }]);
      },
    );
  });

  it("keeps list rendering through transitive types of symlinked packages", async () => {
    await withFixture(
      {
        "node_modules/.pnpm/ui-kit/node_modules/ui-kit/package.json": JSON.stringify({
          name: "ui-kit",
          types: "index.d.ts",
        }),
        "node_modules/.pnpm/ui-kit/node_modules/ui-kit/index.d.ts": `
          import type { BaseProps } from "ui-types";
          export type NodeProps<T> = BaseProps<T>;
        `,
        "node_modules/.pnpm/ui-kit/node_modules/ui-types/index.d.ts": `
          export type BaseProps<T> = { data: T };
        `,
        "src/app.tsx": `
          import type { NodeProps } from "ui-kit";
          export function Row() { return <li />; }
          export function List({ data }: NodeProps<{ items: readonly string[] }>) {
            return <ul>{data.items.map(() => <Row />)}</ul>;
          }
        `,
      },
      async (scopePath) => {
        await symlink(
          join(scopePath, "node_modules/.pnpm/ui-kit/node_modules/ui-kit"),
          join(scopePath, "node_modules/ui-kit"),
          "junction",
        );

        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([{ source: "List", target: "Row", supplies: [] }]);
      },
    );
  });

  it("keeps composition inside unresolved context provider tags", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import { Table } from "./table";
          export const ThemeContext = { Provider: (props: { children: unknown }) => props.children };
          export function App() {
            return (
              <ThemeContext.Provider value={true}>
                <Table />
              </ThemeContext.Provider>
            );
          }
        `,
        "src/table.tsx": `
          export function Table() { return <table />; }
        `,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toContainEqual({
          source: "App",
          target: "Table",
          supplies: [],
        });
      },
    );
  });

  it("keeps children supplied to renderers that forward rest props", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import Wrapper from "./wrapper";
          import Table from "./table";
          export function App() {
            return (
              <Wrapper>
                <Table />
              </Wrapper>
            );
          }
        `,
        "src/wrapper.tsx": `
          export default function Wrapper({ style, ...rest }: { style?: unknown; children?: unknown }) {
            return <div style={style} {...rest} />;
          }
        `,
        "src/table.tsx": `export default function Table() { return <table />; }`,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toContainEqual({
          source: "Wrapper",
          target: "Table",
          supplies: ["App:children"],
        });
      },
    );
  });

  it("supports every JavaScript and TypeScript source extension", async () => {
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
          import { MtsComponent } from "./mts-component.mjs";
          export function TsComponent() { return React.createElement(MtsComponent); }
        `,
        "src/mts-component.mts": `
          import React from "react";
          import { MjsComponent } from "./mjs-component.mjs";
          export function MtsComponent() { return React.createElement(MjsComponent); }
        `,
        "src/mjs-component.mjs": `
          import React from "react";
          import { TsxComponent } from "./tsx-component";
          export function MjsComponent() { return React.createElement(TsxComponent); }
        `,
        "src/tsx-component.tsx": `export function TsxComponent() { return <div />; }`,
      },
      async (scopePath) => {
        const first = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });
        const second = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(second).toEqual(first);
        expect(first.nodes.map(({ title }) => title).toSorted()).toEqual([
          "JsComponent",
          "JsxComponent",
          "MjsComponent",
          "MtsComponent",
          "TsComponent",
          "TsxComponent",
        ]);
        expect(edgeFacts(first)).toEqual([
          { source: "JsComponent", target: "JsxComponent", supplies: [] },
          { source: "JsxComponent", target: "TsComponent", supplies: [] },
          { source: "MjsComponent", target: "TsxComponent", supplies: [] },
          { source: "MtsComponent", target: "MjsComponent", supplies: [] },
          { source: "TsComponent", target: "MtsComponent", supplies: [] },
        ]);
      },
    );
  });

  it("keeps an anonymous default expression distinct from a same-named component", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import DefaultButton, { Button } from "./button";
          export function App() { return <><DefaultButton /><Button /></>; }
        `,
        "src/button.tsx": `
          import { Panel } from "./panel";
          export function Button() { return <button />; }
          export default () => <Panel />;
        `,
        "src/panel.tsx": `export function Panel() { return <section />; }`,
      },
      async (scopePath) => {
        const first = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });
        const second = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });
        const appId = "component:src/app.tsx#App";
        const defaultButtonId = "component:src/button.tsx#default";
        const namedButtonId = "component:src/button.tsx#Button";
        const panelId = "component:src/panel.tsx#Panel";

        expect(second).toEqual(first);
        expect(first.nodes.map(({ id }) => id)).toEqual([appId, namedButtonId, defaultButtonId, panelId]);
        expect(first.nodes.filter(({ title }) => title === "Button")).toHaveLength(2);
        expect(
          first.edges
            .map(({ source, target }) => ({ source, target }))
            .toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
        ).toEqual(
          [
            { source: appId, target: defaultButtonId },
            { source: appId, target: namedButtonId },
            { source: defaultButtonId, target: panelId },
          ].toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
        );
      },
    );
  });

  it("detects an anonymous default function declaration", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import ProfilePage from "./profile-page";
          export function App() { return <ProfilePage />; }
        `,
        "src/content.tsx": `export function Content() { return <main />; }`,
        "src/profile-page.tsx": `
          import { Content } from "./content";
          export function ProfilePage() { return <aside />; }
          export default function () { return <Content />; }
        `,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });
        const defaultPageId = "component:src/profile-page.tsx#default";

        expect(graph.nodes.filter(({ title }) => title === "ProfilePage")).toHaveLength(2);
        expect(graph.nodes).toContainEqual(expect.objectContaining({ id: defaultPageId, title: "ProfilePage" }));
        expect(graph.edges).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ source: "component:src/app.tsx#App", target: defaultPageId }),
            expect.objectContaining({ source: defaultPageId, target: "component:src/content.tsx#Content" }),
          ]),
        );
      },
    );
  });

  it("detects an anonymous default class declaration", async () => {
    await withFixture(
      {
        "src/app.jsx": `
          import Dialog from "./dialog";
          export function App() { return <Dialog />; }
        `,
        "src/dialog.jsx": `
          import React from "react";
          import { Panel } from "./panel";
          export default class extends React.Component {
            render() { return <Panel />; }
          }
        `,
        "src/panel.jsx": `export function Panel() { return <section />; }`,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes).toContainEqual(
          expect.objectContaining({ id: "component:src/dialog.jsx#default", title: "Dialog" }),
        );
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Dialog", supplies: [] },
          { source: "Dialog", target: "Panel", supplies: [] },
        ]);
      },
    );
  });

  it("ignores anonymous default declarations without React output", async () => {
    await withFixture(
      {
        "src/app.tsx": `export function App() { return <main />; }`,
        "src/not-a-class.ts": `export default class { render() { return 1; } }`,
        "src/not-a-function.ts": `export default function () { return 1; }`,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ title }) => title)).toEqual(["App"]);
      },
    );
  });

  it("filters an anonymous default expression by its stable identity only", async () => {
    await withFixture(
      {
        "src/button.tsx": `
          export function Button() { return <button />; }
          export default () => <div />;
        `,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["component:src/button.tsx#default"],
        });

        expect(graph.nodes).toEqual([
          expect.objectContaining({ id: "component:src/button.tsx#Button", title: "Button" }),
        ]);
      },
    );
  });

  it("rejects duplicate local component identities", async () => {
    await withFixture(
      {
        "src/card.tsx": `
          export const Card = () => <article />;
          export const Card = () => <section />;
        `,
      },
      async (scopePath) => {
        await expect(buildComponentGraph({ scopePath, sourcePaths: ["src"] })).rejects.toThrow(
          "Duplicate React component identity: component:src/card.tsx#Card",
        );
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "QuotedLayout", supplies: [] },
          { source: "App", target: "ShorthandLayout", supplies: [] },
          { source: "Primitive", target: "QuotedContent", supplies: ["App:children"] },
          { source: "Primitive", target: "ShorthandContent", supplies: ["App:children"] },
          { source: "QuotedLayout", target: "Primitive", supplies: [] },
          { source: "ShorthandLayout", target: "Primitive", supplies: [] },
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Button"]);
        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Button", supplies: [] }]);
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });
        const external = graph.nodes.find(({ title }) => title === "Button");

        expect(external).toMatchObject({ id: "external:ui-kit#Button", title: "Button" });
        expect(external).not.toHaveProperty("kind");
        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Button", supplies: [] }]);
      },
    );
  });

  it("resolves immutable external aliases in JSX and createElement", async () => {
    await withFixture(
      {
        ...externalPackageFiles(`
          export declare function Button(props: unknown): unknown;
          export declare function Panel(props: unknown): unknown;
        `),
        "src/app.tsx": `
          import React from "react";
          import { Button, Panel } from "ui-kit";
          const ButtonAlias = Button;
          const PanelAlias = Panel;
          export function App() {
            return <><ButtonAlias />{React.createElement(PanelAlias)}</>;
          }
        `,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ id }) => id).toSorted()).toEqual([
          "component:src/app.tsx#App",
          "external:ui-kit#Button",
          "external:ui-kit#Panel",
        ]);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Button", supplies: [] },
          { source: "App", target: "Panel", supplies: [] },
        ]);
      },
    );
  });

  it("follows multi-hop const aliases but omits mutable external aliases", async () => {
    await withFixture(
      {
        ...externalPackageFiles(`
          export declare function Button(props: unknown): unknown;
          export declare function Panel(props: unknown): unknown;
        `),
        "src/app.tsx": `
          import { Button, Panel } from "ui-kit";
          const First = Button;
          const Second = First;
          let Mutable = Panel;
          Mutable = Button;
          export function App() { return <><Second /><Mutable /></>; }
        `,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ id }) => id).toSorted()).toEqual([
          "component:src/app.tsx#App",
          "external:ui-kit#Button",
        ]);
        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Button", supplies: [] }]);
      },
    );
  });

  it("keeps canonical package provenance through named barrel chains", async () => {
    await withFixture(
      {
        ...externalPackageFiles(`export declare function Button(props: unknown): unknown;`),
        "src/app.tsx": `
          import { ActionButton } from "./second-barrel";
          export function App() { return <ActionButton />; }
        `,
        "src/first-barrel.ts": `export { Button as PrimaryButton } from "ui-kit";`,
        "src/second-barrel.ts": `export { PrimaryButton as ActionButton } from "./first-barrel";`,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes).toContainEqual(expect.objectContaining({ id: "external:ui-kit#Button", title: "Button" }));
        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Button", supplies: [] }]);
      },
    );
  });

  it("keeps canonical package provenance through export-star barrels", async () => {
    await withFixture(
      {
        ...externalPackageFiles(`export declare function Button(props: unknown): unknown;`),
        "src/app.tsx": `
          import { Button as StarButton } from "./barrel";
          export function App() { return <StarButton />; }
        `,
        "src/barrel.ts": `export * from "ui-kit";`,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes).toContainEqual(expect.objectContaining({ id: "external:ui-kit#Button", title: "Button" }));
        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Button", supplies: [] }]);
      },
    );
  });

  it("keeps canonical package provenance through default barrel forms", async () => {
    await withFixture(
      {
        ...externalPackageFiles(`export default function Button(props: unknown): unknown;`),
        "src/app.tsx": `
          import { PrimaryButton } from "./named-default";
          import ForwardedButton from "./forward-default";
          export function NamedConsumer() { return <PrimaryButton />; }
          export function ForwardConsumer() { return <ForwardedButton />; }
          export function App() { return <><NamedConsumer /><ForwardConsumer /></>; }
        `,
        "src/named-default.ts": `export { default as PrimaryButton } from "ui-kit";`,
        "src/forward-default.ts": `export { default } from "ui-kit";`,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes).toContainEqual(expect.objectContaining({ id: "external:ui-kit#Button", title: "Button" }));
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "ForwardConsumer", supplies: [] },
          { source: "App", target: "NamedConsumer", supplies: [] },
          { source: "ForwardConsumer", target: "Button", supplies: [] },
          { source: "NamedConsumer", target: "Button", supplies: [] },
        ]);
      },
    );
  });

  it("preserves namespace export paths through const aliases", async () => {
    await withFixture(
      {
        ...externalPackageFiles(`
          export declare namespace Tabs {
            function Root(props: unknown): unknown;
          }
        `),
        "src/app.tsx": `
          import * as UI from "ui-kit";
          const RootAlias = UI.Tabs.Root;
          export function App() { return <RootAlias />; }
        `,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes).toContainEqual(
          expect.objectContaining({ id: "external:ui-kit#Tabs.Root", title: "Tabs.Root" }),
        );
        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Tabs.Root", supplies: [] }]);
      },
    );
  });

  it("keeps supplied values and children connected through external aliases", async () => {
    await withFixture(
      {
        ...externalPackageFiles(`
          export declare function ExternalFrame(props: unknown): unknown;
          export declare function Header(props: unknown): unknown;
          export declare function Body(props: unknown): unknown;
          export declare function Footer(props: unknown): unknown;
          export declare function Wrapper(props: unknown): unknown;
        `),
        "src/app.tsx": `
          import { ExternalFrame, Wrapper } from "ui-kit";
          import { KitBody, KitFooter, KitHeader } from "./barrel";
          import { Content } from "./content";
          const FrameAlias = ExternalFrame;
          const HeaderAlias = KitHeader;
          const BodyAlias = KitBody;
          const FooterAlias = KitFooter;
          const WrapperAlias = Wrapper;
          const footerComponent = FooterAlias;
          const frameProps = { footerComponent };
          export function App() {
            return <>
              <FrameAlias
                {...frameProps}
                header={<HeaderAlias />}
                renderBody={() => <BodyAlias />}
              />
              <WrapperAlias><Content /></WrapperAlias>
            </>;
          }
        `,
        "src/barrel.ts": `
          export {
            Body as KitBody,
            Footer as KitFooter,
            Header as KitHeader,
          } from "ui-kit";
        `,
        "src/content.tsx": `export function Content() { return <main />; }`,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "ExternalFrame", supplies: [] },
          { source: "App", target: "Wrapper", supplies: [] },
          { source: "ExternalFrame", target: "Body", supplies: ["App:renderBody"] },
          {
            source: "ExternalFrame",
            target: "Footer",
            supplies: ["App:footerComponent"],
          },
          { source: "ExternalFrame", target: "Header", supplies: ["App:header"] },
          { source: "Wrapper", target: "Content", supplies: ["App:children"] },
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Child"]);
        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Child", supplies: [] }]);
      },
    );
  });

  it("respects gitignore files during collection while explicitly selected paths bypass them", async () => {
    await withFixture(
      {
        ".gitignore": "src/skipped.tsx\n",
        "src/app.tsx": `export function App() { return <App />; }`,
        "src/skipped.tsx": `export function Skipped() { return <div />; }`,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });
        expect(graph.nodes.map(({ title }) => title)).toEqual(["App"]);

        const named = await buildComponentGraph({ scopePath, sourcePaths: ["src/skipped.tsx"] });
        expect(named.nodes.map(({ title }) => title)).toEqual(["Skipped"]);
      },
    );
  });

  it("re-includes earlier exclude matches with a later negation pattern", async () => {
    await withFixture(
      {
        "src/kept.tsx": `export function Kept() { return <div />; }`,
        "src/hidden.tsx": `export function Hidden() { return <div />; }`,
      },
      async (scopePath) => {
        const fileFiltered = await buildComponentGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeFilePatterns: ["src/*.tsx", "!src/kept.tsx"],
        });
        expect(fileFiltered.nodes.map(({ title }) => title)).toEqual(["Kept"]);

        const componentFiltered = await buildComponentGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["component:src/*", "!component:src/kept.tsx#Kept"],
        });
        expect(componentFiltered.nodes.map(({ title }) => title)).toEqual(["Kept"]);
      },
    );
  });

  it("collapses component and file filters through the same parent-supplied path", async () => {
    await withFixture(
      {
        ".gitignore": "*.test.tsx\n*.generated.tsx\n",
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
        const common = { scopePath, sourcePaths: ["src"] } as const;
        const [componentFiltered, fileFiltered] = await Promise.all([
          buildComponentGraph({ ...common, excludeComponentPatterns: ["Layout"] }),
          buildComponentGraph({ ...common, excludeFilePatterns: ["src/layout.tsx"] }),
        ]);

        for (const graph of [componentFiltered, fileFiltered]) {
          expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Content"]);
          expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Content", supplies: ["App:children"] }]);
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
        const graph = await buildComponentGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["Frame"],
        });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Body", "Footer", "Header"]);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Body", supplies: ["App:renderBody"] },
          {
            source: "App",
            target: "Footer",
            supplies: ["App:footerComponent"],
          },
          { source: "App", target: "Header", supplies: ["App:header"] },
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
        const graph = await buildComponentGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["Hidden"],
        });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Content", "Wrapper"]);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Wrapper", supplies: [] },
          { source: "Wrapper", target: "Content", supplies: ["App:children"] },
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
        const graph = await buildComponentGraph({
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
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(graph.nodes.some(({ title }) => title === "A")).toBe(false);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "ExplicitWrapper", supplies: [] },
          { source: "App", target: "StaticSpreadWrapper", supplies: [] },
          { source: "App", target: "UnknownSpreadWrapper", supplies: [] },
          { source: "ExplicitWrapper", target: "External", supplies: [] },
          {
            source: "External",
            target: "B",
            supplies: ["ExplicitWrapper:panel", "StaticSpreadWrapper:panel"],
          },
          {
            source: "External",
            target: "B",
            supplies: ["ExplicitWrapper:panel", "StaticSpreadWrapper:panel"],
          },
          { source: "StaticSpreadWrapper", target: "External", supplies: [] },
          { source: "UnknownSpreadWrapper", target: "External", supplies: [] },
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
        const graph = await buildComponentGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["Wrapper"],
        });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Content"]);
        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Content", supplies: ["App:children"] }]);
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
        const graph = await buildComponentGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["Hidden"],
        });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Content", "Layout"]);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Layout", supplies: [] },
          { source: "Layout", target: "Content", supplies: ["App:children"] },
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
        const graph = await buildComponentGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["Hidden"],
        });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Content", "Layout"]);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Layout", supplies: [] },
          { source: "Layout", target: "Content", supplies: ["App:slot"] },
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
        const graph = await buildComponentGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["Layout"],
        });

        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "ParentA", supplies: [] },
          { source: "App", target: "ParentB", supplies: [] },
          { source: "ParentA", target: "ContentA", supplies: ["ParentA:children"] },
          { source: "ParentB", target: "ContentB", supplies: ["ParentB:children"] },
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
        const graph = await buildComponentGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["ExternalLayout"],
        });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Content"]);
        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Content", supplies: ["App:children"] }]);
      },
    );
  });

  it("filters an external package by stable component identity without hiding same-named local components", async () => {
    await withFixture(
      {
        "node_modules/@base-ui/react/index.d.ts": `export declare function Button(props: unknown): unknown;`,
        "node_modules/@base-ui/react/package.json": JSON.stringify({
          name: "@base-ui/react",
          type: "module",
          exports: { ".": { types: "./index.d.ts" } },
        }),
        "src/app.tsx": `
          import { Button as BaseButton } from "@base-ui/react";
          export function Content() { return <main />; }
          export function Button({ children }: { children: unknown }) { return <section>{children}</section>; }
          export function App() { return <Button><BaseButton><Content /></BaseButton></Button>; }
        `,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["external:@base-ui/react#*"],
        });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Button", "Content"]);
        expect(graph.nodes.some(({ description }) => description === "@base-ui/react boundary")).toBe(false);
        expect(edgeFacts(graph)).toEqual([
          { source: "App", target: "Button", supplies: [] },
          { source: "Button", target: "Content", supplies: ["App:children"] },
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
        const graph = await buildComponentGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["Hidden"],
        });

        expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Shared"]);
        expect(edgeFacts(graph)).toEqual([{ source: "App", target: "Shared", supplies: [] }]);
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
        const baseline = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });
        const filtered = await buildComponentGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["B"],
        });

        expect(edgeFacts(baseline)).toEqual([
          { source: "A", target: "B", supplies: [] },
          { source: "B", target: "A", supplies: [] },
        ]);
        expect(filtered.nodes.map(({ title }) => title)).toEqual(["A"]);
        expect(filtered.edges).toEqual([]);
      },
    );
  });

  it("rejects filters that would violate the nonempty Artifact.graph schema", async () => {
    await withFixture({ "src/app.tsx": `export function App() { return <main />; }` }, async (scopePath) => {
      await expect(
        buildComponentGraph({
          scopePath,
          sourcePaths: ["src"],
          excludeComponentPatterns: ["**"],
        }),
      ).rejects.toThrow("No React component definitions remain after filtering.");
    });
  });

  const rootChainFiles = {
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
  } as const;

  it("keeps only components reachable from a selected root", async () => {
    await withFixture(rootChainFiles, async (scopePath) => {
      const graph = await buildComponentGraph({
        scopePath,
        sourcePaths: ["src"],
        rootPatterns: ["Layout"],
      });

      expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["Content", "Layout"]);
      expect(edgeFacts(graph)).toEqual([{ source: "Layout", target: "Content", supplies: [] }]);
    });
  });

  it("matches roots by stable component ID and unions multiple patterns", async () => {
    await withFixture(rootChainFiles, async (scopePath) => {
      const graph = await buildComponentGraph({
        scopePath,
        sourcePaths: ["src"],
        rootPatterns: ["component:src/app.tsx#App", "component:src/content.tsx#Content"],
      });

      expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Content", "Layout"]);
      expect(graph.edges).toHaveLength(2);
    });
  });

  it("fails when no visible component matches a root pattern", async () => {
    await withFixture(rootChainFiles, async (scopePath) => {
      await expect(
        buildComponentGraph({
          scopePath,
          sourcePaths: ["src"],
          rootPatterns: ["Missing"],
        }),
      ).rejects.toThrow("No visible component matches the --root pattern: Missing");
    });
  });

  it("traces components rendered inside block-bodied list callbacks", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import Row from "./row";

          export function App({ items }: { items: { id: string }[] }) {
            return (
              <div>
                {items.map((item) => {
                  const key = item.id;
                  return <Row key={key} />;
                })}
              </div>
            );
          }
        `,
        "src/row.tsx": `export default function Row() { return <li />; }`,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toContainEqual({
          source: "App",
          target: "Row",
          supplies: [],
        });
      },
    );
  });

  it("resolves references to memo-wrapped default exports", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import Row from "./row";

          export function App() {
            return <Row />;
          }
        `,
        "src/row.tsx": `
          import * as React from "react";

          function RowBase() { return <li />; }
          export default React.memo(RowBase);
        `,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toContainEqual({
          source: "App",
          target: "RowBase",
          supplies: [],
        });
      },
    );
  });

  it("supplies list-rendered children to wrapping components", async () => {
    await withFixture(
      {
        "src/app.tsx": `
          import Layout from "./layout";
          import Row from "./row";

          export function App({ items }: { items: { id: string }[] }) {
            return (
              <Layout>
                {items.map((item) => (
                  <Row key={item.id} />
                ))}
              </Layout>
            );
          }
        `,
        "src/layout.tsx": `
          export default function Layout({ children }: { children?: unknown }) {
            return <section>{children}</section>;
          }
        `,
        "src/row.tsx": `export default function Row() { return <li />; }`,
      },
      async (scopePath) => {
        const graph = await buildComponentGraph({ scopePath, sourcePaths: ["src"] });

        expect(edgeFacts(graph)).toContainEqual({
          source: "Layout",
          target: "Row",
          supplies: ["App:children"],
        });
      },
    );
  });
});
