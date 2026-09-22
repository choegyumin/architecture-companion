import { routeTopLevelDependencyEdges } from "@/features/diagram/_layout/top-level-dependency-edge-routing.prototype";

function expectOrthogonal(points: readonly Readonly<{ x: number; y: number }>[]): void {
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    expect(previous?.x === point?.x || previous?.y === point?.y).toBe(true);
  }
}

describe("top-level dependency edge routing prototype", () => {
  it("routes a vertical dependency around an intervening module", () => {
    const [route] = routeTopLevelDependencyEdges(
      [
        { id: "source", position: { x: 0, y: 0 }, size: { width: 200, height: 100 } },
        { id: "blocker", position: { x: 50, y: 200 }, size: { width: 100, height: 100 } },
        { id: "target", position: { x: 0, y: 400 }, size: { width: 200, height: 100 } },
      ],
      [{ id: "dependency", source: "source", target: "target" }],
    );

    expect(route?.points.at(0)).toEqual({ x: 100, y: 100 });
    expect(route?.points.at(-1)).toEqual({ x: 100, y: 400 });
    expect(route?.points.some(({ x }) => x <= 18 || x >= 182)).toBe(true);
    expectOrthogonal(route?.points ?? []);
  });

  it("uses facing side ports for modules on the same level", () => {
    const [route] = routeTopLevelDependencyEdges(
      [
        { id: "source", position: { x: 0, y: 0 }, size: { width: 200, height: 100 } },
        { id: "target", position: { x: 400, y: 0 }, size: { width: 200, height: 100 } },
      ],
      [{ id: "dependency", source: "source", target: "target" }],
    );

    expect(route?.points).toEqual([
      { x: 200, y: 50 },
      { x: 400, y: 50 },
    ]);
  });

  it("spreads multiple dependencies across distinct module ports", () => {
    const routes = routeTopLevelDependencyEdges(
      [
        { id: "source", position: { x: 0, y: 0 }, size: { width: 400, height: 100 } },
        { id: "left", position: { x: 0, y: 300 }, size: { width: 160, height: 100 } },
        { id: "right", position: { x: 240, y: 300 }, size: { width: 160, height: 100 } },
      ],
      [
        { id: "left-dependency", source: "source", target: "left" },
        { id: "right-dependency", source: "source", target: "right" },
      ],
    );

    expect(routes.at(0)?.points.at(0)?.x).toBeCloseTo(149 + 1 / 3);
    expect(routes.at(1)?.points.at(0)?.x).toBeCloseTo(250 + 2 / 3);
    routes.forEach(({ points }) => expectOrthogonal(points));
  });
});
