import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { ProjectedComponentStructureGraph } from "@/features/diagram/decision-nodes";
import { projectDecisionNodes } from "@/features/diagram/decision-nodes";
import { componentStructureDiagramGraphSchema } from "@/features/diagram/diagram-graph";

import { buildComponentGraph } from "./build-component-graph";

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
  return graph.edges.find((edge) => edge.source === control.id && edge.sourcePort === port)!;
}

describe("decision node projection", () => {
  it("projects one diamond per branch control with an owner entry edge", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      function Other() { return <aside />; }
      export function App({ choice }) { return choice ? <Leaf /> : <Other />; }
    `);
    const control = graph.controls.find(({ label }) => label === "choice")!;
    const decision = graph.nodes.find((node) => node.type === "decision")!;
    expect(decision).toMatchObject({ id: control.id, title: "choice" });
    expect(graph.nodes.filter((node) => node.type === "decision")).toHaveLength(1);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: "component:app.tsx#App", target: control.id }),
    );
    expect(branchArm(graph, "choice", "true")).toMatchObject({
      target: "component:app.tsx#Leaf",
      activeWhen: [[{ controlId: control.id, value: "true" }]],
      guards: [[{ controlId: control.id, value: "true" }]],
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
        source: outer.id,
        target: inner.id,
        sourcePort: "true",
        activeWhen: [[{ controlId: outer.id, value: "true" }]],
        guards: [[{ controlId: outer.id, value: "true" }]],
      }),
    );
    const deepArm = branchArm(graph, "inner", "true");
    expect(deepArm).toMatchObject({
      target: "component:app.tsx#Leaf",
      activeWhen: [
        [
          { controlId: outer.id, value: "true" },
          { controlId: inner.id, value: "true" },
        ],
      ],
      // The label carries only the control this hop chooses.
      guards: [[{ controlId: inner.id, value: "true" }]],
    });
  });

  it("routes dead cases to their own selectable Non-component nodes", async () => {
    const graph = await graphFor(`
      function Leaf() { return <span />; }
      export function App({ mode }) { switch (mode) { case 0: return <Leaf />; } return null; }
    `);
    const mode = graph.controls.find(({ label }) => label === "mode")!;
    const deadNodeId = `${mode.id}:case:1:non-component`;
    expect(graph.nodes.find(({ id }) => id === deadNodeId)).toMatchObject({
      title: "Non-component",
    });
    expect(branchArm(graph, "mode", "case:1")).toMatchObject({
      target: deadNodeId,
      guards: [[{ controlId: mode.id, value: "case:1" }]],
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
      activeWhen: [[{ controlId: ready.id, value: "on" }]],
      guards: [[{ controlId: ready.id, value: "on" }]],
    });
  });
});
