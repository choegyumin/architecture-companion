import {
  clearEdgeHover,
  defaultEdgeHoverHighlight,
  reportEdgeHover,
  resetEdgeHover,
  subscribeEdgeHover,
} from "@/shared/react-flow/edge-highlight";

describe("edge hover channel", () => {
  afterEach(() => resetEdgeHover());

  it("notifies subscribers of reports and clears", () => {
    const seen: (string | null)[] = [];
    const unsubscribe = subscribeEdgeHover((origin) => seen.push(origin?.kind ?? null));
    expect(seen).toEqual([null]);

    reportEdgeHover({ kind: "label", edgeId: "edge:1" });
    reportEdgeHover({ kind: "node", nodeId: "node:1" });
    clearEdgeHover({ kind: "node", nodeId: "node:1" });

    unsubscribe();
    reportEdgeHover({ kind: "edge", edgeId: "edge:2" });

    expect(seen).toEqual([null, "label", "node", null]);
  });

  it("clears only the origin still held, so a later hover wins", () => {
    const seen: (string | null)[] = [];
    subscribeEdgeHover((origin) => seen.push(origin?.kind ?? null));

    reportEdgeHover({ kind: "label", edgeId: "edge:1" });
    reportEdgeHover({ kind: "label", edgeId: "edge:2" });
    clearEdgeHover({ kind: "label", edgeId: "edge:1" });

    expect(seen.at(-1)).toBe("label");
  });

  it("highlights the hovered route for edges and labels, nothing for nodes", () => {
    expect(defaultEdgeHoverHighlight({ kind: "edge", edgeId: "edge:1" })).toEqual(new Set(["edge:1"]));
    expect(defaultEdgeHoverHighlight({ kind: "label", edgeId: "edge:1" })).toEqual(new Set(["edge:1"]));
    expect(defaultEdgeHoverHighlight({ kind: "node", nodeId: "node:1" }).size).toBe(0);
  });
});
