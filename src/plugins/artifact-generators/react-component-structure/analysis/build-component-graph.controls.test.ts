import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { type DiagramGraph, diagramGraphSchema } from "@/features/diagram/diagram-graph";

import { buildComponentGraph } from "./build-component-graph";

async function graphFor(
  source: string,
  options: { excludeComponentPatterns?: string[]; rootPatterns?: string[] } = {},
) {
  const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-component-controls-"));
  try {
    await mkdir(join(scopePath, "node_modules"));
    await symlink(
      dirname(dirname(createRequire(import.meta.url).resolve("typescript"))),
      join(scopePath, "node_modules/typescript"),
      "junction",
    );
    await writeFile(join(scopePath, "app.tsx"), source);
    const graph = await buildComponentGraph({ scopePath, sourcePaths: ["app.tsx"], rootPatterns: ["App"], ...options });
    diagramGraphSchema.parse(JSON.parse(JSON.stringify(graph)));
    return graph;
  } finally {
    await rm(scopePath, { recursive: true });
  }
}

function edgeTo(graph: DiagramGraph, title: string) {
  const target = graph.nodes.find((node) => node.title === title)!;
  return graph.edges.find((edge) => edge.target === target.id)!;
}

describe("component rendering controls", () => {
  it.each([
    {
      body: "if (outer) { if (hidden) return null; } return <Leaf />;",
      paths: [
        [
          { label: "outer", value: "true" },
          { label: "!(hidden)", value: "on" },
        ],
        [{ label: "outer", value: "false" }],
      ],
    },
    {
      body: "switch (mode) { case 0: if (hidden) return null; case 1: return <Leaf />; default: return null; }",
      paths: [
        [
          { label: "mode", value: "case:0" },
          { label: "!(hidden)", value: "on" },
        ],
        [{ label: "mode", value: "case:1" }],
      ],
    },
  ])("keeps surrounding continuation paths after nested exits: $body", async ({ body, paths }) => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      export function App({ outer, hidden, mode }) { ${body} }
    `);
    const edge = edgeTo(graph, "Leaf");
    const controls = new Map(graph.controls!.map((control) => [control.id, control]));
    expect(
      edge.type === "default" &&
        edge.activeWhen!.map((path) =>
          path.map(({ controlId, value }) => ({ label: controls.get(controlId)!.label, value })),
        ),
    ).toEqual(paths);
  });

  it.each([
    {
      parameter: "children",
      body: "<>{children}</>",
      alias: "const leaf = <Leaf />;",
      receivers: "<><Receiver>{a && leaf}</Receiver><Receiver>{b && leaf}</Receiver></>",
    },
    {
      parameter: "panel",
      body: "<>{panel}</>",
      alias: "const leaf = <Leaf />;",
      receivers: "<><Receiver panel={a && leaf} /><Receiver panel={b && leaf} /></>",
    },
    {
      parameter: "render",
      body: "<>{render()}</>",
      alias: "const render = () => <Leaf />;",
      receivers: "<><Receiver render={a && render} /><Receiver render={b && render} /></>",
    },
    {
      parameter: "component: Component",
      body: "<Component />",
      alias: "const Component = Leaf;",
      receivers: "<><Receiver component={a && Component} /><Receiver component={b && Component} /></>",
    },
  ])(
    "keeps receiver-specific paths for reused supplied aliases: $parameter",
    async ({ parameter, body, alias, receivers }) => {
      const graph = await graphFor(`
      function Leaf() { return <span />; }
      function Receiver({ ${parameter} }) { return ${body}; }
      export function App({ a, b }) { ${alias} return ${receivers}; }
    `);
      const receiverNodes = graph.nodes.filter(({ title }) => title === "Receiver");
      expect(receiverNodes).toHaveLength(2);
      const controls = new Map(graph.controls!.map((control) => [control.id, control]));
      const paths = receiverNodes.map(({ id }) => {
        const [edge] = graph.edges.filter(({ source }) => source === id);
        expect(edge?.type === "default" && edge.activeWhen!).toHaveLength(1);
        const path = edge?.type === "default" ? edge.activeWhen!.at(0)! : [];
        return path.map(({ controlId, value }) => ({ label: controls.get(controlId)!.label, value }));
      });
      expect(paths).toEqual(expect.arrayContaining([[{ label: "a", value: "on" }], [{ label: "b", value: "on" }]]));
    },
  );

  it("keeps nested branch prerequisites and normalizes both null arms as switches", async () => {
    const graph = await graphFor(`
      function Left() { return <span />; }
      function Right() { return <aside />; }
      function Extra() { return <footer />; }
      export function App({ ready, choice, hidden }) {
        const content = ready ? (choice ? <Left /> : <Right />) : null;
        return <>{content}{hidden ? null : <Extra />}</>;
      }
    `);
    const controls = graph.controls!;
    expect(controls).toHaveLength(3);
    const ready = controls.find((control) => control.label === "ready")!;
    const choice = controls.find((control) => control.label === "choice")!;
    const visible = controls.find((control) => control.label === "!(hidden)")!;
    expect(ready).toMatchObject({ kind: "conditional", dependsOn: [[]] });
    expect(visible).toMatchObject({ kind: "conditional", dependsOn: [[]] });
    expect(choice).toMatchObject({
      kind: "branch",
      dependsOn: [[{ controlId: ready.id, value: "on" }]],
      cases: [
        { id: "true", label: "choice" },
        { id: "false", label: "!(choice)" },
      ],
    });
    expect(edgeTo(graph, "Left")).toMatchObject({
      activeWhen: [
        [
          { controlId: ready.id, value: "on" },
          { controlId: choice.id, value: "true" },
        ],
      ],
    });
    expect(edgeTo(graph, "Right")).toMatchObject({
      activeWhen: [
        [
          { controlId: ready.id, value: "on" },
          { controlId: choice.id, value: "false" },
        ],
      ],
    });
    expect(edgeTo(graph, "Extra")).toMatchObject({ activeWhen: [[{ controlId: visible.id, value: "on" }]] });
  });

  it("keeps each chained condition with its preceding prerequisites", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      export function App({ first, second, third }) { return <>{first && second && third && <Leaf />}</>; }
    `);
    const [first, second, third] = graph.controls!;
    expect(graph.controls!.map(({ label }) => label)).toEqual(["first", "second", "third"]);
    expect(second!.dependsOn).toEqual([[{ controlId: first!.id, value: "on" }]]);
    expect(third!.dependsOn).toEqual([
      [
        { controlId: first!.id, value: "on" },
        { controlId: second!.id, value: "on" },
      ],
    ]);
    expect(edgeTo(graph, "Leaf")).toMatchObject({
      activeWhen: [
        [
          { controlId: first!.id, value: "on" },
          { controlId: second!.id, value: "on" },
          { controlId: third!.id, value: "on" },
        ],
      ],
    });
  });

  it("stops cyclic immutable output aliases without losing other verified output", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      function Receiver({ children }) { return <>{children}</>; }
      export function App() {
        const loop = <>{loop}<Leaf /></>;
        return <>{loop}<Receiver>{loop}</Receiver></>;
      }
    `);
    expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Leaf", "Receiver"]);
    expect(graph.controls!).toEqual([]);
  });

  it("omits controls whose only rendered boundary is hidden", async () => {
    const graph = await graphFor(
      `
      function Leaf() { return <span />; }
      function Hidden() { return <aside />; }
      export function App({ ready }) { return <><Leaf />{ready && <Hidden />}</>; }
    `,
      { excludeComponentPatterns: ["Hidden"] },
    );
    expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Leaf"]);
    expect(graph.controls!).toEqual([]);
  });

  it("keeps every route when both branches reuse the same forwarded JSX alias", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      function Receiver({ children }) { return <>{children}</>; }
      function Wrapper({ children, choice }) {
        const output = <Receiver>{children}</Receiver>;
        return choice ? output : output;
      }
      export function App() { return <Wrapper><Leaf /></Wrapper>; }
    `);
    const choice = graph.controls!.find(({ label }) => label === "choice")!;
    expect(edgeTo(graph, "Leaf")).toMatchObject({
      activeWhen: [[{ controlId: choice.id, value: "true" }], [{ controlId: choice.id, value: "false" }]],
    });
  });

  it("recognizes aliased roots and JSX consumers that only return supplied nodes", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      function Receiver({ children, hidden }) { if (hidden) return null; return children; }
      export function App({ ready }) {
        const empty = null;
        const output = ready ? <Receiver><Leaf /></Receiver> : empty;
        return output;
      }
    `);
    expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Leaf", "Receiver"]);
    const controls = graph.controls!;
    expect(controls).toHaveLength(2);
    expect(controls.find(({ label }) => label === "ready")).toMatchObject({ kind: "conditional" });
    const hidden = controls.find(({ label }) => label === "!(hidden)")!;
    expect(edgeTo(graph, "Leaf")).toMatchObject({ activeWhen: [[{ controlId: hidden.id, value: "on" }]] });
  });

  it("orders sibling controls by source order rather than hashed usage IDs", async () => {
    const graph = await graphFor(
      `function Leaf(){return <i/>}export function App({a,b,c,d}){return <>{a&&<Leaf/>}{b&&<Leaf/>}{c&&<Leaf/>}{d&&<Leaf/>}</>}`,
    );
    expect(graph.controls!.map(({ label }) => label)).toEqual(["a", "b", "c", "d"]);
  });

  it("preserves original supplier prop pairs when forwarding renames them before merged rendering", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      function Inner({ children }) { return <>{children}</>; }
      function Wrapper({ header, footer }) { return <><Inner>{header}</Inner><Inner>{footer}</Inner></>; }
      function Other() { return <Wrapper header={<Leaf />} />; }
      export function App() { return <><Wrapper header={<Leaf />} /><Wrapper footer={<Leaf />} /><Other /></>; }
    `);
    const leaf = graph.nodes.find(({ title }) => title === "Leaf")!;
    expect(leaf.type === "default" && leaf.component!.origins).toHaveLength(3);
    expect(leaf.type === "default" && leaf.component!.origins).toEqual(
      expect.arrayContaining([
        { supplierId: "component:app.tsx#App", supplierTitle: "App", prop: "header" },
        { supplierId: "component:app.tsx#App", supplierTitle: "App", prop: "footer" },
        { supplierId: "component:app.tsx#Other", supplierTitle: "Other", prop: "header" },
      ]),
    );
  });

  it("merges equivalent instance controls and keeps every supplier-prop origin pair", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      function Other() { return <aside />; }
      function Branch({ show }) { return show ? <Leaf /> : <Other />; }
      function Receiver({ children, panel }) { return <>{children}{panel}</>; }
      function First() { return <Receiver panel={<Leaf />}><Leaf /></Receiver>; }
      function Second() { return <Receiver><Leaf /></Receiver>; }
      export function App() { return <><Branch /><Branch /><First /><Second /></>; }
    `);
    expect(graph.nodes.filter(({ title }) => title === "Branch")).toHaveLength(1);
    const branch = graph.nodes.find(({ title }) => title === "Branch")!;
    expect(graph.controls!).toMatchObject([{ owner: branch.id, label: "show", kind: "branch" }]);
    const leaf = graph.nodes.find(({ title }) => title === "Leaf")!;
    expect(leaf.type === "default" && leaf.component!.origins).toEqual(
      expect.arrayContaining([
        { supplierId: "component:app.tsx#First", supplierTitle: "First", prop: "children" },
        { supplierId: "component:app.tsx#First", supplierTitle: "First", prop: "panel" },
        { supplierId: "component:app.tsx#Second", supplierTitle: "Second", prop: "children" },
      ]),
    );
    expect(leaf.type === "default" && leaf.component!.origins).toHaveLength(3);
  });

  it("removes outside supplier control requirements when focusing on their consumer", async () => {
    const graph = await graphFor(
      `
      function Leaf() { return <span />; }
      function Shell({ children, visible }) { return <>{visible && children}</>; }
      export function App({ ready }) { return <Shell>{ready && <Leaf />}</Shell>; }
    `,
      { rootPatterns: ["Shell"] },
    );
    const shell = graph.nodes.find(({ title }) => title === "Shell")!;
    const [visible] = graph.controls!;
    expect(graph.roots!).toEqual([shell.id]);
    expect(graph.controls!).toMatchObject([{ owner: shell.id, label: "visible", dependsOn: [[]] }]);
    expect(edgeTo(graph, "Leaf")).toMatchObject({ activeWhen: [[{ controlId: visible!.id, value: "on" }]] });
    expect(graph.nodes.find(({ title }) => title === "Leaf")).toMatchObject({
      component: { origins: [{ supplierId: "component:app.tsx#App", supplierTitle: "App", prop: "children" }] },
    });
  });

  it("keeps only the created seed as root of a conditional source cycle", async () => {
    const graph = await graphFor(
      `
      export function A({ enabled }) { return <>{enabled && <B />}</>; }
      function B() { return <A />; }
    `,
      { rootPatterns: [] },
    );
    const first = graph.nodes.find(({ title }) => title === "A")!;
    const second = graph.nodes.find(({ title }) => title === "B")!;
    const [enabled] = graph.controls!;
    expect(graph.roots!).toEqual([first.id]);
    expect(enabled).toMatchObject({ owner: first.id, label: "enabled", dependsOn: [[]] });
    expect(edgeTo(graph, "B")).toMatchObject({
      source: first.id,
      activeWhen: [[{ controlId: enabled!.id, value: "on" }]],
    });
    expect(edgeTo(graph, "A")).toMatchObject({ source: second.id, activeWhen: [[]] });
  });

  it("keeps recursive control references finite and rebases focused roots", async () => {
    const graph = await graphFor(
      `
      function Leaf() { return <span />; }
      function Recursive({ more }) { return <>{more && <Recursive />}<Leaf /></>; }
      export function App({ ready }) { return <>{ready && <Recursive />}</>; }
    `,
      { rootPatterns: ["Recursive"] },
    );
    const recursive = graph.nodes.find(({ title }) => title === "Recursive")!;
    expect(graph.roots!).toEqual([recursive.id]);
    expect(graph.controls!).toMatchObject([{ owner: recursive.id, label: "more", dependsOn: [[]] }]);
    const cycle = graph.edges.find(({ source, target }) => source === recursive.id && target === recursive.id)!;
    expect(cycle).toMatchObject({
      activeWhen: [[{ controlId: graph.controls!.at(0)!.id, value: "on" }]],
    });
    expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["Leaf", "Recursive"]);
  });

  it("preserves guards through conditional aliases and hidden forwarding boundaries", async () => {
    const graph = await graphFor(
      `
      function Leaf() { return <span />; }
      function Renderer({ slot, visible }) { return <>{visible && slot}</>; }
      function Hidden({ children, ready }) {
        const content = ready ? children : null;
        return <Renderer slot={content} />;
      }
      export function App({ enabled }) { return <>{enabled && <Hidden><Leaf /></Hidden>}</>; }
    `,
      { excludeComponentPatterns: ["Hidden"] },
    );
    expect(graph.nodes.map(({ title }) => title).toSorted()).toEqual(["App", "Leaf"]);
    const controls = graph.controls!;
    expect(controls.map(({ label }) => label)).toEqual(["enabled", "ready", "visible"]);
    const app = graph.nodes.find(({ title }) => title === "App")!;
    expect(controls.every(({ owner }) => owner === app.id)).toBe(true);
    expect(controls.at(1)!.dependsOn).toEqual([[{ controlId: controls.at(0)!.id, value: "on" }]]);
    expect(controls.at(2)!.dependsOn).toEqual([
      [
        { controlId: controls.at(0)!.id, value: "on" },
        { controlId: controls.at(1)!.id, value: "on" },
      ],
    ]);
    expect(edgeTo(graph, "Leaf")).toMatchObject({
      activeWhen: [
        [
          { controlId: controls.at(0)!.id, value: "on" },
          { controlId: controls.at(1)!.id, value: "on" },
          { controlId: controls.at(2)!.id, value: "on" },
        ],
      ],
    });
  });

  it("combines supplier and consumer controls for children, node, render and component props", async () => {
    const graph = await graphFor(`
      function Child() { return <span />; }
      function Panel() { return <main />; }
      function Rendered() { return <aside />; }
      function Widget() { return <footer />; }
      function Consumer({ children, panel, render, component: Component, show }) {
        return <>{show && children}{show && panel}{show && render()}{show && <Component />}</>;
      }
      export function App({ ready }) {
        return <Consumer panel={ready ? <Panel /> : null} render={() => ready && <Rendered />} component={ready ? Widget : null}>
          {ready && <Child />}
        </Consumer>;
      }
    `);
    const controls = graph.controls!;
    expect(controls).toHaveLength(8);
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const [title, prop] of [
      ["Child", "children"],
      ["Panel", "panel"],
      ["Rendered", "render"],
      ["Widget", "component"],
    ]) {
      const edge = edgeTo(graph, title!);
      const target = nodes.get(edge.target)!;
      expect(target.type === "default" && target.component!.origins).toContainEqual(expect.objectContaining({ prop }));
      expect(edge.type === "default" && edge.activeWhen!).toHaveLength(1);
      const path = edge.type === "default" ? edge.activeWhen!.at(0)! : [];
      expect(path).toHaveLength(2);
      expect(path.map(({ controlId }) => controls.find(({ id }) => id === controlId)?.label)).toEqual([
        "ready",
        "show",
      ]);
      expect(path.map(({ controlId }) => nodes.get(controls.find(({ id }) => id === controlId)!.owner)?.title)).toEqual(
        ["App", "Consumer"],
      );
      expect(nodes.get(edge.target)).toMatchObject({
        component: { origins: [{ supplierId: "component:app.tsx#App", supplierTitle: "App", prop }] },
      });
    }
  });

  it("tracks conditional switch breaks into the following return", async () => {
    const graph = await graphFor(`
      function First() { return <span />; }
      function Second() { return <aside />; }
      function After() { return <footer />; }
      export function App({ mode, stop }) {
        switch (mode) {
          case "first": if (stop) break; return <First />;
          default: return <Second />;
        }
        return <After />;
      }
    `);
    const [mode, stop] = graph.controls!;
    expect(stop).toMatchObject({
      kind: "branch",
      label: "stop",
      dependsOn: [[{ controlId: mode!.id, value: "case:0" }]],
    });
    expect(edgeTo(graph, "First")).toMatchObject({
      activeWhen: [
        [
          { controlId: mode!.id, value: "case:0" },
          { controlId: stop!.id, value: "false" },
        ],
      ],
    });
    expect(edgeTo(graph, "After")).toMatchObject({
      activeWhen: [
        [
          { controlId: mode!.id, value: "case:0" },
          { controlId: stop!.id, value: "true" },
        ],
      ],
    });
  });

  it("tracks early returns and switch fallthrough in source nesting order", async () => {
    const graph = await graphFor(`
      function First() { return <span />; }
      function Second() { return <aside />; }
      function Other() { return <footer />; }
      export function App({ hidden, mode, ready }) {
        if (hidden) return null;
        switch (mode) {
          case "first":
          case "alias": return ready ? <First /> : <Second />;
          default: return <Other />;
        }
      }
    `);
    const controls = graph.controls!;
    expect(controls.map(({ label }) => label)).toEqual(["!(hidden)", "mode", "ready"]);
    const [visible, mode, ready] = controls;
    expect(visible).toMatchObject({ kind: "conditional", dependsOn: [[]] });
    expect(mode).toMatchObject({
      kind: "branch",
      dependsOn: [[{ controlId: visible!.id, value: "on" }]],
      cases: [
        { id: "case:0", label: '"first"' },
        { id: "case:1", label: '"alias"' },
        { id: "case:2", label: "default" },
      ],
    });
    expect(ready).toMatchObject({
      kind: "branch",
      dependsOn: [
        [
          { controlId: visible!.id, value: "on" },
          { controlId: mode!.id, value: "case:0" },
        ],
        [
          { controlId: visible!.id, value: "on" },
          { controlId: mode!.id, value: "case:1" },
        ],
      ],
    });
    expect(edgeTo(graph, "First")).toMatchObject({
      activeWhen: [
        [
          { controlId: visible!.id, value: "on" },
          { controlId: mode!.id, value: "case:0" },
          { controlId: ready!.id, value: "true" },
        ],
        [
          { controlId: visible!.id, value: "on" },
          { controlId: mode!.id, value: "case:1" },
          { controlId: ready!.id, value: "true" },
        ],
      ],
    });
    expect(edgeTo(graph, "Other")).toMatchObject({
      activeWhen: [
        [
          { controlId: visible!.id, value: "on" },
          { controlId: mode!.id, value: "case:2" },
        ],
      ],
    });
  });

  it("keeps conditional render invocation aliases passed into node props", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      function Receiver({ panel }) { return <>{panel}</>; }
      function Wrapper({ render, visible }) {
        const panel = visible ? render() : null;
        return <Receiver panel={panel} />;
      }
      export function App() { return <Wrapper render={() => <Leaf />} />; }
    `);
    const visible = graph.controls!.find(({ label }) => label === "visible")!;
    const wrapper = graph.nodes.find(({ title }) => title === "Wrapper")!;
    expect(edgeTo(graph, "Leaf")).toMatchObject({
      source: wrapper.id,
      activeWhen: [[{ controlId: visible.id, value: "on" }]],
    });
  });

  it("keeps aliased supplied output nested inside nullish fallback", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      function Fallback() { return <aside />; }
      function Receiver({ children, ready }) {
        const content = ready ? children : null;
        return <>{content ?? <Fallback />}</>;
      }
      export function App() { return <Receiver><Leaf /></Receiver>; }
    `);
    const controls = graph.controls!;
    const content = controls.find(({ label }) => label === "content")!;
    const ready = controls.find(({ label }) => label === "ready")!;
    expect(content).toMatchObject({ kind: "branch" });
    expect(ready).toMatchObject({ kind: "conditional", dependsOn: [[{ controlId: content.id, value: "left" }]] });
    expect(edgeTo(graph, "Leaf")).toMatchObject({
      activeWhen: [
        [
          { controlId: content.id, value: "left" },
          { controlId: ready.id, value: "on" },
        ],
      ],
    });
  });

  it.each(["||", "??"])("keeps component-prop left alternatives for %s", async (operator) => {
    const graph = await graphFor(`
      function First() { return <span />; }
      function Second() { return <aside />; }
      function Receiver({ component: Component }) { return <Component />; }
      export function App() { return <Receiver component={First ${operator} Second} />; }
    `);
    const control = graph.controls!.at(0)!;
    expect(control).toMatchObject({ label: "First", kind: "branch" });
    expect(edgeTo(graph, "First")).toMatchObject({
      activeWhen: [[{ controlId: control.id, value: "left" }]],
    });
    expect(edgeTo(graph, "Second")).toMatchObject({
      activeWhen: [[{ controlId: control.id, value: "right" }]],
    });
  });

  it("keeps supplied left operands and conditional render callbacks", async () => {
    const graph = await graphFor(`
      function Child() { return <span />; }
      function Fallback() { return <aside />; }
      function First() { return <header />; }
      function Second() { return <footer />; }
      function Receiver({ children, render }) { return <>{children ?? <Fallback />}{render()}</>; }
      export function App({ choice }) {
        return <Receiver render={choice ? () => <First /> : () => <Second />}><Child /></Receiver>;
      }
    `);
    const controls = graph.controls!;
    const children = controls.find(({ label }) => label === "children")!;
    expect(children).toMatchObject({
      kind: "branch",
      cases: [
        { id: "left", label: "children" },
        { id: "right", label: "children == null" },
      ],
    });
    expect(edgeTo(graph, "Child")).toMatchObject({
      activeWhen: [[{ controlId: children.id, value: "left" }]],
    });
    expect(edgeTo(graph, "Fallback")).toMatchObject({
      activeWhen: [[{ controlId: children.id, value: "right" }]],
    });
    const choice = controls.find(({ label }) => label === "choice")!;
    expect(choice).toMatchObject({ kind: "branch" });
    expect(edgeTo(graph, "First")).toMatchObject({
      activeWhen: [[{ controlId: choice.id, value: "true" }]],
    });
    expect(edgeTo(graph, "Second")).toMatchObject({
      activeWhen: [[{ controlId: choice.id, value: "false" }]],
    });
  });

  it("keeps rendered left operands of logical and nullish alternatives", async () => {
    const graph = await graphFor(`
      function Preferred() { return <span />; }
      function Fallback() { return <aside />; }
      function Empty() { return <footer />; }
      export function App() {
        const value = undefined;
        const preferred = <Preferred />;
        return <>{preferred || <Fallback />}{value ?? <Empty />}</>;
      }
    `);
    const controls = graph.controls!;
    const branch = controls.find((control) => control.kind === "branch")!;
    expect(branch).toMatchObject({
      kind: "branch",
      label: "preferred",
      cases: [
        { id: "left", label: "preferred" },
        { id: "right", label: "!(preferred)" },
      ],
    });
    expect(edgeTo(graph, "Preferred")).toMatchObject({
      activeWhen: [[{ controlId: branch.id, value: "left" }]],
    });
    expect(edgeTo(graph, "Fallback")).toMatchObject({
      activeWhen: [[{ controlId: branch.id, value: "right" }]],
    });
    const nullish = controls.find((control) => control.label === "value == null")!;
    expect(nullish).toMatchObject({ kind: "conditional" });
    expect(edgeTo(graph, "Empty")).toMatchObject({ activeWhen: [[{ controlId: nullish.id, value: "on" }]] });
  });

  it("emits a condition only for conditional JSX, not repeated simultaneous uses", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      function Extra() { return <aside />; }
      export function App({ ready }) { return <><Leaf /><Leaf />{ready && <Extra />}</>; }
    `);
    const app = graph.nodes.find((node) => node.title === "App")!;
    expect({ roots: graph.roots, controls: graph.controls }).toEqual({
      roots: [app.id],
      controls: [{ id: expect.any(String), owner: app.id, label: "ready", kind: "conditional", dependsOn: [[]] }],
    });
    const control = graph.controls!.at(0)!;
    expect(edgeTo(graph, "Leaf")).toMatchObject({ activeWhen: [[]] });
    expect(edgeTo(graph, "Extra")).toMatchObject({ activeWhen: [[{ controlId: control.id, value: "on" }]] });
    expect(app).toMatchObject({ component: { definitionId: "component:app.tsx#App", origins: [] } });
  });
});
