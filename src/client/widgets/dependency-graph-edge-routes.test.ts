import {
  routeAggregateDependencyEdge,
  routeOriginalDependencyEdge,
} from "@/client/widgets/dependency-graph-edge-routes";

const source = { position: { x: 0, y: 0 }, size: { width: 100, height: 60 } };
const target = { position: { x: 0, y: 220 }, size: { width: 100, height: 60 } };
const points = [
  { x: 50, y: 60 },
  { x: 50, y: 220 },
];

describe("dependency edge routes", () => {
  it("keeps a short unobstructed relation as a smooth curve", () => {
    const route = routeOriginalDependencyEdge(points, source, target, []);

    expect(route.path).toMatch(/^M .+ C /);
    expect(route.labelPosition).toEqual({ x: 50, y: 140 });
  });

  it("routes aggregates around unrelated nodes between their group endpoints", () => {
    const interveningCard = { position: { x: 0, y: 100 }, size: { width: 100, height: 60 } };
    const route = routeAggregateDependencyEdge(source, target, [interveningCard]);

    expect(route.path).toMatch(/^M .+ Q /);
    expect(route.labelPosition.x < 0 || route.labelPosition.x > 100).toBe(true);
  });

  it("routes around another card instead of making it look like the edge's origin", () => {
    const interveningCard = { position: { x: 0, y: 100 }, size: { width: 100, height: 60 } };
    const route = routeOriginalDependencyEdge(points, source, target, [interveningCard]);

    expect(route.path).toMatch(/^M .+ Q /);
    expect(route.labelPosition.x < 0 || route.labelPosition.x > 100).toBe(true);
  });
});
