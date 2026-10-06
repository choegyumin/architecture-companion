import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { type DefaultDiagramEdge, type DiagramGraph, diagramGraphSchema } from "@/features/diagram/diagram-graph";

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
  const target = graph.nodes.find((node) => node.type === "default" && node.title === title)!;
  return graph.edges.find((edge) => edge.target === target.id)!;
}

function edgeActiveWhen(graph: DiagramGraph, title: string) {
  const edge = edgeTo(graph, title);
  return edge.type === "default" ? edge.activeWhen : undefined;
}

describe("component rendering controls", () => {
  it.each([
    {
      body: "if (outer) { if (hidden) return null; } return <Leaf />;",
      paths: [
        [
          { label: "outer", value: "true" },
          { label: "!hidden", value: "on" },
        ],
        [{ label: "outer", value: "false" }],
      ],
    },
    {
      body: "switch (mode) { case 0: if (hidden) return null; case 1: return <Leaf />; default: return null; }",
      paths: [
        [
          { label: "mode", value: "case:0" },
          { label: "!hidden", value: "on" },
        ],
        [{ label: "mode", value: "case:1" }],
      ],
    },
  ])("keeps surrounding continuation paths after nested exits: $body", async ({ body, paths }) => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      export function App({ outer, hidden, mode }) { ${body} }
    `);
    // Decision projection splits one edge into per-case arms, so the contract
    // reads every edge entering the target and unions their paths.
    const target = graph.nodes.find((node) => node.type === "default" && node.title === "Leaf")!;
    const controls = new Map(graph.controls!.map((control) => [control.id, control]));
    const entered = graph.edges.flatMap((edge) =>
      edge.target === target.id && edge.type === "default" ? (edge.activeWhen ?? [[]]) : [],
    );
    expect(
      new Set(
        entered.map((path) =>
          JSON.stringify(path.map(({ controlId, value }) => ({ label: controls.get(controlId)!.label, value }))),
        ),
      ),
    ).toEqual(new Set(paths.map((path) => JSON.stringify(path))));
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
    const visible = controls.find((control) => control.label === "!hidden")!;
    expect(ready).toMatchObject({ kind: "conditional", dependsOn: [[]] });
    expect(visible).toMatchObject({ kind: "conditional", dependsOn: [[]] });
    expect(choice).toMatchObject({
      kind: "branch",
      polarityPair: true,
      dependsOn: [[{ controlId: ready.id, value: "on" }]],
      cases: [
        { id: "true", label: "choice" },
        { id: "false", label: "!choice" },
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

  it("folds double negation when deriving gate labels", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      function Other() { return <aside />; }
      function Third() { return <footer />; }
      function Fourth() { return <main />; }
      export function App({ data, ready, flag }) {
        return (
          <>
            {!(!data) ? null : <Leaf />}
            {!(!ready) ? <Other /> : null}
            {!(!flag) ? <Third /> : <Fourth />}
          </>
        );
      }
    `);
    const controls = graph.controls!;
    const [data, ready, flag] = controls;
    expect(data).toMatchObject({ kind: "conditional", label: "!data" });
    expect(ready).toMatchObject({ kind: "conditional", label: "ready" });
    expect(flag).toMatchObject({
      kind: "branch",
      label: "flag",
      polarityPair: true,
      cases: [
        { id: "true", label: "flag" },
        { id: "false", label: "!flag" },
      ],
    });
  });

  it("decomposes a wide disjunction whose only rendered arm is positive", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      export function App({ eyebrow, label, href, anchored }) { return (
        <>{eyebrow != null || label != null || href || anchored > 0 ? <Leaf /> : null}</>
      ); }
    `);
    const labels = graph.controls!.map(({ label }) => label);
    expect(labels).toEqual(["eyebrow != null", "label != null", "href", "anchored > 0"]);
    expect(graph.controls!.every(({ kind }) => kind === "conditional")).toBe(true);
    const leafEdge = edgeTo(graph, "Leaf");
    expect(leafEdge.type === "default" ? leafEdge.activeWhen : undefined).toEqual([
      [{ controlId: graph.controls!.at(0)!.id, value: "on" }],
      [{ controlId: graph.controls!.at(1)!.id, value: "on" }],
      [{ controlId: graph.controls!.at(2)!.id, value: "on" }],
      [{ controlId: graph.controls!.at(3)!.id, value: "on" }],
    ]);
  });

  it("expands the negated arm of a mixed-literal disjunction as a cross product", async () => {
    const graph = await graphFor(`
      function Left() { return <span />; }
      function Right() { return <aside />; }
      export function App({ a, b, c }) { return <>{(a && b) || c ? <Left /> : <Right />}</>; }
    `);
    const controls = new Map(graph.controls!.map((control) => [control.label, control]));
    const rightEdge = edgeTo(graph, "Right");
    // ¬((a ∧ b) ∨ c) = (¬a ∨ ¬b) ∧ ¬c — two rules, not one conjunction of all.
    expect(rightEdge.type === "default" ? rightEdge.activeWhen : undefined).toEqual([
      [
        { controlId: controls.get("a")!.id, value: "off" },
        { controlId: controls.get("c")!.id, value: "off" },
      ],
      [
        { controlId: controls.get("b")!.id, value: "off" },
        { controlId: controls.get("c")!.id, value: "off" },
      ],
    ]);
  });

  it("merges boolean ternary branches over one subject into a single switch", async () => {
    const graph = await graphFor(`
      function First() { return <span />; }
      function Second() { return <aside />; }
      function Third() { return <footer />; }
      function Fourth() { return <main />; }
      export function App({ hide }) { return (
        <>{hide ? <First /> : <Second />}{hide ? <Third /> : <Fourth />}</>
      ); }
    `);
    expect(graph.controls).toHaveLength(1);
    const [hide] = graph.controls!;
    expect(hide).toMatchObject({
      kind: "branch",
      label: "hide",
      polarityPair: true,
      cases: [
        { id: "hide", label: "hide" },
        { id: "!hide", label: "!hide" },
      ],
    });
    expect(edgeActiveWhen(graph, "First")).toEqual([[{ controlId: hide.id, value: "hide" }]]);
    expect(edgeActiveWhen(graph, "Second")).toEqual([[{ controlId: hide.id, value: "!hide" }]]);
    expect(edgeActiveWhen(graph, "Third")).toEqual([[{ controlId: hide.id, value: "hide" }]]);
    expect(edgeActiveWhen(graph, "Fourth")).toEqual([[{ controlId: hide.id, value: "!hide" }]]);
  });

  it("folds a boolean ternary branch with conditionals over the same subject", async () => {
    const graph = await graphFor(`
      function First() { return <span />; }
      function Second() { return <aside />; }
      function Third() { return <footer />; }
      export function App({ ready, hide }) { return (
        <>{hide ? <First /> : <Second />}{ready && hide && <Third />}</>
      ); }
    `);
    expect(graph.controls).toHaveLength(2);
    const [ready, hide] = graph.controls!;
    expect(ready).toMatchObject({ kind: "conditional", label: "ready" });
    expect(hide).toMatchObject({
      kind: "branch",
      label: "hide",
      polarityPair: true,
      cases: [
        { id: "hide", label: "hide" },
        { id: "!hide", label: "!hide" },
      ],
    });
    expect(edgeActiveWhen(graph, "Third")).toEqual([
      [
        { controlId: ready.id, value: "on" },
        { controlId: hide.id, value: "hide" },
      ],
    ]);
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
    const target = graph.nodes.find((node) => node.type === "default" && node.title === "Leaf")!;
    const arms = graph.edges
      .filter((edge): edge is DefaultDiagramEdge => edge.type === "default" && edge.target === target.id)
      .toSorted((left, right) => (left.sourcePort ?? "").localeCompare(right.sourcePort ?? ""));
    expect(arms.map((arm) => ({ port: arm.sourcePort, activeWhen: arm.activeWhen }))).toEqual([
      { port: "false", activeWhen: [[{ controlId: choice.id, value: "false" }]] },
      { port: "true", activeWhen: [[{ controlId: choice.id, value: "true" }]] },
    ]);
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
    const hidden = controls.find(({ label }) => label === "!hidden")!;
    expect(edgeTo(graph, "Leaf")).toMatchObject({ activeWhen: [[{ controlId: hidden.id, value: "on" }]] });
  });

  it("orders sibling controls by source order rather than hashed usage IDs", async () => {
    const graph = await graphFor(
      `function Leaf(){return <i/>}export function App({a,b,c,d}){return <>{a&&<Leaf/>}{b&&<Leaf/>}{c&&<Leaf/>}{d&&<Leaf/>}</>}`,
    );
    expect(graph.controls!.map(({ label }) => label)).toEqual(["a", "b", "c", "d"]);
  });

  it("merges scattered polarity gates of one operand into an exclusive branch", async () => {
    const graph = await graphFor(`
      function Narrow() { return <span />; }
      function Wide() { return <aside />; }
      export function App({ ready, roomy }) {
        return <>{ready && roomy && <Wide />}{ready && !roomy && <Narrow />}</>;
      }
    `);
    expect(graph.controls).toHaveLength(2);
    const [ready, roomy] = graph.controls!;
    expect(ready).toMatchObject({ kind: "conditional", label: "ready", dependsOn: [[]] });
    expect(roomy).toMatchObject({
      kind: "branch",
      label: "roomy",
      polarityPair: true,
      dependsOn: [[{ controlId: ready.id, value: "on" }]],
      cases: [
        { id: "roomy", label: "roomy" },
        { id: "!roomy", label: "!roomy" },
      ],
    });
    expect(edgeTo(graph, "Wide")).toMatchObject({
      activeWhen: [
        [
          { controlId: ready.id, value: "on" },
          { controlId: roomy.id, value: "roomy" },
        ],
      ],
    });
    expect(edgeTo(graph, "Narrow")).toMatchObject({
      activeWhen: [
        [
          { controlId: ready.id, value: "on" },
          { controlId: roomy.id, value: "!roomy" },
        ],
      ],
    });
  });

  it("strips double negation when pairing polarity gates", async () => {
    const graph = await graphFor(`
      function Narrow() { return <span />; }
      function Wide() { return <aside />; }
      export function App({ roomy }) { return <>{!!roomy && <Wide />}{!roomy && <Narrow />}</>; }
    `);
    const [roomy] = graph.controls!;
    expect(graph.controls).toHaveLength(1);
    expect(roomy).toMatchObject({
      kind: "branch",
      label: "roomy",
      polarityPair: true,
      cases: [
        { id: "roomy", label: "roomy" },
        { id: "!roomy", label: "!roomy" },
      ],
    });
    expect(edgeTo(graph, "Wide")).toMatchObject({ activeWhen: [[{ controlId: roomy.id, value: "roomy" }]] });
    expect(edgeTo(graph, "Narrow")).toMatchObject({ activeWhen: [[{ controlId: roomy.id, value: "!roomy" }]] });
  });

  it("pairs comparison gates through operator inversion", async () => {
    const graph = await graphFor(`
      function Empty() { return <span />; }
      function Filled() { return <aside />; }
      export function App({ count }) { return <>{count > 0 && <Filled />}{count <= 0 && <Empty />}</>; }
    `);
    const [count] = graph.controls!;
    expect(graph.controls).toHaveLength(1);
    expect(count).toMatchObject({
      kind: "branch",
      label: "count > 0",
      // One predicate and its complement over the same threshold — a
      // two-value subject, so it renders as a switch like any boolean gate.
      polarityPair: true,
      cases: [
        { id: "count > 0", label: "count > 0" },
        { id: "count <= 0", label: "count <= 0" },
      ],
    });
    expect(edgeTo(graph, "Filled")).toMatchObject({ activeWhen: [[{ controlId: count.id, value: "count > 0" }]] });
    expect(edgeTo(graph, "Empty")).toMatchObject({ activeWhen: [[{ controlId: count.id, value: "count <= 0" }]] });
  });

  it("enumerates equality gates over one subject as branch cases", async () => {
    const graph = await graphFor(`
      function Dark() { return <span />; }
      function Light() { return <aside />; }
      export function App({ tone }) { return <>{tone === "dark" && <Dark />}{tone === "light" && <Light />}</>; }
    `);
    const [tone] = graph.controls!;
    expect(graph.controls).toHaveLength(1);
    expect(tone).toMatchObject({
      kind: "branch",
      label: "tone",
      cases: [
        { id: '"dark"', label: '"dark"' },
        { id: '"light"', label: '"light"' },
      ],
    });
    expect(edgeTo(graph, "Dark")).toMatchObject({
      activeWhen: [[{ controlId: tone.id, value: '"dark"' }]],
    });
    expect(edgeTo(graph, "Light")).toMatchObject({
      activeWhen: [[{ controlId: tone.id, value: '"light"' }]],
    });
  });

  it("decomposes a compound if condition into atomic controls with DNF paths", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      function Other() { return <aside />; }
      export function App({ first, second }) {
        if (first && second) return <Leaf />;
        return <Other />;
      }
    `);
    const controls = graph.controls!;
    const first = controls.find(({ label }) => label === "first")!;
    const second = controls.find(({ label }) => label === "second")!;
    expect(controls).toHaveLength(2);
    expect(first).toMatchObject({ kind: "conditional", dependsOn: [[]] });
    expect(second).toMatchObject({ kind: "conditional", dependsOn: [[]] });
    expect(edgeTo(graph, "Leaf")).toMatchObject({
      activeWhen: [
        [
          { controlId: first.id, value: "on" },
          { controlId: second.id, value: "on" },
        ],
      ],
    });
    expect(edgeTo(graph, "Other")).toMatchObject({
      activeWhen: [[{ controlId: first.id, value: "off" }], [{ controlId: second.id, value: "off" }]],
    });
  });

  it("decomposes a compound ternary condition and expands negation by De Morgan", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      function Other() { return <aside />; }
      export function App({ first, second }) {
        return (first || second) ? <Leaf /> : <Other />;
      }
    `);
    const controls = graph.controls!;
    const first = controls.find(({ label }) => label === "first")!;
    const second = controls.find(({ label }) => label === "second")!;
    expect(controls).toHaveLength(2);
    expect(edgeTo(graph, "Leaf")).toMatchObject({
      activeWhen: [[{ controlId: first.id, value: "on" }], [{ controlId: second.id, value: "on" }]],
    });
    expect(edgeTo(graph, "Other")).toMatchObject({
      activeWhen: [
        [
          { controlId: first.id, value: "off" },
          { controlId: second.id, value: "off" },
        ],
      ],
    });
  });

  it("decomposes compound operands inside JSX conjunction chains", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      export function App({ first, second, third }) {
        return <>{first && (second || third) && <Leaf />}</>;
      }
    `);
    const controls = graph.controls!;
    expect(controls.map(({ label }) => label).toSorted()).toEqual(["first", "second", "third"]);
    const [first, second, third] = controls;
    expect(edgeTo(graph, "Leaf")).toMatchObject({
      activeWhen: [
        [
          { controlId: first!.id, value: "on" },
          { controlId: second!.id, value: "on" },
        ],
        [
          { controlId: first!.id, value: "on" },
          { controlId: third!.id, value: "on" },
        ],
      ],
    });
  });

  it("folds quote-style variants of one discriminant into shared cases", async () => {
    const graph = await graphFor(`
      function Dark() { return <span />; }
      function Light() { return <aside />; }
      export function App({ tone }) { return <>{tone === 'dark' && <Dark />}{tone === "dark" ? null : <Light />}</>; }
    `);
    const [tone] = graph.controls!;
    expect(graph.controls).toHaveLength(1);
    expect(tone).toMatchObject({
      kind: "branch",
      cases: [
        // Quote style normalizes, so `'dark'` and `"dark"` still share a case.
        { id: '"dark"', label: '"dark"' },
        { id: "otherwise", label: "otherwise" },
      ],
    });
  });

  it("merges an else-if chain over one subject with a synthesized remainder case", async () => {
    const graph = await graphFor(`
      function Loading() { return <span />; }
      function Failure() { return <aside />; }
      function Content() { return <main />; }
      export function App({ state }) {
        if (state.status === "loading") return <Loading />;
        if (state.status === "error") return <Failure />;
        return <Content />;
      }
    `);
    const [status] = graph.controls!;
    expect(graph.controls).toHaveLength(1);
    expect(status).toMatchObject({
      kind: "branch",
      label: "state.status",
      cases: [
        { id: '"loading"', label: '"loading"' },
        { id: '"error"', label: '"error"' },
        { id: "otherwise", label: "otherwise" },
      ],
    });
    // The failure route's inherited "not loading" drops as implied by "error",
    // and the fall-through route converges on the remainder case.
    expect(edgeTo(graph, "Loading")).toMatchObject({
      activeWhen: [[{ controlId: status.id, value: '"loading"' }]],
    });
    expect(edgeTo(graph, "Failure")).toMatchObject({
      activeWhen: [[{ controlId: status.id, value: '"error"' }]],
    });
    expect(edgeTo(graph, "Content")).toMatchObject({
      activeWhen: [[{ controlId: status.id, value: "otherwise" }]],
    });
  });

  it("expands a negated discriminant gate over the values it still allows", async () => {
    const graph = await graphFor(`
      function Dark() { return <span />; }
      function Light() { return <aside />; }
      function Neutral() { return <main />; }
      export function App({ tone }) {
        return <>{tone !== "dark" && <Neutral />}{tone === "dark" && <Dark />}{tone === "light" && <Light />}</>;
      }
    `);
    const [tone] = graph.controls!;
    expect(graph.controls).toHaveLength(1);
    expect(tone).toMatchObject({
      kind: "branch",
      label: "tone",
      cases: [
        { id: '"dark"', label: '"dark"' },
        { id: '"light"', label: '"light"' },
        { id: "otherwise", label: "otherwise" },
      ],
    });
    // Decision projection splits the expanded rule into per-case arms, so the
    // contract reads every edge entering Neutral and unions their paths.
    const neutral = graph.nodes.find((node) => node.type === "default" && node.title === "Neutral")!;
    const neutralPaths = new Set(
      graph.edges.flatMap((edge) =>
        edge.target === neutral.id && edge.type === "default" ? (edge.activeWhen ?? [[]]) : [],
      ),
    );
    expect(neutralPaths).toEqual(
      new Set([[{ controlId: tone.id, value: '"light"' }], [{ controlId: tone.id, value: "otherwise" }]]),
    );
    expect(edgeTo(graph, "Dark")).toMatchObject({
      activeWhen: [[{ controlId: tone.id, value: '"dark"' }]],
    });
    expect(edgeTo(graph, "Light")).toMatchObject({
      activeWhen: [[{ controlId: tone.id, value: '"light"' }]],
    });
  });

  it("folds repeated single-polarity gates into one conditional", async () => {
    const graph = await graphFor(`
      function First() { return <span />; }
      function Second() { return <aside />; }
      export function App({ flag }) { return <>{flag && <First />}{flag && <Second />}</>; }
    `);
    const [flag] = graph.controls!;
    expect(graph.controls).toHaveLength(1);
    expect(flag).toMatchObject({ kind: "conditional", label: "flag", dependsOn: [[]] });
    expect(edgeTo(graph, "First")).toMatchObject({ activeWhen: [[{ controlId: flag.id, value: "on" }]] });
    expect(edgeTo(graph, "Second")).toMatchObject({ activeWhen: [[{ controlId: flag.id, value: "on" }]] });
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
    // The four `ready` gates and four `show` gates each fold into one control:
    // one owner, one operand, one switch over it.
    expect(controls).toHaveLength(2);
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
    expect(controls.map(({ label }) => label)).toEqual(["!hidden", "mode", "ready"]);
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
        { id: "right", label: "!preferred" },
      ],
    });
    // The decision is the left operand's truthiness, so it is a switch even
    // though the arms render value alternatives.
    expect(branch.polarityPair).toBe(true);
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
