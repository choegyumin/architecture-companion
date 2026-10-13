import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { projectDecisionNodes } from "@/client/widgets/component-structure-diagram-renderer";
import type { ProjectedComponentStructureGraph } from "@/client/widgets/component-structure-diagram-renderer.layout";
import { componentStructureDiagramGraphSchema } from "@/features/diagram/diagram-graph";
import { buildComponentGraph } from "@/plugins/artifact-generators/react-component-structure/analysis/build-component-graph";

async function graphFor(source: string): Promise<ProjectedComponentStructureGraph> {
  const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-component-decisions-"));
  try {
    await mkdir(join(scopePath, "node_modules"));
    await symlink(
      dirname(dirname(createRequire(import.meta.url).resolve("typescript"))),
      join(scopePath, "node_modules/typescript"),
      "junction",
    );
    await writeFile(join(scopePath, "app.tsx"), source);
    const graph = await buildComponentGraph({ scopePath, sourcePaths: ["app.tsx"], rootPatterns: ["App"] });
    componentStructureDiagramGraphSchema.parse(JSON.parse(JSON.stringify(graph)));
    return projectDecisionNodes(graph);
  } finally {
    await rm(scopePath, { recursive: true, force: true });
  }
}

function branchArm(graph: ProjectedComponentStructureGraph, controlLabel: string, port: string) {
  const control = graph.controls.find(({ label }) => label === controlLabel)!;
  return graph.edges.find((edge) => edge.source === control.controlId && edge.sourcePort === port)!;
}

describe("decision node projection", () => {
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
    const choice = graph.controls.find(({ label }) => label === "choice")!;
    const target = graph.nodes.find((node) => node.type === "default" && node.title === "Leaf")!;
    if (target.type !== "default") throw new Error("Missing Leaf component");
    // Both stored cases survive as separate decision arms after projection.
    const arms = graph.edges
      .filter((edge) => edge.source === choice.controlId && edge.target === target.nodeId)
      .toSorted((left, right) => (left.sourcePort ?? "").localeCompare(right.sourcePort ?? ""));
    expect(arms.map((arm) => ({ port: arm.sourcePort, activeWhen: arm.activeWhen }))).toEqual([
      { port: "false", activeWhen: [[{ controlId: choice.controlId, value: "false" }]] },
      { port: "true", activeWhen: [[{ controlId: choice.controlId, value: "true" }]] },
    ]);
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
    const status = graph.controls.find((control) => control.label === "status")!;
    const catalog = graph.controls.find((control) => control.label === "catalog")!;
    const first = graph.nodes.find((node) => node.type === "default" && node.title === "First")!;
    const second = graph.nodes.find((node) => node.type === "default" && node.title === "Second")!;
    if (first.type !== "default" || second.type !== "default") throw new Error("Missing branch components");

    // The catalog gate sits after the status gates in source, so its decision
    // node hangs off the status remainder arm — never the other way around,
    // which stranded the graph whenever status left the remainder case.
    const intoCatalog = graph.edges.find(
      (edge) => edge.target === catalog.controlId && edge.source !== catalog.controlId,
    )!;
    expect(intoCatalog.source).toBe(status.controlId);
    expect(intoCatalog.sourcePort).toBe("otherwise");
    expect(intoCatalog.activeWhen).toEqual([[{ controlId: status.controlId, value: "otherwise" }]]);

    // One remainder arm reaches the catalog decision; the instance split rides
    // the catalog's own arms instead of duplicating the remainder label.
    const remainderArms = graph.edges.filter(
      (edge) => edge.source === status.controlId && edge.sourcePort === "otherwise",
    );
    expect(remainderArms).toHaveLength(1);
    const firstEdge = graph.edges.find((edge) => edge.source === catalog.controlId && edge.target === first.nodeId)!;
    expect(firstEdge).toMatchObject({
      sourcePort: "true",
      activeWhen: [
        [
          { controlId: status.controlId, value: "otherwise" },
          { controlId: catalog.controlId, value: "true" },
        ],
      ],
    });
    expect(graph.edges.find((edge) => edge.target === second.nodeId)).toMatchObject({
      source: catalog.controlId,
    });
  });

  it("projects one diamond per branch control with an owner entry edge", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      function Other() { return <aside />; }
      export function App({ choice }) { return choice ? <Leaf /> : <Other />; }
    `);
    const control = graph.controls.find(({ label }) => label === "choice")!;
    const decision = graph.nodes.find((node) => node.type === "decision")!;
    expect(decision).toMatchObject({ id: control.controlId, title: "choice" });
    expect(graph.nodes.filter((node) => node.type === "decision")).toHaveLength(1);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: "component:app.tsx#App", target: control.controlId }),
    );
    expect(branchArm(graph, "choice", "true")).toMatchObject({
      target: "component:app.tsx#Leaf",
      activeWhen: [[{ controlId: control.controlId, value: "true" }]],
      guards: [[{ controlId: control.controlId, value: "true" }]],
    });
    expect(branchArm(graph, "choice", "false")).toMatchObject({
      target: "component:app.tsx#Other",
    });
  });

  it("chains nested branches so each edge label guards one control only", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      function Other() { return <aside />; }
      export function App({ outer, inner }) {
        if (outer) return inner ? <Leaf /> : <Other />;
        return <Leaf />;
      }
    `);
    const outer = graph.controls.find(({ label }) => label === "outer")!;
    const inner = graph.controls.find(({ label }) => label === "inner")!;
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: outer.controlId,
        target: inner.controlId,
        sourcePort: "true",
        activeWhen: [[{ controlId: outer.controlId, value: "true" }]],
        guards: [[{ controlId: outer.controlId, value: "true" }]],
      }),
    );
    const deepArm = branchArm(graph, "inner", "true");
    expect(deepArm).toMatchObject({
      target: "component:app.tsx#Leaf",
      activeWhen: [
        [
          { controlId: outer.controlId, value: "true" },
          { controlId: inner.controlId, value: "true" },
        ],
      ],
      // The label carries only the control this hop chooses.
      guards: [[{ controlId: inner.controlId, value: "true" }]],
    });
  });

  it("routes dead cases to their own selectable Non-component nodes", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      export function App({ mode }) { switch (mode) { case 0: return <Leaf />; } return null; }
    `);
    const mode = graph.controls.find(({ label }) => label === "mode")!;
    const deadNodeId = `${mode.controlId}:case:1:non-component`;
    expect(graph.nodes.find((node) => node.type !== "default" && node.id === deadNodeId)).toMatchObject({
      title: "Non-component",
    });
    expect(branchArm(graph, "mode", "case:1")).toMatchObject({
      target: deadNodeId,
      guards: [[{ controlId: mode.controlId, value: "case:1" }]],
    });
  });

  it("keeps conditional guards on edge labels without projecting nodes", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      export function App({ ready }) { return <>{ready && <Leaf />}</>; }
    `);
    expect(graph.nodes.filter((node) => node.type === "decision")).toHaveLength(0);
    const ready = graph.controls.find(({ label }) => label === "ready")!;
    const edge = graph.edges.find((edge) => edge.target === "component:app.tsx#Leaf")!;
    expect(edge).toMatchObject({
      activeWhen: [[{ controlId: ready.controlId, value: "on" }]],
      guards: [[{ controlId: ready.controlId, value: "on" }]],
    });
  });
});
