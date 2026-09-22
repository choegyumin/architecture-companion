import {
  routeGroupFocusedDependencyEdges,
  routeNodeFocusedDependencyEdges,
} from "@/features/diagram/_layout/group-focused-dependency-edge-routing.prototype";

function expectOrthogonal(points: readonly Readonly<{ x: number; y: number }>[]): void {
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    expect(previous?.x === point?.x || previous?.y === point?.y).toBe(true);
  }
}

describe("group-focused dependency edge routing prototype", () => {
  it("keeps an original edge in its lowest common group and avoids unrelated child groups", () => {
    const groups = [
      { id: "root", position: { x: 0, y: 0 }, size: { width: 1_000, height: 700 } },
      {
        id: "source-group",
        parentId: "root",
        position: { x: 20, y: 100 },
        size: { width: 300, height: 250 },
      },
      {
        id: "blocker",
        parentId: "root",
        position: { x: 350, y: 100 },
        size: { width: 300, height: 250 },
      },
      {
        id: "target-group",
        parentId: "root",
        position: { x: 680, y: 100 },
        size: { width: 300, height: 250 },
      },
    ];
    const nodes = [
      {
        id: "source",
        groupId: "source-group",
        position: { x: 60, y: 180 },
        size: { width: 100, height: 60 },
      },
      {
        id: "target",
        groupId: "target-group",
        position: { x: 740, y: 180 },
        size: { width: 100, height: 60 },
      },
    ];

    const routes = routeGroupFocusedDependencyEdges(
      groups,
      nodes,
      [{ id: "internal", source: "source", target: "target" }],
      [],
    );
    const points = routes.original.at(0)?.points ?? [];

    expect(points.at(0)).toEqual({ x: 160, y: 210 });
    expect(points.at(-1)).toEqual({ x: 740, y: 210 });
    expect(points.some(({ y }) => y <= 88 || y >= 362)).toBe(true);
    expect(points.every(({ x, y }) => x >= 4 && x <= 996 && y >= 4 && y <= 696)).toBe(true);
    expectOrthogonal(points);
  });

  it("routes a boundary aggregate to a nested external group", () => {
    const groups = [
      { id: "selected", position: { x: 0, y: 0 }, size: { width: 400, height: 300 } },
      { id: "external", position: { x: 600, y: 0 }, size: { width: 600, height: 600 } },
      {
        id: "target",
        parentId: "external",
        position: { x: 700, y: 100 },
        size: { width: 300, height: 200 },
      },
      {
        id: "sibling",
        parentId: "external",
        position: { x: 700, y: 350 },
        size: { width: 300, height: 200 },
      },
    ];

    const routes = routeGroupFocusedDependencyEdges(
      groups,
      [],
      [],
      [{ id: "aggregate", source: "selected", target: "target" }],
    );
    const points = routes.aggregate.at(0)?.points ?? [];

    expect(points.at(0)?.x).toBe(400);
    expect(points.at(0)?.y).toBeCloseTo(165.38, 2);
    expect(points.at(-1)?.x).toBe(700);
    expect(points.at(-1)?.y).toBeCloseTo(188.46, 2);
    expectOrthogonal(points);
  });

  it("routes a node-focused dependency across top-level groups", () => {
    const groups = [
      { id: "source-group", position: { x: 0, y: 0 }, size: { width: 400, height: 300 } },
      { id: "blocker", position: { x: 450, y: 0 }, size: { width: 300, height: 300 } },
      { id: "target-group", position: { x: 800, y: 0 }, size: { width: 400, height: 300 } },
    ];
    const nodes = [
      {
        id: "source",
        groupId: "source-group",
        position: { x: 100, y: 100 },
        size: { width: 100, height: 60 },
      },
      {
        id: "target",
        groupId: "target-group",
        position: { x: 900, y: 100 },
        size: { width: 100, height: 60 },
      },
    ];

    const [route] = routeNodeFocusedDependencyEdges(groups, nodes, [
      { id: "cross-group", source: "source", target: "target" },
    ]);
    const points = route?.points ?? [];

    expect(points.at(0)).toEqual({ x: 200, y: 130 });
    expect(points.at(-1)).toEqual({ x: 900, y: 130 });
    expect(points.some(({ y }) => y <= -12 || y >= 312)).toBe(true);
    expectOrthogonal(points);
  });
});
