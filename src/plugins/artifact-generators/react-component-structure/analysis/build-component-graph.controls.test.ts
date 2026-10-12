import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { projectDecisionNodes } from "@/features/diagram/decision-nodes";
import {
  type ComponentStructureDiagramGraph,
  componentStructureDiagramGraphSchema,
} from "@/features/diagram/diagram-graph";

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
    componentStructureDiagramGraphSchema.parse(JSON.parse(JSON.stringify(graph)));
    return graph;
  } finally {
    await rm(scopePath, { recursive: true });
  }
}

function edgeTo(graph: Pick<ComponentStructureDiagramGraph, "nodes" | "edges">, title: string) {
  const target = graph.nodes.find((node) => node.type === "default" && node.title === title)!;
  return graph.edges.find((edge) => edge.targetNodeId === target.nodeId)!;
}

// A stored `default` edge applies unconditionally, so its ruleset reads [[]].
function edgeActiveWhen(graph: ComponentStructureDiagramGraph, title: string) {
  const edge = edgeTo(graph, title);
  return edge.type === "control" ? edge.activeWhen : [[]];
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
    // Gating may land on several edges entering the target, so the contract
    // reads every edge entering it and unions their paths.
    const target = graph.nodes.find((node) => node.type === "default" && node.title === "Leaf")!;
    const controls = new Map(graph.layoutContext.controls.map((control) => [control.controlId, control]));
    const entered = graph.edges.flatMap((edge) =>
      edge.targetNodeId === target.nodeId ? (edge.type === "control" ? edge.activeWhen : [[]]) : [],
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
      const controls = new Map(graph.layoutContext.controls.map((control) => [control.controlId, control]));
      const paths = receiverNodes.map(({ nodeId }) => {
        const [edge] = graph.edges.filter(({ sourceNodeId }) => sourceNodeId === nodeId);
        const ruleset = edge?.type === "control" ? edge.activeWhen : [[]];
        expect(ruleset).toHaveLength(1);
        return ruleset.at(0)!.map(({ controlId, value }) => ({ label: controls.get(controlId)!.label, value }));
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
    const controls = graph.layoutContext.controls;
    expect(controls).toHaveLength(3);
    const ready = controls.find((control) => control.label === "ready")!;
    const choice = controls.find((control) => control.label === "choice")!;
    const visible = controls.find((control) => control.label === "!hidden")!;
    expect(ready).toMatchObject({ type: "conditional" });
    expect(visible).toMatchObject({ type: "conditional" });
    expect(choice).toMatchObject({
      type: "branch",
      polarityPair: true,
      dependsOn: [[{ controlId: ready.controlId, value: "on" }]],
      cases: [
        { caseId: "true", label: "choice" },
        { caseId: "false", label: "!choice" },
      ],
    });
    expect(edgeTo(graph, "Left")).toMatchObject({
      activeWhen: [
        [
          { controlId: ready.controlId, value: "on" },
          { controlId: choice.controlId, value: "true" },
        ],
      ],
    });
    expect(edgeTo(graph, "Right")).toMatchObject({
      activeWhen: [
        [
          { controlId: ready.controlId, value: "on" },
          { controlId: choice.controlId, value: "false" },
        ],
      ],
    });
    expect(edgeTo(graph, "Extra")).toMatchObject({ activeWhen: [[{ controlId: visible.controlId, value: "on" }]] });
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
    const controls = graph.layoutContext.controls;
    const [data, ready, flag] = controls;
    expect(data).toMatchObject({ type: "conditional", label: "!data" });
    expect(ready).toMatchObject({ type: "conditional", label: "ready" });
    expect(flag).toMatchObject({
      type: "branch",
      label: "flag",
      polarityPair: true,
      cases: [
        { caseId: "true", label: "flag" },
        { caseId: "false", label: "!flag" },
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
    const labels = graph.layoutContext.controls.map(({ label }) => label);
    expect(labels).toEqual(["eyebrow != null", "label != null", "href", "anchored > 0"]);
    expect(graph.layoutContext.controls.every(({ type }) => type === "conditional")).toBe(true);
    const leafEdge = edgeTo(graph, "Leaf");
    expect(leafEdge.type === "control" ? leafEdge.activeWhen : [[]]).toEqual([
      [{ controlId: graph.layoutContext.controls.at(0)!.controlId, value: "on" }],
      [{ controlId: graph.layoutContext.controls.at(1)!.controlId, value: "on" }],
      [{ controlId: graph.layoutContext.controls.at(2)!.controlId, value: "on" }],
      [{ controlId: graph.layoutContext.controls.at(3)!.controlId, value: "on" }],
    ]);
  });

  it("expands the negated arm of a mixed-literal disjunction as a cross product", async () => {
    const graph = await graphFor(`
      function Left() { return <span />; }
      function Right() { return <aside />; }
      export function App({ a, b, c }) { return <>{(a && b) || c ? <Left /> : <Right />}</>; }
    `);
    const controls = new Map(graph.layoutContext.controls.map((control) => [control.label, control]));
    const rightEdge = edgeTo(graph, "Right");
    // ¬((a ∧ b) ∨ c) = (¬a ∨ ¬b) ∧ ¬c — two rules, not one conjunction of all.
    expect(rightEdge.type === "control" ? rightEdge.activeWhen : [[]]).toEqual([
      [
        { controlId: controls.get("a")!.controlId, value: "off" },
        { controlId: controls.get("c")!.controlId, value: "off" },
      ],
      [
        { controlId: controls.get("b")!.controlId, value: "off" },
        { controlId: controls.get("c")!.controlId, value: "off" },
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
    expect(graph.layoutContext.controls).toHaveLength(1);
    const [hide] = graph.layoutContext.controls;
    expect(hide).toMatchObject({
      type: "branch",
      label: "hide",
      polarityPair: true,
      cases: [
        { caseId: "hide", label: "hide" },
        { caseId: "!hide", label: "!hide" },
      ],
    });
    expect(edgeActiveWhen(graph, "First")).toEqual([[{ controlId: hide.controlId, value: "hide" }]]);
    expect(edgeActiveWhen(graph, "Second")).toEqual([[{ controlId: hide.controlId, value: "!hide" }]]);
    expect(edgeActiveWhen(graph, "Third")).toEqual([[{ controlId: hide.controlId, value: "hide" }]]);
    expect(edgeActiveWhen(graph, "Fourth")).toEqual([[{ controlId: hide.controlId, value: "!hide" }]]);
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
    expect(graph.layoutContext.controls).toHaveLength(2);
    // Numbering follows first appearance in route rulesets, so the test reads
    // the controls by label instead of position.
    const ready = graph.layoutContext.controls.find((control) => control.label === "ready")!;
    const hide = graph.layoutContext.controls.find((control) => control.label === "hide")!;
    expect(ready).toMatchObject({ type: "conditional", label: "ready" });
    expect(hide).toMatchObject({
      type: "branch",
      label: "hide",
      polarityPair: true,
      cases: [
        { caseId: "hide", label: "hide" },
        { caseId: "!hide", label: "!hide" },
      ],
    });
    expect(edgeActiveWhen(graph, "Third")).toEqual([
      [
        { controlId: ready.controlId, value: "on" },
        { controlId: hide.controlId, value: "hide" },
      ],
    ]);
  });

  it("keeps each chained condition with its preceding prerequisites", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      export function App({ first, second, third }) { return <>{first && second && third && <Leaf />}</>; }
    `);
    const [first, second, third] = graph.layoutContext.controls;
    expect(graph.layoutContext.controls.map(({ label }) => label)).toEqual(["first", "second", "third"]);
    expect(second!.dependsOn).toEqual([[{ controlId: first!.controlId, value: "on" }]]);
    expect(third!.dependsOn).toEqual([
      [
        { controlId: first!.controlId, value: "on" },
        { controlId: second!.controlId, value: "on" },
      ],
    ]);
    expect(edgeTo(graph, "Leaf")).toMatchObject({
      activeWhen: [
        [
          { controlId: first!.controlId, value: "on" },
          { controlId: second!.controlId, value: "on" },
          { controlId: third!.controlId, value: "on" },
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
    expect(graph.layoutContext.controls).toEqual([]);
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
    expect(graph.layoutContext.controls).toEqual([]);
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
    const choice = graph.layoutContext.controls.find(({ label }) => label === "choice")!;
    const target = graph.nodes.find((node) => node.type === "default" && node.title === "Leaf")!;
    // Both cases survive into the stored edge's ruleset; the projection splits
    // them back into decision arms, so the assertion reads the arms.
    const arms = projectDecisionNodes(graph)
      .edges.filter((edge) => edge.source === choice.controlId && edge.target === target.nodeId)
      .toSorted((left, right) => (left.sourcePort ?? "").localeCompare(right.sourcePort ?? ""));
    expect(arms.map((arm) => ({ port: arm.sourcePort, activeWhen: arm.activeWhen }))).toEqual([
      { port: "false", activeWhen: [[{ controlId: choice.controlId, value: "false" }]] },
      { port: "true", activeWhen: [[{ controlId: choice.controlId, value: "true" }]] },
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
    const controls = graph.layoutContext.controls;
    expect(controls).toHaveLength(2);
    expect(controls.find(({ label }) => label === "ready")).toMatchObject({ type: "conditional" });
    const hidden = controls.find(({ label }) => label === "!hidden")!;
    expect(edgeTo(graph, "Leaf")).toMatchObject({ activeWhen: [[{ controlId: hidden.controlId, value: "on" }]] });
  });

  it("orders sibling controls by source order rather than hashed usage IDs", async () => {
    const graph = await graphFor(
      `function Leaf(){return <i/>}export function App({a,b,c,d}){return <>{a&&<Leaf/>}{b&&<Leaf/>}{c&&<Leaf/>}{d&&<Leaf/>}</>}`,
    );
    expect(graph.layoutContext.controls.map(({ label }) => label)).toEqual(["a", "b", "c", "d"]);
  });

  it("merges scattered polarity gates of one operand into an exclusive branch", async () => {
    const graph = await graphFor(`
      function Narrow() { return <span />; }
      function Wide() { return <aside />; }
      export function App({ ready, roomy }) {
        return <>{ready && roomy && <Wide />}{ready && !roomy && <Narrow />}</>;
      }
    `);
    expect(graph.layoutContext.controls).toHaveLength(2);
    const [ready, roomy] = graph.layoutContext.controls;
    expect(ready).toMatchObject({ type: "conditional", label: "ready" });
    expect(roomy).toMatchObject({
      type: "branch",
      label: "roomy",
      polarityPair: true,
      dependsOn: [[{ controlId: ready.controlId, value: "on" }]],
      cases: [
        { caseId: "roomy", label: "roomy" },
        { caseId: "!roomy", label: "!roomy" },
      ],
    });
    expect(edgeTo(graph, "Wide")).toMatchObject({
      activeWhen: [
        [
          { controlId: ready.controlId, value: "on" },
          { controlId: roomy.controlId, value: "roomy" },
        ],
      ],
    });
    expect(edgeTo(graph, "Narrow")).toMatchObject({
      activeWhen: [
        [
          { controlId: ready.controlId, value: "on" },
          { controlId: roomy.controlId, value: "!roomy" },
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
    const [roomy] = graph.layoutContext.controls;
    expect(graph.layoutContext.controls).toHaveLength(1);
    expect(roomy).toMatchObject({
      type: "branch",
      label: "roomy",
      polarityPair: true,
      cases: [
        { caseId: "roomy", label: "roomy" },
        { caseId: "!roomy", label: "!roomy" },
      ],
    });
    expect(edgeTo(graph, "Wide")).toMatchObject({ activeWhen: [[{ controlId: roomy.controlId, value: "roomy" }]] });
    expect(edgeTo(graph, "Narrow")).toMatchObject({ activeWhen: [[{ controlId: roomy.controlId, value: "!roomy" }]] });
  });

  it.each(["{count > 0 && <Filled />}{count <= 0 && <Empty />}", "{count <= 0 && <Empty />}{count > 0 && <Filled />}"])(
    "pairs comparison gates through operator inversion: %s",
    async (body) => {
      const graph = await graphFor(`
      function Empty() { return <span />; }
      function Filled() { return <aside />; }
      export function App({ count }) { return <>${body}</>; }
    `);
      const [count] = graph.layoutContext.controls;
      expect(graph.layoutContext.controls).toHaveLength(1);
      expect(count).toMatchObject({
        type: "branch",
        label: "count > 0",
        // One predicate and its complement over the same threshold — a
        // two-value subject, so it renders as a switch like any boolean gate.
        polarityPair: true,
        cases: [
          { caseId: "count > 0", label: "count > 0" },
          { caseId: "count <= 0", label: "count <= 0" },
        ],
      });
      expect(edgeTo(graph, "Filled")).toMatchObject({
        activeWhen: [[{ controlId: count.controlId, value: "count > 0" }]],
      });
      expect(edgeTo(graph, "Empty")).toMatchObject({
        activeWhen: [[{ controlId: count.controlId, value: "count <= 0" }]],
      });
    },
  );

  it("enumerates equality gates over one subject as branch cases", async () => {
    const graph = await graphFor(`
      function Dark() { return <span />; }
      function Light() { return <aside />; }
      export function App({ tone }) { return <>{tone === "dark" && <Dark />}{tone === "light" && <Light />}</>; }
    `);
    const [tone] = graph.layoutContext.controls;
    expect(graph.layoutContext.controls).toHaveLength(1);
    expect(tone).toMatchObject({
      type: "branch",
      label: "tone",
      cases: [
        { caseId: '"dark"', label: '"dark"' },
        { caseId: '"light"', label: '"light"' },
      ],
    });
    expect(edgeTo(graph, "Dark")).toMatchObject({
      activeWhen: [[{ controlId: tone.controlId, value: '"dark"' }]],
    });
    expect(edgeTo(graph, "Light")).toMatchObject({
      activeWhen: [[{ controlId: tone.controlId, value: '"light"' }]],
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
    const controls = graph.layoutContext.controls;
    const first = controls.find(({ label }) => label === "first")!;
    const second = controls.find(({ label }) => label === "second")!;
    expect(controls).toHaveLength(2);
    expect(first).toMatchObject({ type: "conditional" });
    expect(second).toMatchObject({ type: "conditional" });
    expect(edgeTo(graph, "Leaf")).toMatchObject({
      activeWhen: [
        [
          { controlId: first.controlId, value: "on" },
          { controlId: second.controlId, value: "on" },
        ],
      ],
    });
    expect(edgeTo(graph, "Other")).toMatchObject({
      activeWhen: [[{ controlId: first.controlId, value: "off" }], [{ controlId: second.controlId, value: "off" }]],
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
    const controls = graph.layoutContext.controls;
    const first = controls.find(({ label }) => label === "first")!;
    const second = controls.find(({ label }) => label === "second")!;
    expect(controls).toHaveLength(2);
    expect(edgeTo(graph, "Leaf")).toMatchObject({
      activeWhen: [[{ controlId: first.controlId, value: "on" }], [{ controlId: second.controlId, value: "on" }]],
    });
    expect(edgeTo(graph, "Other")).toMatchObject({
      activeWhen: [
        [
          { controlId: first.controlId, value: "off" },
          { controlId: second.controlId, value: "off" },
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
    const controls = graph.layoutContext.controls;
    expect(controls.map(({ label }) => label).toSorted()).toEqual(["first", "second", "third"]);
    const [first, second, third] = controls;
    expect(edgeTo(graph, "Leaf")).toMatchObject({
      activeWhen: [
        [
          { controlId: first!.controlId, value: "on" },
          { controlId: second!.controlId, value: "on" },
        ],
        [
          { controlId: first!.controlId, value: "on" },
          { controlId: third!.controlId, value: "on" },
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
    const [tone] = graph.layoutContext.controls;
    expect(graph.layoutContext.controls).toHaveLength(1);
    expect(tone).toMatchObject({
      type: "branch",
      cases: [
        // Quote style normalizes, so `'dark'` and `"dark"` still share a case.
        { caseId: '"dark"', label: '"dark"' },
        { caseId: "otherwise", label: "otherwise" },
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
    const [status] = graph.layoutContext.controls;
    expect(graph.layoutContext.controls).toHaveLength(1);
    expect(status).toMatchObject({
      type: "branch",
      label: "state.status",
      cases: [
        { caseId: '"loading"', label: '"loading"' },
        { caseId: '"error"', label: '"error"' },
        { caseId: "otherwise", label: "otherwise" },
      ],
    });
    // The failure route's inherited "not loading" drops as implied by "error",
    // and the fall-through route converges on the remainder case.
    expect(edgeTo(graph, "Loading")).toMatchObject({
      activeWhen: [[{ controlId: status.controlId, value: '"loading"' }]],
    });
    expect(edgeTo(graph, "Failure")).toMatchObject({
      activeWhen: [[{ controlId: status.controlId, value: '"error"' }]],
    });
    expect(edgeTo(graph, "Content")).toMatchObject({
      activeWhen: [[{ controlId: status.controlId, value: "otherwise" }]],
    });
  });

  it("keeps the decision chain in source order when the remainder feeds another gate", async () => {
    const graph = await graphFor(`
      function First() { return <span />; }
      function Second() { return <aside />; }
      export function App({ status, catalog }) {
        if (status === "loading") return <main>Loading</main>;
        if (status === "error") return <main>Error</main>;
        if (!catalog) return <First />;
        return <Second />;
      }
    `);
    const status = graph.layoutContext.controls.find((control) => control.label === "status")!;
    const catalog = graph.layoutContext.controls.find((control) => control.label === "catalog")!;
    const projected = projectDecisionNodes(graph);

    // The catalog gate sits after the status gates in source, so its decision
    // node hangs off the status remainder arm — never the other way around,
    // which stranded the graph whenever status left the remainder case.
    const intoCatalog = projected.edges.find(
      (edge) => edge.target === catalog.controlId && edge.source !== catalog.controlId,
    )!;
    expect(intoCatalog.source).toBe(status.controlId);
    expect(intoCatalog.sourcePort).toBe("otherwise");
    expect(intoCatalog.activeWhen).toEqual([[{ controlId: status.controlId, value: "otherwise" }]]);

    // One remainder arm reaches the catalog decision; the instance split rides
    // the catalog's own arms instead of duplicating the remainder label.
    const remainderArms = projected.edges.filter(
      (edge) => edge.source === status.controlId && edge.sourcePort === "otherwise",
    );
    expect(remainderArms).toHaveLength(1);
    const firstEdge = projected.edges.find(
      (edge) => edge.source === catalog.controlId && edge.target === edgeTo(graph, "First").targetNodeId,
    )!;
    expect(firstEdge).toMatchObject({
      sourcePort: "true",
      activeWhen: [
        [
          { controlId: status.controlId, value: "otherwise" },
          { controlId: catalog.controlId, value: "true" },
        ],
      ],
    });
    expect(projected.edges.find((edge) => edge.target === edgeTo(graph, "Second").targetNodeId)).toMatchObject({
      source: catalog.controlId,
    });
  });

  it.each([
    { condition: "!catalog", onLabel: "catalog" },
    { condition: "!(catalog)", onLabel: "(catalog)" },
  ])("leads $condition with its positive case without renaming its source values", async ({ condition, onLabel }) => {
    const graph = await graphFor(`
      function First() { return <span />; }
      function Second() { return <aside />; }
      export function App({ catalog }) {
        if (${condition}) return <First />;
        return <Second />;
      }
    `);
    const catalog = graph.layoutContext.controls.find((control) => control.label === "catalog")!;
    // The switch's on slot is the case the field label names, even though the
    // gate is written negated; ids stay semantic ("true" = the gate as written).
    expect(catalog).toMatchObject({
      type: "branch",
      label: "catalog",
      polarityPair: true,
      cases: [
        { caseId: "false", label: onLabel },
        { caseId: "true", label: condition },
      ],
    });
    expect(catalog).not.toHaveProperty("dependsOn");
    expect(edgeTo(graph, "First")).toMatchObject({
      activeWhen: [[{ controlId: catalog.controlId, value: "true" }]],
    });
    expect(edgeTo(graph, "Second")).toMatchObject({
      activeWhen: [[{ controlId: catalog.controlId, value: "false" }]],
    });
  });

  it("keeps a reordered native pair separate from a sibling conditional over its subject", async () => {
    const graph = await graphFor(`
      function First() { return <span />; }
      function Second() { return <aside />; }
      function Extra() { return <footer />; }
      export function App({ catalog }) {
        return <>{!catalog ? <First /> : <Second />}{catalog && <Extra />}</>;
      }
    `);
    expect(graph.layoutContext.controls).toHaveLength(2);
    const branch = graph.layoutContext.controls.find((control) => control.type === "branch")!;
    const conditional = graph.layoutContext.controls.find((control) => control.type === "conditional")!;
    expect(branch).toMatchObject({
      label: "catalog",
      cases: [
        { caseId: "false", label: "catalog" },
        { caseId: "true", label: "!catalog" },
      ],
    });
    expect(conditional).toMatchObject({ label: "catalog" });
    expect(edgeActiveWhen(graph, "First")).toEqual([[{ controlId: branch.controlId, value: "true" }]]);
    expect(edgeActiveWhen(graph, "Second")).toEqual([[{ controlId: branch.controlId, value: "false" }]]);
    expect(edgeActiveWhen(graph, "Extra")).toEqual([[{ controlId: conditional.controlId, value: "on" }]]);
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
    const [tone] = graph.layoutContext.controls;
    expect(graph.layoutContext.controls).toHaveLength(1);
    expect(tone).toMatchObject({
      type: "branch",
      label: "tone",
      cases: [
        { caseId: '"dark"', label: '"dark"' },
        { caseId: '"light"', label: '"light"' },
        { caseId: "otherwise", label: "otherwise" },
      ],
    });
    // The expanded rule stays one ruleset on the stored edge, so the contract
    // reads every edge entering Neutral and unions their paths.
    const neutral = graph.nodes.find((node) => node.type === "default" && node.title === "Neutral")!;
    const neutralPaths = new Set(
      graph.edges.flatMap((edge) =>
        edge.targetNodeId === neutral.nodeId ? (edge.type === "control" ? edge.activeWhen : [[]]) : [],
      ),
    );
    expect(neutralPaths).toEqual(
      new Set([[{ controlId: tone.controlId, value: '"light"' }], [{ controlId: tone.controlId, value: "otherwise" }]]),
    );
    expect(edgeTo(graph, "Dark")).toMatchObject({
      activeWhen: [[{ controlId: tone.controlId, value: '"dark"' }]],
    });
    expect(edgeTo(graph, "Light")).toMatchObject({
      activeWhen: [[{ controlId: tone.controlId, value: '"light"' }]],
    });
  });

  it("folds repeated single-polarity gates into one conditional", async () => {
    const graph = await graphFor(`
      function First() { return <span />; }
      function Second() { return <aside />; }
      export function App({ flag }) { return <>{flag && <First />}{flag && <Second />}</>; }
    `);
    const [flag] = graph.layoutContext.controls;
    expect(graph.layoutContext.controls).toHaveLength(1);
    expect(flag).toMatchObject({ type: "conditional", label: "flag" });
    expect(edgeTo(graph, "First")).toMatchObject({ activeWhen: [[{ controlId: flag.controlId, value: "on" }]] });
    expect(edgeTo(graph, "Second")).toMatchObject({ activeWhen: [[{ controlId: flag.controlId, value: "on" }]] });
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
    const leafEdges = graph.edges.filter(({ targetNodeId }) => targetNodeId === leaf.nodeId);
    expect(leafEdges).toHaveLength(2);
    expect(leafEdges.map(({ layoutContext }) => layoutContext?.composition)).toEqual(
      expect.arrayContaining([
        {
          type: "node",
          slot: "children",
          origins: expect.arrayContaining([
            { supplierDefinitionId: "component:app.tsx#App", slot: "header" },
            { supplierDefinitionId: "component:app.tsx#App", slot: "footer" },
          ]),
        },
        {
          type: "node",
          slot: "children",
          origins: [{ supplierDefinitionId: "component:app.tsx#Other", slot: "header" }],
        },
      ]),
    );
    expect(leafEdges.flatMap(({ layoutContext }) => layoutContext!.composition!.origins)).toHaveLength(3);
    expect(leaf.type === "default" && leaf.layoutContext!.origins).toHaveLength(3);
    expect(leaf.type === "default" && leaf.layoutContext!.origins).toEqual(
      expect.arrayContaining([
        { supplierDefinitionId: "component:app.tsx#App", slot: "header" },
        { supplierDefinitionId: "component:app.tsx#App", slot: "footer" },
        { supplierDefinitionId: "component:app.tsx#Other", slot: "header" },
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
    expect(graph.layoutContext.controls).toMatchObject([{ ownerNodeId: branch.nodeId, label: "show", type: "branch" }]);
    const leaf = graph.nodes.find(({ title }) => title === "Leaf")!;
    expect(leaf.type === "default" && leaf.layoutContext!.origins).toEqual(
      expect.arrayContaining([
        { supplierDefinitionId: "component:app.tsx#First", slot: "children" },
        { supplierDefinitionId: "component:app.tsx#First", slot: "panel" },
        { supplierDefinitionId: "component:app.tsx#Second", slot: "children" },
      ]),
    );
    expect(leaf.type === "default" && leaf.layoutContext!.origins).toHaveLength(3);
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
    const [visible] = graph.layoutContext.controls;
    expect(graph.layoutContext.rootNodeIds).toEqual([shell.nodeId]);
    expect(graph.layoutContext.controls).toMatchObject([{ ownerNodeId: shell.nodeId, label: "visible" }]);
    expect(edgeTo(graph, "Leaf")).toMatchObject({
      activeWhen: [[{ controlId: visible!.controlId, value: "on" }]],
      layoutContext: {
        composition: {
          type: "node",
          slot: "children",
          origins: [{ supplierDefinitionId: "component:app.tsx#App", slot: "children" }],
        },
      },
    });
    expect(graph.nodes.some(({ nodeId }) => nodeId === "component:app.tsx#App")).toBe(false);
    expect(graph.nodes.find(({ title }) => title === "Leaf")).toMatchObject({
      layoutContext: {
        origins: [{ supplierDefinitionId: "component:app.tsx#App", slot: "children" }],
      },
    });
    // The dropped supplier stays nameable through the auxiliary registry.
    expect(graph.layoutContext.auxiliaryDefinitions).toEqual([{ definitionId: "component:app.tsx#App", title: "App" }]);
    const unfocused = await graphFor(`
      function Leaf() { return <span />; }
      function Shell({ children, visible }) { return <>{visible && children}</>; }
      export function App({ ready }) { return <Shell>{ready && <Leaf />}</Shell>; }
    `);
    expect(Object.hasOwn(unfocused.layoutContext, "auxiliaryDefinitions")).toBe(false);
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
    const [enabled] = graph.layoutContext.controls;
    expect(graph.layoutContext.rootNodeIds).toEqual([first.nodeId]);
    expect(enabled).toMatchObject({ ownerNodeId: first.nodeId, label: "enabled" });
    expect(edgeTo(graph, "B")).toMatchObject({
      sourceNodeId: first.nodeId,
      activeWhen: [[{ controlId: enabled!.controlId, value: "on" }]],
    });
    expect(edgeTo(graph, "A")).toMatchObject({ sourceNodeId: second.nodeId, type: "default" });
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
    expect(graph.layoutContext.rootNodeIds).toEqual([recursive.nodeId]);
    expect(graph.layoutContext.controls).toMatchObject([{ ownerNodeId: recursive.nodeId, label: "more" }]);
    const cycle = graph.edges.find(
      ({ sourceNodeId, targetNodeId }) => sourceNodeId === recursive.nodeId && targetNodeId === recursive.nodeId,
    )!;
    expect(cycle).toMatchObject({
      activeWhen: [[{ controlId: graph.layoutContext.controls.at(0)!.controlId, value: "on" }]],
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
    const controls = graph.layoutContext.controls;
    expect(controls.map(({ label }) => label)).toEqual(["enabled", "ready", "visible"]);
    const app = graph.nodes.find(({ title }) => title === "App")!;
    expect(controls.every(({ ownerNodeId }) => ownerNodeId === app.nodeId)).toBe(true);
    expect(controls.at(1)!.dependsOn).toEqual([[{ controlId: controls.at(0)!.controlId, value: "on" }]]);
    expect(controls.at(2)!.dependsOn).toEqual([
      [
        { controlId: controls.at(0)!.controlId, value: "on" },
        { controlId: controls.at(1)!.controlId, value: "on" },
      ],
    ]);
    expect(edgeTo(graph, "Leaf")).toMatchObject({
      activeWhen: [
        [
          { controlId: controls.at(0)!.controlId, value: "on" },
          { controlId: controls.at(1)!.controlId, value: "on" },
          { controlId: controls.at(2)!.controlId, value: "on" },
        ],
      ],
    });
  });

  it.each([
    ["<Child />", "default"],
    ["ready && <Child />", "control"],
  ])("omits default composition for %s", async (expression, type) => {
    const graph = await graphFor(`
      function Child() { return <span />; }
      export function App({ ready }) { return ${expression}; }
    `);
    const edge = edgeTo(graph, "Child");
    expect(edge.type).toBe(type);
    expect(edge).not.toHaveProperty("layoutContext");
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
    const controls = graph.layoutContext.controls;
    // The four `ready` gates and four `show` gates each fold into one control:
    // one owner, one operand, one switch over it.
    expect(controls).toHaveLength(2);
    const nodes = new Map(graph.nodes.map((node) => [node.nodeId, node]));
    for (const [title, slot, compositionType] of [
      ["Child", "children", "node"],
      ["Panel", "panel", "node"],
      ["Rendered", "render", "render"],
      ["Widget", "component", "component"],
    ]) {
      const edge = edgeTo(graph, title!);
      expect(edge.type).toBe("control");
      expect(edge.layoutContext).toEqual({
        composition: {
          type: compositionType,
          slot,
          origins: [{ supplierDefinitionId: "component:app.tsx#App", slot }],
        },
      });
      const target = nodes.get(edge.targetNodeId)!;
      expect(target.type === "default" && target.layoutContext!.origins).toContainEqual(
        expect.objectContaining({ slot }),
      );
      const ruleset = edge.type === "control" ? edge.activeWhen : [[]];
      expect(ruleset).toHaveLength(1);
      const path = ruleset.at(0)!;
      expect(path).toHaveLength(2);
      expect(path.map(({ controlId }) => controls.find(({ controlId: id }) => id === controlId)?.label)).toEqual([
        "ready",
        "show",
      ]);
      expect(
        path.map(
          ({ controlId }) => nodes.get(controls.find(({ controlId: id }) => id === controlId)!.ownerNodeId)?.title,
        ),
      ).toEqual(["App", "Consumer"]);
      expect(nodes.get(edge.targetNodeId)).toMatchObject({
        layoutContext: { origins: [{ supplierDefinitionId: "component:app.tsx#App", slot }] },
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
    const [mode, stop] = graph.layoutContext.controls;
    expect(stop).toMatchObject({
      type: "branch",
      label: "stop",
      dependsOn: [[{ controlId: mode!.controlId, value: "case:0" }]],
    });
    expect(edgeTo(graph, "First")).toMatchObject({
      activeWhen: [
        [
          { controlId: mode!.controlId, value: "case:0" },
          { controlId: stop!.controlId, value: "false" },
        ],
      ],
    });
    expect(edgeTo(graph, "After")).toMatchObject({
      activeWhen: [
        [
          { controlId: mode!.controlId, value: "case:0" },
          { controlId: stop!.controlId, value: "true" },
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
    const controls = graph.layoutContext.controls;
    expect(controls.map(({ label }) => label)).toEqual(["!hidden", "mode", "ready"]);
    const [visible, mode, ready] = controls;
    expect(visible).toMatchObject({ type: "conditional" });
    expect(mode).toMatchObject({
      type: "branch",
      dependsOn: [[{ controlId: visible!.controlId, value: "on" }]],
      cases: [
        { caseId: "case:0", label: '"first"' },
        { caseId: "case:1", label: '"alias"' },
        { caseId: "case:2", label: "default" },
      ],
    });
    expect(ready).toMatchObject({
      type: "branch",
      dependsOn: [
        [
          { controlId: visible!.controlId, value: "on" },
          { controlId: mode!.controlId, value: "case:0" },
        ],
        [
          { controlId: visible!.controlId, value: "on" },
          { controlId: mode!.controlId, value: "case:1" },
        ],
      ],
    });
    expect(edgeTo(graph, "First")).toMatchObject({
      activeWhen: [
        [
          { controlId: visible!.controlId, value: "on" },
          { controlId: mode!.controlId, value: "case:0" },
          { controlId: ready!.controlId, value: "true" },
        ],
        [
          { controlId: visible!.controlId, value: "on" },
          { controlId: mode!.controlId, value: "case:1" },
          { controlId: ready!.controlId, value: "true" },
        ],
      ],
    });
    expect(edgeTo(graph, "Other")).toMatchObject({
      activeWhen: [
        [
          { controlId: visible!.controlId, value: "on" },
          { controlId: mode!.controlId, value: "case:2" },
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
    const visible = graph.layoutContext.controls.find(({ label }) => label === "visible")!;
    const wrapper = graph.nodes.find(({ title }) => title === "Wrapper")!;
    expect(edgeTo(graph, "Leaf")).toMatchObject({
      sourceNodeId: wrapper.nodeId,
      activeWhen: [[{ controlId: visible.controlId, value: "on" }]],
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
    const controls = graph.layoutContext.controls;
    const content = controls.find(({ label }) => label === "content")!;
    const ready = controls.find(({ label }) => label === "ready")!;
    expect(content).toMatchObject({ type: "branch" });
    expect(ready).toMatchObject({
      type: "conditional",
      dependsOn: [[{ controlId: content.controlId, value: "left" }]],
    });
    expect(edgeTo(graph, "Leaf")).toMatchObject({
      activeWhen: [
        [
          { controlId: content.controlId, value: "left" },
          { controlId: ready.controlId, value: "on" },
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
    const control = graph.layoutContext.controls.at(0)!;
    expect(control).toMatchObject({ label: "First", type: "branch" });
    expect(edgeTo(graph, "First")).toMatchObject({
      activeWhen: [[{ controlId: control.controlId, value: "left" }]],
    });
    expect(edgeTo(graph, "Second")).toMatchObject({
      activeWhen: [[{ controlId: control.controlId, value: "right" }]],
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
    const controls = graph.layoutContext.controls;
    const children = controls.find(({ label }) => label === "children")!;
    expect(children).toMatchObject({
      type: "branch",
      cases: [
        { caseId: "left", label: "children" },
        { caseId: "right", label: "children == null" },
      ],
    });
    expect(edgeTo(graph, "Child")).toMatchObject({
      activeWhen: [[{ controlId: children.controlId, value: "left" }]],
    });
    expect(edgeTo(graph, "Fallback")).toMatchObject({
      activeWhen: [[{ controlId: children.controlId, value: "right" }]],
    });
    const choice = controls.find(({ label }) => label === "choice")!;
    expect(choice).toMatchObject({ type: "branch" });
    expect(edgeTo(graph, "First")).toMatchObject({
      activeWhen: [[{ controlId: choice.controlId, value: "true" }]],
    });
    expect(edgeTo(graph, "Second")).toMatchObject({
      activeWhen: [[{ controlId: choice.controlId, value: "false" }]],
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
    const controls = graph.layoutContext.controls;
    const branch = controls.find((control) => control.type === "branch")!;
    expect(branch).toMatchObject({
      type: "branch",
      label: "preferred",
      cases: [
        { caseId: "left", label: "preferred" },
        { caseId: "right", label: "!preferred" },
      ],
    });
    // The decision is the left operand's truthiness, so it is a switch even
    // though the arms render value alternatives.
    expect(branch.polarityPair).toBe(true);
    expect(edgeTo(graph, "Preferred")).toMatchObject({
      activeWhen: [[{ controlId: branch.controlId, value: "left" }]],
    });
    expect(edgeTo(graph, "Fallback")).toMatchObject({
      activeWhen: [[{ controlId: branch.controlId, value: "right" }]],
    });
    const nullish = controls.find((control) => control.label === "value == null")!;
    expect(nullish).toMatchObject({ type: "conditional" });
    expect(edgeTo(graph, "Empty")).toMatchObject({ activeWhen: [[{ controlId: nullish.controlId, value: "on" }]] });
  });

  it("emits a condition only for conditional JSX, not repeated simultaneous uses", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      function Extra() { return <aside />; }
      export function App({ ready }) { return <><Leaf /><Leaf />{ready && <Extra />}</>; }
    `);
    const app = graph.nodes.find((node) => node.title === "App")!;
    expect({ rootNodeIds: graph.layoutContext.rootNodeIds, controls: graph.layoutContext.controls }).toEqual({
      rootNodeIds: [app.nodeId],
      controls: [
        {
          controlId: expect.any(String),
          ownerNodeId: app.nodeId,
          label: "ready",
          type: "conditional",
        },
      ],
    });
    const control = graph.layoutContext.controls.at(0)!;
    expect(edgeTo(graph, "Leaf")).toMatchObject({ type: "default" });
    expect(edgeTo(graph, "Extra")).toMatchObject({ activeWhen: [[{ controlId: control.controlId, value: "on" }]] });
    expect(app).toMatchObject({ layoutContext: { definitionId: "component:app.tsx#App", origins: [] } });
  });
});
