import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { attachGuardLabels } from "@/client/widgets/component-structure-guards";
import {
  componentPathEmphasis,
  type ComponentSelection,
  selectEdgePath,
} from "@/client/widgets/component-structure-path-selection";
import { routeConditionText } from "@/client/widgets/component-structure-route-conditions";
import { projectDecisionNodes } from "@/features/diagram/decision-nodes";
import type { DiagramControl } from "@/features/diagram/diagram-graph";

const conditional = (id: string, label: string): DiagramControl => ({
  controlId: id,
  ownerNodeId: "parent",
  type: "conditional",
  label,
  dependsOn: [[]],
});

describe("component structure route conditions", () => {
  it.each([
    "ready",
    "props.column.editor",
    "!first",
    "!!ready",
    "a || b",
    "!a && b",
    "!(a || b)",
    "x === false",
    "ready ? a : b",
  ])("negates the whole conditional label %s only for off requirements", (label) => {
    const controls = [conditional("gate", label)];

    expect(routeConditionText(controls, [[{ controlId: "gate", value: "on" }]])).toBe(label);
    expect(routeConditionText(controls, [[{ controlId: "gate", value: "off" }]])).toBe(`!(${label})`);
  });

  it("keeps AND rules grouped inside OR alternatives with mixed on and off requirements", () => {
    const controls = [conditional("a", "a"), conditional("b", "b"), conditional("c", "c")];

    expect(
      routeConditionText(controls, [
        [
          { controlId: "a", value: "off" },
          { controlId: "b", value: "off" },
        ],
        [{ controlId: "c", value: "on" }],
      ]),
    ).toBe("(!(a) && !(b)) || c");
  });

  it("uses branch case labels even when their IDs are on and off", () => {
    const controls: DiagramControl[] = [
      {
        controlId: "branch",
        ownerNodeId: "parent",
        type: "branch",
        label: "mode",
        dependsOn: [[]],
        cases: [
          { caseId: "on", label: "preview" },
          { caseId: "off", label: "edit" },
        ],
      },
    ];

    expect(routeConditionText(controls, [[{ controlId: "branch", value: "on" }]])).toBe("preview");
    expect(routeConditionText(controls, [[{ controlId: "branch", value: "off" }]])).toBe("edit");
  });

  it("shows projected off guards in the visible and accessible label without changing route selection", () => {
    // MessageEdge returns early for !data and for !first || !last.
    const graph = projectDecisionNodes({
      groups: [],
      nodes: [
        { type: "default", nodeId: "parent", title: "MessageEdge" },
        { type: "default", nodeId: "child", title: "BaseEdge" },
      ],
      edges: [
        {
          type: "control",
          edgeId: "render",
          sourceNodeId: "parent",
          targetNodeId: "child",
          activeWhen: [
            [
              { controlId: "data", value: "on" },
              { controlId: "first", value: "off" },
              { controlId: "last", value: "off" },
            ],
          ],
        },
      ],
      layoutContext: {
        rootNodeIds: ["parent"],
        controls: [conditional("data", "data"), conditional("first", "!first"), conditional("last", "!last")],
      },
    });
    const edge = graph.edges.at(0)!;
    let selection: ComponentSelection = { data: "off", first: "on", last: "on" };
    const onSelect = vi.fn((edgeId: string, controlId: string, value: string) => {
      selection = selectEdgePath(graph, selection, edgeId, controlId, value);
    });
    const label = () => {
      const [decorated] = attachGuardLabels({
        graph,
        controls: graph.controls,
        layout: {
          nodes: [],
          groups: [],
          edges: [
            {
              id: edge.id,
              points: [
                { x: 0, y: 0 },
                { x: 0, y: 200 },
              ],
            },
          ],
          initialView: { mode: "fit" },
        },
        edges: [
          {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            type: "route",
            data: { path: "M0,0 L0,200", labelPosition: { x: 0, y: 100 } },
          },
        ],
        activeEdges: componentPathEmphasis(graph, selection).edges,
        onSelect,
      });
      if (decorated.type !== "route") throw new Error("Expected a route edge");
      return decorated.data?.labelControls?.at(0)?.control;
    };
    const { rerender } = render(label());
    const text = "data && !(!first) && !(!last)";
    const button = screen.getByRole("button", { name: `Route condition: ${text}` });

    expect(button).toHaveTextContent(text);
    expect(componentPathEmphasis(graph, selection).edges.has(edge.id)).toBe(false);

    fireEvent.click(button);

    expect(onSelect).toHaveBeenLastCalledWith(edge.id, "data", "on");
    expect(selection).toEqual({ data: "on", first: "off", last: "off" });
    expect(componentPathEmphasis(graph, selection).edges.has(edge.id)).toBe(true);
    expect(componentPathEmphasis(graph, selection).nodes.has("child")).toBe(true);

    rerender(label());
    fireEvent.click(screen.getByRole("button", { name: `Route condition: ${text}` }));

    expect(selection).toEqual({ data: "off", first: "on", last: "on" });
    expect(componentPathEmphasis(graph, selection).edges.has(edge.id)).toBe(false);
    expect(componentPathEmphasis(graph, selection).nodes.has("child")).toBe(false);
  });
});
