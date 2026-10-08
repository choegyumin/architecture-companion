import {
  clearEdgeHighlight,
  defaultEdgeHighlight,
  reportEdgeHighlight,
  resetEdgeHighlight,
  subscribeEdgeHighlight,
} from "@/shared/react-flow/edge-highlight";

describe("edge highlight channel", () => {
  afterEach(() => resetEdgeHighlight());

  it("notifies subscribers of reports and clears", () => {
    const seen: (string | null)[] = [];
    const unsubscribe = subscribeEdgeHighlight((origin) => seen.push(origin?.kind ?? null));
    expect(seen).toEqual([null]);

    reportEdgeHighlight({ kind: "label", edgeId: "edge:1" });
    reportEdgeHighlight({ kind: "node", nodeId: "node:1" });
    clearEdgeHighlight({ kind: "node", nodeId: "node:1" });

    unsubscribe();
    reportEdgeHighlight({ kind: "edge", edgeId: "edge:2" });

    expect(seen).toEqual([null, "label", "node", null]);
  });

  it("clears only the origin still held, so a later highlight wins", () => {
    const seen: (string | null)[] = [];
    subscribeEdgeHighlight((origin) => seen.push(origin?.kind ?? null));

    reportEdgeHighlight({ kind: "label", edgeId: "edge:1" });
    reportEdgeHighlight({ kind: "label", edgeId: "edge:2" });
    clearEdgeHighlight({ kind: "label", edgeId: "edge:1" });

    expect(seen.at(-1)).toBe("label");
  });

  it("highlights the origin's own route for edges and labels, nothing for nodes", () => {
    expect(defaultEdgeHighlight({ kind: "edge", edgeId: "edge:1" })).toEqual(new Set(["edge:1"]));
    expect(defaultEdgeHighlight({ kind: "label", edgeId: "edge:1" })).toEqual(new Set(["edge:1"]));
    expect(defaultEdgeHighlight({ kind: "node", nodeId: "node:1" }).size).toBe(0);
  });
});
