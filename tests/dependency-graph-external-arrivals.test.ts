import { routeAggregateDependencyEdges } from "@/client/widgets/dependency-graph-aggregate-routes";
import { getDependencyElementBounds } from "@/client/widgets/dependency-graph-edge-routes";
import {
  onBoundary,
  pathEndpoints,
  pathEntersBounds,
  pathsCross,
  pathsOverlap,
} from "@/client/widgets/dependency-graph-route-test-geometry";
import { collectVirtualBundles } from "@/client/widgets/dependency-graph-routing-scene";
import type { DiagramLayout } from "@/features/diagram/diagram-spatial";
import { getOrThrow } from "@/shared/universal/get-or-throw";

// Hand-built scenes for routing cases the showcase designs do not contain:
// several distinct source groups converging on an external-packages group, and
// loose-node bundles sitting beside subgroups inside a parent group.

type Placement = { position: { x: number; y: number }; size: { width: number; height: number } };

function groupLayout(
  elements: ReadonlyMap<string, Placement>,
  parentIds: ReadonlyMap<string, string> = new Map(),
  nodes: ReadonlyArray<{ id: string; parentId: string } & Placement> = [],
): DiagramLayout {
  return {
    groups: [...elements].map(([id, bounds]) => ({ id, ...bounds, parentId: parentIds.get(id) })),
    nodes: nodes.map(({ id, parentId, ...bounds }) => ({ id, parentId, ...bounds })),
    edges: [],
    initialView: { mode: "fit" },
  };
}

function straightSegments(path: string) {
  const segments: Array<readonly [number, number, number, number]> = [];
  let previous: readonly [number, number] | undefined;
  for (const [, command, x, y, endX, endY] of path.matchAll(/([MLQ]) ([-\d.]+) ([-\d.]+)(?: ([-\d.]+) ([-\d.]+))?/g)) {
    const point = [Number(x), Number(y)] as const;
    if (command === "L" && previous) segments.push([...previous, ...point]);
    previous = command === "Q" ? [Number(endX), Number(endY)] : point;
  }
  return segments;
}

function overlapsVisibly(first: string, second: string): boolean {
  for (const [ax, ay, bx, by] of straightSegments(first)) {
    for (const [cx, cy, dx, dy] of straightSegments(second)) {
      if (ax === bx && cx === dx && Math.abs(ax - cx) < 2.1) {
        if (Math.min(Math.max(ay, by), Math.max(cy, dy)) - Math.max(Math.min(ay, by), Math.min(cy, dy)) > 0)
          return true;
      }
      if (ay === by && cy === dy && Math.abs(ay - cy) < 2.1) {
        if (Math.min(Math.max(ax, bx), Math.max(cx, dx)) - Math.max(Math.min(ax, bx), Math.min(cx, dx)) > 0)
          return true;
      }
    }
  }
  return false;
}

function arrivalSide(path: string, external: Placement): "left" | "top" | "right" | undefined {
  const { left, right, top } = {
    left: external.position.x,
    right: external.position.x + external.size.width,
    top: external.position.y,
  };
  const end = pathEndpoints(path).end;
  const last = straightSegments(path).at(-1);
  if (!last) throw new Error("Missing arrival approach");
  const [fromX, fromY] = last;
  if (fromX < left && end.x === left) return "left";
  if (fromX > right && end.x === right) return "right";
  if (fromY < top && end.y === top) return "top";
  return undefined;
}

describe("external packages convergence", () => {
  const external = { position: { x: 900, y: 300 }, size: { width: 300, height: 600 } };
  const layout = groupLayout(
    new Map([
      ["external-packages", external],
      ["left-near", { position: { x: 0, y: 0 }, size: { width: 200, height: 150 } }],
      ["left-middle", { position: { x: 0, y: 200 }, size: { width: 200, height: 150 } }],
      ["left-far", { position: { x: 0, y: 400 }, size: { width: 200, height: 150 } }],
      ["above", { position: { x: 950, y: 0 }, size: { width: 200, height: 120 } }],
      ["beyond", { position: { x: 1450, y: 500 }, size: { width: 200, height: 200 } }],
    ]),
  );
  const projections = ["left-near", "left-middle", "left-far", "above", "beyond"].map((sourceId) => ({
    id: `${sourceId}-external`,
    sourceId,
    targetId: "external-packages",
  }));
  const routes = routeAggregateDependencyEdges(projections, layout);

  it("keeps every arrival on the external boundary with distinct ports", () => {
    for (const { id } of projections) {
      const route = getOrThrow(routes.get(id), `Missing route: ${id}`);
      expect(onBoundary(pathEndpoints(route.path).end, external)).toBe(true);
    }
    const ends = projections.map(
      ({ id }) => pathEndpoints(getOrThrow(routes.get(id), `Missing route: ${id}`).path).end,
    );
    expect(new Set(ends.map(({ x, y }) => `${x}:${y}`)).size).toBe(ends.length);
  });

  it("keeps distinct source groups' approaches on separate tracks", () => {
    for (const [index, first] of projections.entries()) {
      for (const second of projections.slice(index + 1)) {
        const a = getOrThrow(routes.get(first.id), `Missing route: ${first.id}`).path;
        const b = getOrThrow(routes.get(second.id), `Missing route: ${second.id}`).path;
        expect(pathsCross(a, b)).toBe(false);
        expect(overlapsVisibly(a, b)).toBe(false);
        expect(pathsOverlap(a, b)).toBe(false);
      }
    }
  });

  it("orders left, top, and right approaches along the external boundary", () => {
    const arrivals = projections.map(({ id }) => ({
      path: getOrThrow(routes.get(id), `Missing route: ${id}`).path,
      side: arrivalSide(getOrThrow(routes.get(id), `Missing route: ${id}`).path, external),
    }));
    for (const arrival of arrivals) expect(arrival.side, `Unexpected approach: ${arrival.path}`).toBeDefined();
    const ends = arrivals.map(({ path }) => pathEndpoints(path).end);
    const bySide = (side: "left" | "top" | "right") => ends.filter((_, index) => arrivals[index]!.side === side);

    // Equal left/right/top preference lets each side pick its shortest approach;
    // only the presence of every side and their ordering are guaranteed.
    expect(bySide("left").length).toBeGreaterThanOrEqual(1);
    expect(bySide("top").length).toBeGreaterThanOrEqual(1);
    expect(bySide("right").length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...bySide("left").map(({ x }) => x))).toBeLessThan(Math.min(...bySide("top").map(({ x }) => x)));
    expect(Math.max(...bySide("top").map(({ x }) => x))).toBeLessThan(Math.min(...bySide("right").map(({ x }) => x)));
  });
});

describe("loose-node bundles beside subgroups", () => {
  const looseCard = (id: string, x: number, y: number) => ({
    id,
    parentId: "parent",
    position: { x, y },
    size: { width: 100, height: 60 },
  });
  const layout = groupLayout(
    new Map([
      ["parent", { position: { x: 0, y: 0 }, size: { width: 500, height: 400 } }],
      ["subgroup", { position: { x: 300, y: 40 }, size: { width: 180, height: 320 } }],
      ["neighbour", { position: { x: 800, y: 100 }, size: { width: 240, height: 200 } }],
    ]),
    new Map([["subgroup", "parent"]]),
    [looseCard("loose-a", 40, 60), looseCard("loose-b", 40, 160), looseCard("loose-c", 160, 60)],
  );
  const bounds = getDependencyElementBounds(layout);
  const bundles = collectVirtualBundles(layout, bounds);
  const projections = [
    { id: "parent-neighbour", sourceId: "parent", targetId: "neighbour" },
    { id: "neighbour-parent", sourceId: "neighbour", targetId: "parent" },
  ];
  const routes = routeAggregateDependencyEdges(projections, layout);

  it("wraps the parent's loose nodes in a bundle", () => {
    const bundle = getOrThrow(bundles?.get("parent"), "Missing loose-node bundle for parent");
    // The bundle hugs the loose cards, not the subgroup or the group frame.
    expect(bundle.position.x).toBeGreaterThan(0);
    expect(bundle.position.x).toBeLessThan(40);
    expect(bundle.size.width).toBeLessThan(300);
  });

  it("keeps whole-group relations on the group frame and out of the bundle", () => {
    for (const { id, sourceId, targetId } of projections) {
      const route = getOrThrow(routes.get(id), `Missing route: ${id}`);
      const { start, end } = pathEndpoints(route.path);
      const endpointRects = (elementId: string) => [bounds.get(elementId), bundles?.get(elementId)].filter(Boolean);
      expect(endpointRects(sourceId).some((rect) => onBoundary(start, rect!))).toBe(true);
      expect(endpointRects(targetId).some((rect) => onBoundary(end, rect!))).toBe(true);
      const bundle = getOrThrow(bundles?.get("parent"), "Missing loose-node bundle");
      expect(pathEntersBounds(route.path, bundle)).toBe(false);
    }
  });
});
