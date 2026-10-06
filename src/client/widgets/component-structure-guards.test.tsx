import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const graphEdge = (id: string, source: string, rules: readonly (readonly [string, string][])[]): DiagramEdge => ({
  id,
  type: "default",
  source,
  target: "leaf",
  guards: rules.map((rule) => rule.map(([controlId, value]) => ({ controlId, value }))),
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

const horizontal = [
  { x: 0, y: 0 },
  { x: 300, y: 0 },
];

function renderLabel(edges: readonly DiagramEdge[], overrides: Partial<Parameters<typeof attachGuardLabels>[0]> = {}) {
  const decorated = attachGuardLabels({
    graph: { nodes: [], edges },
    controls,
    layout: layoutOf(Object.fromEntries(edges.map((edge) => [edge.id, horizontal]))),
    edges: edges.map((edge) => routeEdge(edge.id)),
    selection: {},
    onSelect: () => {},
    ...overrides,
  });
  const anchors = decorated.flatMap((edge) => (edge.type === "route" ? (edge.data?.labelControls ?? []) : []));
  for (const anchor of anchors) render(anchor.control as ReactElement);
  return anchors;
}

describe("attachGuardLabels", () => {
  beforeEach(cleanup);

  it("labels a branch arm near its start and other routes near their arrival", () => {
    const [arm, arrival] = renderLabel([
      graphEdge("arm", "mode", [[["mode", "on"]]]),
      graphEdge("arrival", "decision", [[["flag", "on"]]]),
    ]);

    // The arm leaves a decision node, so its label hangs downstream of the
    // start anchor; the plain conditional route climbs back up from the end.
    expect(arm?.position).toEqual({ x: 64, y: 0 });
    expect(arm).toHaveProperty("anchorSide", "top");
    expect(arrival?.position).toEqual({ x: 236, y: 0 });
    expect(arrival).toHaveProperty("anchorSide", "bottom");
  });

  it("combines a whole ruleset into one label with branch and conditional text", () => {
    renderLabel([
      graphEdge("combined", "mode", [
        [
          ["mode", "on"],
          ["flag", "on"],
        ],
        [["mode", "off"]],
      ]),
    ]);

    const label = screen.getByRole("button");
    expect(label).toHaveTextContent("(On && flag) || Off");
    // A rule naming a branch case marks the label with the split icon.
    expect(label.querySelector("svg")).not.toBeNull();
  });

  it("keeps unconditional edges bare", () => {
    const anchors = renderLabel([graphEdge("bare", "decision", [[]])]);
    expect(anchors).toHaveLength(0);
  });

  it("binds the label click to the route's representative requirement", async () => {
    const clicks: [string, string, string][] = [];
    renderLabel([graphEdge("arm", "mode", [[["flag", "on"]]])], {
      onSelect: (edgeId, controlId, value) => clicks.push([edgeId, controlId, value]),
    });

    await userEvent.setup().click(screen.getByRole("button"));
    expect(clicks).toEqual([["arm", "flag", "on"]]);
  });
});
