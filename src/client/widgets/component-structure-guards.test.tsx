import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

import type { DiagramReactFlowEdge } from "@/client/parts/diagram-canvas";
import { attachGuardLabels } from "@/client/widgets/component-structure-guards";
import type { DiagramControl, DiagramEdge } from "@/features/diagram/diagram-graph";
import type { DiagramLayout } from "@/features/diagram/diagram-spatial";

const controls: DiagramControl[] = [
  {
    id: "mode",
    owner: "decision",
    kind: "branch",
    label: "mode",
    dependsOn: [[]],
    cases: [
      { id: "on", label: "On" },
      { id: "off", label: "Off" },
    ],
  },
  { id: "flag", owner: "decision", kind: "conditional", label: "flag", dependsOn: [[]] },
];

const graphEdge = (id: string, guards: [string, string][]): DiagramEdge => ({
  id,
  type: "default",
  source: "decision",
  target: "leaf",
  guards: [guards.map(([controlId, value]) => ({ controlId, value }))],
});

const layoutOf = (pointsByEdge: Record<string, { x: number; y: number }[]>): DiagramLayout => ({
  nodes: [],
  groups: [],
  edges: Object.entries(pointsByEdge).map(([id, points]) => ({ id, points })),
  initialView: { mode: "fit" },
});

const routeEdge = (id: string): DiagramReactFlowEdge => ({
  id,
  source: "decision",
  target: "leaf",
  type: "route",
  data: { path: "M 0 0 L 300 0", labelPosition: { x: 150, y: 0 } },
});

const noEmphasis = { nodes: new Set<string>(), edges: new Set<string>(), controls: new Set<string>() };

function labelControlsOf(...graphEdges: DiagramEdge[]) {
  const edges = attachGuardLabels({
    graph: { nodes: [], edges: graphEdges },
    controls,
    layout: layoutOf(
      Object.fromEntries(
        graphEdges.map((edge) => [
          edge.id,
          [
            { x: 0, y: 0 },
            { x: 300, y: 0 },
          ],
        ]),
      ),
    ),
    edges: graphEdges.map((edge) => routeEdge(edge.id)),
    selection: {},
    emphasis: noEmphasis,
    onSelect: () => {},
  }).flatMap((edge) => (edge.type === "route" ? (edge.data?.labelControls ?? []) : []));
  return edges;
}

describe("attachGuardLabels", () => {
  beforeEach(cleanup);

  it("anchors branch pills at the start and conditional pills at the end of a long edge", () => {
    const anchors = labelControlsOf(
      graphEdge("both", [
        ["mode", "on"],
        ["flag", "on"],
      ]),
    );

    expect(anchors.map(({ position }) => position)).toEqual([
      { x: 64, y: 0 },
      { x: 236, y: 0 },
    ]);
    for (const { control } of anchors) render(control as ReactElement);
    expect(screen.getByRole("button", { name: "On" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "flag" })).toBeInTheDocument();
  });

  it("merges both groups in start-to-end order when the edge is too short to separate them", () => {
    const [merged] = attachGuardLabels({
      graph: {
        nodes: [],
        edges: [
          graphEdge("short", [
            ["mode", "on"],
            ["flag", "on"],
          ]),
        ],
      },
      controls,
      layout: layoutOf({
        short: [
          { x: 0, y: 0 },
          { x: 80, y: 0 },
        ],
      }),
      edges: [routeEdge("short")],
      selection: {},
      emphasis: noEmphasis,
      onSelect: () => {},
    }).flatMap((edge) => (edge.type === "route" ? (edge.data?.labelControls ?? []) : []));

    expect(merged?.position).toEqual({ x: 40, y: 0 });
    render(merged?.control as ReactElement);
    // The branch pill leads the merged row; the conditional pill follows.
    expect(
      screen.getByRole("button", { name: "On" }).compareDocumentPosition(screen.getByRole("button", { name: "flag" })),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("keeps a lone branch group at the start anchor", () => {
    const [only] = labelControlsOf(graphEdge("arm", [["mode", "on"]]));

    expect(only?.position).toEqual({ x: 64, y: 0 });
    render(only?.control as ReactElement);
    expect(screen.getByRole("button", { name: "On" })).toBeInTheDocument();
  });

  it("keeps a lone conditional group at the end anchor", () => {
    const [only] = labelControlsOf(graphEdge("conditional", [["flag", "on"]]));

    expect(only?.position).toEqual({ x: 236, y: 0 });
    render(only?.control as ReactElement);
    expect(screen.getByRole("button", { name: "flag" })).toBeInTheDocument();
  });

  it("pushes a pill group off a node card from the layout", () => {
    const [only] = attachGuardLabels({
      graph: { nodes: [], edges: [graphEdge("arm", [["mode", "on"]])] },
      controls,
      layout: {
        nodes: [{ id: "card", position: { x: 70, y: -20 }, size: { width: 40, height: 40 } }],
        groups: [],
        edges: [
          {
            id: "arm",
            points: [
              { x: 0, y: 0 },
              { x: 300, y: 0 },
            ],
          },
        ],
        initialView: { mode: "fit" },
      },
      edges: [routeEdge("arm")],
      selection: {},
      emphasis: noEmphasis,
      onSelect: () => {},
    }).flatMap((edge) => (edge.type === "route" ? (edge.data?.labelControls ?? []) : []));

    expect(only?.position).toEqual({ x: 160, y: 0 });
  });
});
