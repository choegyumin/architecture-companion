import {
  type AggregateEdgeRoute,
  routeAggregateDependencyEdges,
} from "@/client/widgets/dependency-graph-aggregate-routes";
import type { DiagramLayout, DiagramLayoutGroup, DiagramLayoutNode } from "@/features/diagram/diagram-spatial";

const group = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  parentId?: string,
): DiagramLayoutGroup => ({
  id,
  parentId,
  position: { x, y },
  size: { width, height },
});
const node = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  parentId?: string,
): DiagramLayoutNode => ({
  id,
  parentId,
  position: { x, y },
  size: { width, height },
});
const layoutOf = (groups: DiagramLayoutGroup[], nodes: DiagramLayoutNode[] = []): DiagramLayout => ({
  groups,
  nodes,
  edges: [],
  initialView: { mode: "fit" },
});
const edge = (id: string, sourceId: string, targetId: string) => ({ id, sourceId, targetId });
type Point = Readonly<{ x: number; y: number }>;
type Box = Readonly<{ left: number; top: number; right: number; bottom: number }>;
const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });

function pathPoints(path: string): Point[] {
  const tokens = path.trim().split(/\s+/);
  const points: Point[] = [];
  let at = 0;
  while (at < tokens.length) {
    const command = tokens[at++];
    if (command !== "M" && command !== "L" && command !== "Q") throw new Error(`Invalid SVG command: ${command}`);
    const count = command === "Q" ? 4 : 2;
    const values = tokens.slice(at, at + count).map(Number);
    if (values.length !== count || values.some((value) => !Number.isFinite(value))) {
      throw new Error(`Invalid SVG coordinates: ${path}`);
    }
    at += count;
    const end = { x: values[count - 2]!, y: values[count - 1]! };
    if (command === "Q") {
      const start = points.at(-1);
      if (!start) throw new Error(`Quadratic without start: ${path}`);
      const control = { x: values.at(0)!, y: values.at(1)! };
      for (let step = 1; step <= 32; step += 1) {
        const t = step / 32;
        points.push({
          x: (1 - t) ** 2 * start.x + 2 * (1 - t) * t * control.x + t ** 2 * end.x,
          y: (1 - t) ** 2 * start.y + 2 * (1 - t) * t * control.y + t ** 2 * end.y,
        });
      }
    } else {
      if (command === "M" && points.length) throw new Error(`Disconnected SVG path: ${path}`);
      points.push(end);
    }
  }
  if (tokens.at(0) !== "M" || points.length < 2) throw new Error(`Missing connected SVG path: ${path}`);
  return points;
}

function onBoundary(point: Point, rect: Box): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  return (
    ((near(point.x, rect.left) || near(point.x, rect.right)) && point.y >= rect.top && point.y <= rect.bottom) ||
    ((near(point.y, rect.top) || near(point.y, rect.bottom)) && point.x >= rect.left && point.x <= rect.right)
  );
}

function entersBox(path: string, rect: Box): boolean {
  const points = pathPoints(path);
  // Clip each rendered line (including sampled quadratic pieces) to the open rectangle.
  const axes = [
    { from: rect.left + 0.01, to: rect.right - 0.01, key: "x" as const },
    { from: rect.top + 0.01, to: rect.bottom - 0.01, key: "y" as const },
  ];
  return points.slice(1).some((end, index) => {
    const start = points[index]!;
    let lower = 0;
    let upper = 1;
    for (const { from, to, key } of axes) {
      const change = end[key] - start[key];
      if (Math.abs(change) < 1e-9) {
        if (start[key] <= from || start[key] >= to) return false;
        continue;
      }
      lower = Math.max(lower, Math.min((from - start[key]) / change, (to - start[key]) / change));
      upper = Math.min(upper, Math.max((from - start[key]) / change, (to - start[key]) / change));
    }
    return lower < upper && upper > 0 && lower < 1;
  });
}

function crossings(first: string, second: string): number {
  const a = pathPoints(first);
  const b = pathPoints(second);
  let count = 0;
  for (let i = 1; i < a.length; i += 1) {
    const start = a[i - 1]!;
    const end = a[i]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    for (let j = 1; j < b.length; j += 1) {
      const otherStart = b[j - 1]!;
      const otherEnd = b[j]!;
      const ex = otherEnd.x - otherStart.x;
      const ey = otherEnd.y - otherStart.y;
      const determinant = dx * ey - dy * ex;
      if (Math.abs(determinant) < 1e-7) continue;
      const ox = otherStart.x - start.x;
      const oy = otherStart.y - start.y;
      const t = (ox * ey - oy * ex) / determinant;
      const u = (ox * dy - oy * dx) / determinant;
      if (t > 1e-5 && t < 1 - 1e-5 && u > 1e-5 && u < 1 - 1e-5) count += 1;
    }
  }
  return count;
}

function ordinatesAtX(path: string, x: number): number[] {
  const points = pathPoints(path);
  return points.slice(1).flatMap((end, index) => {
    const start = points[index]!;
    if (start.x === end.x || x <= Math.min(start.x, end.x) || x >= Math.max(start.x, end.x)) return [];
    return [start.y + ((x - start.x) * (end.y - start.y)) / (end.x - start.x)];
  });
}

function parallelClearances(first: string, second: string, openArea: Box): number[] {
  type Line = Readonly<{ axis: "horizontal" | "vertical"; fixed: number; from: number; to: number }>;
  const lines = (path: string): Line[] => {
    const points = pathPoints(path);
    return points.slice(1).flatMap<Line>((end, index) => {
      const start = points[index]!;
      if (start.y === end.y) {
        const from = Math.max(Math.min(start.x, end.x), openArea.left);
        const to = Math.min(Math.max(start.x, end.x), openArea.right);
        return start.y > openArea.top && start.y < openArea.bottom && to > from
          ? [{ axis: "horizontal" as const, fixed: start.y, from, to }]
          : [];
      }
      if (start.x === end.x) {
        const from = Math.max(Math.min(start.y, end.y), openArea.top);
        const to = Math.min(Math.max(start.y, end.y), openArea.bottom);
        return start.x > openArea.left && start.x < openArea.right && to > from
          ? [{ axis: "vertical" as const, fixed: start.x, from, to }]
          : [];
      }
      return [];
    });
  };
  return lines(first).flatMap((a) =>
    lines(second).flatMap((b) =>
      a.axis === b.axis && Math.min(a.to, b.to) - Math.max(a.from, b.from) >= 32 ? [Math.abs(a.fixed - b.fixed)] : [],
    ),
  );
}

function routeFor(routes: ReadonlyMap<string, AggregateEdgeRoute>, id: string): AggregateEdgeRoute {
  const route = routes.get(id);
  if (!route) throw new Error(`Missing aggregate route: ${id}`);
  return route;
}

function expectConnected(route: AggregateEdgeRoute, source: Box, target: Box): void {
  const points = pathPoints(route.path);
  expect(onBoundary(points.at(0)!, source)).toBe(true);
  expect(onBoundary(points.at(-1)!, target)).toBe(true);
  expect(Number.isFinite(route.labelPosition.x)).toBe(true);
  expect(Number.isFinite(route.labelPosition.y)).toBe(true);
  expect(["normal", "detour", "independent", "direct"]).toContain(route.routing.stage);
  expect(route.routing.reason.length).toBeGreaterThan(0);
}

describe("aggregate dependency routing at its public seam", () => {
  it("returns exactly the requested IDs and normal connected paths in open space", () => {
    const layout = layoutOf([group("left", 0, 0, 120, 120), group("right", 600, 0, 120, 120)]);
    expect(routeAggregateDependencyEdges([], layout).size).toBe(0);
    const routes = routeAggregateDependencyEdges(
      [edge("forward", "left", "right"), edge("reverse", "right", "left")],
      layout,
    );

    expect([...routes.keys()].toSorted()).toEqual(["forward", "reverse"]);
    expectConnected(routeFor(routes, "forward"), box(0, 0, 120, 120), box(600, 0, 720, 120));
    expectConnected(routeFor(routes, "reverse"), box(600, 0, 720, 120), box(0, 0, 120, 120));
    expect([...routes.values()].map(({ routing }) => routing.stage)).toEqual(["normal", "normal"]);
  });

  it.each([
    { name: "directly below", x: 0, y: 500, departure: "bottom", arrival: "top" },
    { name: "diagonally below", x: 240, y: 320, departure: "right", arrival: "left" },
    { name: "above and to the right", x: 120, y: -300, departure: "right", arrival: "left" },
  ])("balances departure and arrival sides when the target is $name", ({ x, y, departure, arrival }) => {
    const layout = layoutOf([group("source", 0, 0, 120, 120), group("target", x, y, 120, 120)]);
    const route = routeFor(routeAggregateDependencyEdges([edge("one", "source", "target")], layout), "one");
    const points = pathPoints(route.path);
    const side = (point: Point, rect: Box) => {
      if (point.y === rect.top) return "top";
      if (point.y === rect.bottom) return "bottom";
      if (point.x === rect.left) return "left";
      if (point.x === rect.right) return "right";
    };

    expect(route.routing.stage).toBe("normal");
    expectConnected(route, box(0, 0, 120, 120), box(x, y, x + 120, y + 120));
    expect(side(points.at(0)!, box(0, 0, 120, 120))).toBe(departure);
    expect(side(points.at(-1)!, box(x, y, x + 120, y + 120))).toBe(arrival);
  });

  it("keeps finite, connected paths when endpoint bounds overlap or coincide", () => {
    const layout = layoutOf([
      group("large", 0, 0, 200, 200),
      group("inside", 40, 40, 100, 100),
      group("same", 0, 0, 200, 200),
    ]);
    const requests = [edge("overlap", "large", "inside"), edge("coincident", "large", "same")];
    const routes = routeAggregateDependencyEdges(requests, layout);

    expect([...routes.keys()].toSorted()).toEqual(["coincident", "overlap"]);
    expectConnected(routeFor(routes, "overlap"), box(0, 0, 200, 200), box(40, 40, 140, 140));
    expectConnected(routeFor(routes, "coincident"), box(0, 0, 200, 200), box(0, 0, 200, 200));
  });

  it("uses a visible direct connection, not an exception or missing edge, when search has no budget", () => {
    const layout = layoutOf([
      group("source", 0, 0, 120, 120),
      group("target", 600, 0, 120, 120),
      group("blocker", 300, -80, 120, 280),
    ]);
    const routes = routeAggregateDependencyEdges(
      [edge("a", "source", "target"), edge("b", "target", "source")],
      layout,
      { maxSearchSteps: 0 },
    );

    expect([...routes.keys()].toSorted()).toEqual(["a", "b"]);
    for (const route of routes.values()) {
      expect(route.routing).toEqual({ stage: "direct", reason: "search-limit" });
      pathPoints(route.path);
      expect(Number.isFinite(route.labelPosition.x) && Number.isFinite(route.labelPosition.y)).toBe(true);
    }
  });

  it.each(["maxOrderSteps", "maxCoordinateSteps"] as const)(
    "preserves an obstacle-avoiding independent route when %s is exhausted",
    (limit) => {
      const blocker = box(290, -100, 410, 220);
      const layout = layoutOf([
        group("source", 0, 0, 120, 120),
        group("target", 600, 0, 120, 120),
        group("blocker", blocker.left, blocker.top, 120, 320),
      ]);
      const route = routeFor(
        routeAggregateDependencyEdges([edge("around", "source", "target")], layout, { [limit]: 0 }),
        "around",
      );

      expect(route.routing.stage).toBe("independent");
      expectConnected(route, box(0, 0, 120, 120), box(600, 0, 720, 120));
      expect(entersBox(route.path, blocker)).toBe(false);
    },
  );

  it("extends a limited coordinate search before falling back to an independent route", () => {
    const blocker = box(290, -100, 410, 220);
    const layout = layoutOf([
      group("source", 0, 0, 120, 120),
      group("target", 600, 0, 120, 120),
      group("blocker", blocker.left, blocker.top, 120, 320),
    ]);
    const requested = [edge("around", "source", "target")];
    const routes = [10, 25, 50, 75, 100, 150, 250].map((maxCoordinateSteps) =>
      routeFor(
        routeAggregateDependencyEdges(requested, layout, { maxCoordinateSteps, maxImprovementPasses: 0 }),
        "around",
      ),
    );
    const extended = routes.find(({ routing }) => routing.stage === "detour");

    expect(extended?.routing).toEqual({ stage: "detour", reason: "extended-detour" });
    if (!extended) throw new Error("Missing extended obstacle-avoiding route");
    expectConnected(extended, box(0, 0, 120, 120), box(600, 0, 720, 120));
    expect(entersBox(extended.path, blocker)).toBe(false);
  });

  it("keeps touching endpoint bounds visibly connected when only direct fallback is available", () => {
    const layout = layoutOf([group("source", 0, 0, 100, 100), group("target", 100, 0, 100, 100)]);
    const route = routeFor(
      routeAggregateDependencyEdges([edge("touching", "source", "target")], layout, { maxSearchSteps: 0 }),
      "touching",
    );
    const points = pathPoints(route.path);

    expect(route.routing.stage).toBe("direct");
    expectConnected(route, box(0, 0, 100, 100), box(100, 0, 200, 100));
    expect(points.at(0)).not.toEqual(points.at(-1));
    expect(
      points.slice(1).some((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y) > 0),
    ).toBe(true);
  });

  it("routes groups across a narrow gap without a false direct fallback", () => {
    const layout = layoutOf([group("source", 0, 0, 100, 100), group("target", 110, 0, 100, 100)]);
    const route = routeFor(routeAggregateDependencyEdges([edge("close", "source", "target")], layout), "close");

    expect(route.routing.stage).toBe("normal");
    expectConnected(route, box(0, 0, 100, 100), box(110, 0, 210, 100));
  });

  it("uses stable code-point tie breaking for canonically equivalent edge IDs", () => {
    const layout = layoutOf([group("source", 0, 0, 100, 100), group("target", 500, 0, 100, 100)]);
    const requests = [edge("é", "source", "target"), edge("é", "target", "source")];
    const forward = routeAggregateDependencyEdges(requests, layout);
    const reversed = routeAggregateDependencyEdges(requests.toReversed(), layout);
    const cold = routeAggregateDependencyEdges(requests, structuredClone(layout));

    expect([...forward.keys()].toSorted()).toEqual(requests.map(({ id }) => id).toSorted());
    for (const { id, sourceId, targetId } of requests) {
      expect(forward.get(id)).toEqual(reversed.get(id));
      expect(forward.get(id)).toEqual(cold.get(id));
      const route = routeFor(forward, id);
      expect(route.routing.stage).toBe("normal");
      expectConnected(
        route,
        sourceId === "source" ? box(0, 0, 100, 100) : box(500, 0, 600, 100),
        targetId === "target" ? box(500, 0, 600, 100) : box(0, 0, 100, 100),
      );
    }
  });

  it("routes from an ancestor boundary to its own child node without treating the ancestor as a blocker", () => {
    const layout = layoutOf([group("ancestor", 0, 0, 600, 440)], [node("member", 230, 160, 100, 80, "ancestor")]);
    const route = routeFor(routeAggregateDependencyEdges([edge("inside", "ancestor", "member")], layout), "inside");

    expect(route.routing.stage).toBe("normal");
    expectConnected(route, box(0, 0, 600, 440), box(230, 160, 330, 240));
  });

  it("does not mistake a coincident unrelated group for an ancestor exemption", () => {
    const layout = layoutOf(
      [group("ancestor", 0, 0, 600, 440), group("unrelated", 0, 0, 600, 440)],
      [node("member", 230, 160, 100, 80, "ancestor")],
    );
    const route = routeFor(routeAggregateDependencyEdges([edge("inside", "ancestor", "member")], layout), "inside");

    expect(route.routing.stage).toBe("direct");
    expectConnected(route, box(0, 0, 600, 440), box(230, 160, 330, 240));
  });

  it("avoids the whole virtual envelope around direct nodes, not only the individual cards", () => {
    const envelope = box(250, 100, 540, 510);
    const layout = layoutOf(
      [group("source", 0, 260, 100, 100), group("target", 700, 260, 100, 100)],
      [node("upper-left", 250, 100, 80, 80), node("lower-right", 460, 430, 80, 80)],
    );
    const route = routeFor(routeAggregateDependencyEdges([edge("across", "source", "target")], layout), "across");

    expect(route.routing.stage).toBe("normal");
    expectConnected(route, box(0, 260, 100, 360), box(700, 260, 800, 360));
    expect(entersBox(route.path, envelope)).toBe(false);
  });

  it("lets a node endpoint be reached through its own virtual envelope", () => {
    const layout = layoutOf(
      [group("source", -300, 200, 100, 100)],
      [node("member", 0, 200, 100, 100), node("other", 240, 350, 100, 100)],
    );
    const route = routeFor(routeAggregateDependencyEdges([edge("to-member", "source", "member")], layout), "to-member");

    expect(route.routing.stage).toBe("normal");
    expectConnected(route, box(-300, 200, -200, 300), box(0, 200, 100, 300));
  });

  it("merges left, straight, and right approaches into distinct ports without avoidable crossing", () => {
    const layout = layoutOf([
      group("left", -100, 0, 100, 100),
      group("straight", 200, 0, 100, 100),
      group("right", 500, 0, 100, 100),
      group("destination", 0, 620, 500, 120),
    ]);
    const ids = ["left", "straight", "right"];
    const routes = routeAggregateDependencyEdges(
      ids.map((id) => edge(id, id, "destination")),
      layout,
    );
    const paths = ids.map((id) => routeFor(routes, id));
    const ports = paths.map(({ path }) => pathPoints(path).at(-1)!);

    expect(paths.map(({ routing }) => routing.stage)).toEqual(["normal", "normal", "normal"]);
    expect(new Set(ports.map(({ x, y }) => `${x}:${y}`)).size).toBe(3);
    for (let first = 0; first < paths.length; first += 1) {
      for (let second = first + 1; second < paths.length; second += 1) {
        expect(crossings(paths[first]!.path, paths[second]!.path)).toBe(0);
      }
    }
  });

  it("keeps four rotated arrivals and a reverse edge pair on separate connected tracks", () => {
    const layout = layoutOf([
      group("north", 250, -500, 160, 100),
      group("east", 800, 250, 100, 160),
      group("south", 250, 800, 160, 100),
      group("west", -500, 250, 100, 160),
    ]);
    const requests = [
      edge("north-east", "north", "east"),
      edge("east-south", "east", "south"),
      edge("south-west", "south", "west"),
      edge("west-north", "west", "north"),
      edge("west-east", "west", "east"),
      edge("east-west", "east", "west"),
    ];
    const routes = routeAggregateDependencyEdges(requests, layout);
    const forward = routeFor(routes, "west-east");
    const reverse = routeFor(routes, "east-west");
    const westPort = pathPoints(forward.path).at(0)!;
    const westReversePort = pathPoints(reverse.path).at(-1)!;

    expect([...routes.keys()].toSorted()).toEqual(requests.map(({ id }) => id).toSorted());
    expect([...routes.values()].map(({ routing }) => routing.stage)).toEqual(Array(6).fill("normal"));
    expect(westPort).not.toEqual(westReversePort);
    expect(forward.path).not.toBe(reverse.path);
    expect(crossings(forward.path, reverse.path)).toBe(0);
    const forwardTracks = ordinatesAtX(forward.path, 200);
    const reverseTracks = ordinatesAtX(reverse.path, 200);
    expect(forwardTracks.length).toBeGreaterThan(0);
    expect(reverseTracks.length).toBeGreaterThan(0);
    expect(forwardTracks.every((y) => reverseTracks.every((other) => Math.abs(y - other) >= 4))).toBe(true);
  });

  it.each(["horizontal", "vertical"] as const)(
    "keeps parallel %s connectors at least 32 apart in an open corridor",
    (axis) => {
      const horizontal = axis === "horizontal";
      const layout = layoutOf(
        horizontal
          ? [group("source", 0, 0, 120, 300), group("target", 700, 0, 120, 300)]
          : [group("source", 0, 0, 300, 120), group("target", 0, 700, 300, 120)],
      );
      const requests = Array.from({ length: 3 }, (_, index) => edge(`parallel-${index}`, "source", "target"));
      const routes = routeAggregateDependencyEdges(requests, layout);
      const area = horizontal ? box(160, -100, 660, 400) : box(-100, 160, 400, 660);
      const source = horizontal ? box(0, 0, 120, 300) : box(0, 0, 300, 120);
      const target = horizontal ? box(700, 0, 820, 300) : box(0, 700, 300, 820);

      expect([...routes.keys()].toSorted()).toEqual(requests.map(({ id }) => id).toSorted());
      for (const { id } of requests) expectConnected(routeFor(routes, id), source, target);
      for (let first = 0; first < requests.length; first += 1) {
        for (let second = first + 1; second < requests.length; second += 1) {
          const clearances = parallelClearances(
            routeFor(routes, requests[first]!.id).path,
            routeFor(routes, requests[second]!.id).path,
            area,
          );
          expect(clearances.length).toBeGreaterThan(0);
          expect(clearances.every((distance) => distance >= 32 - 0.01)).toBe(true);
        }
      }
    },
  );

  it("separates parallel connectors in an open crossing cell before reducing spacing", () => {
    const layout = layoutOf([
      group("northwest", 0, 0, 120, 120),
      group("southwest", 0, 120, 120, 120),
      group("northeast", 700, 0, 120, 120),
      group("southeast", 700, 120, 120, 120),
    ]);
    const requests = [
      edge("cross-down", "northwest", "southeast"),
      edge("cross-up", "southwest", "northeast"),
      edge("top", "northwest", "northeast"),
      edge("bottom", "southwest", "southeast"),
    ];
    const routes = routeAggregateDependencyEdges(requests, layout);
    const down = routeFor(routes, "cross-down");
    const up = routeFor(routes, "cross-up");

    expect([...routes.keys()].toSorted()).toEqual(requests.map(({ id }) => id).toSorted());
    expectConnected(down, box(0, 0, 120, 120), box(700, 120, 820, 240));
    expectConnected(up, box(0, 120, 120, 240), box(700, 0, 820, 120));
    expect(parallelClearances(down.path, up.path, box(160, 32, 660, 208)).every((gap) => gap >= 32 - 0.01)).toBe(true);
  });

  it("keeps every narrow-pass route obstacle-free without shrinking unrelated wide tracks", () => {
    const upper = box(300, -500, 600, 88);
    const lower = box(300, 112, 600, 600);
    const layout = layoutOf([
      group("source", 0, -100, 120, 400),
      group("target", 800, -100, 120, 400),
      group("upper", upper.left, upper.top, 300, 588),
      group("lower", lower.left, lower.top, 300, 488),
      group("wide-source", 0, 800, 120, 300),
      group("wide-target", 800, 800, 120, 300),
    ]);
    const requests = [
      ...Array.from({ length: 3 }, (_, index) => edge(`narrow-${index}`, "source", "target")),
      edge("wide-a", "wide-source", "wide-target"),
      edge("wide-b", "wide-source", "wide-target"),
    ];
    const routes = routeAggregateDependencyEdges(requests, layout);

    expect([...routes.keys()].toSorted()).toEqual(requests.map(({ id }) => id).toSorted());
    for (const { id } of requests) {
      const route = routeFor(routes, id);
      expectConnected(
        route,
        id.startsWith("narrow") ? box(0, -100, 120, 300) : box(0, 800, 120, 1100),
        id.startsWith("narrow") ? box(800, -100, 920, 300) : box(800, 800, 920, 1100),
      );
      expect(route.routing.stage).not.toBe("direct");
      expect(entersBox(route.path, upper)).toBe(false);
      expect(entersBox(route.path, lower)).toBe(false);
    }
    const wideClearances = parallelClearances(
      routeFor(routes, "wide-a").path,
      routeFor(routes, "wide-b").path,
      box(160, 700, 760, 1200),
    );
    expect(wideClearances.length).toBeGreaterThan(0);
    expect(wideClearances.every((distance) => distance >= 32 - 0.01)).toBe(true);

    const reversed = routeAggregateDependencyEdges(requests.toReversed(), structuredClone(layout));
    for (const { id } of requests) expect(reversed.get(id)).toEqual(routes.get(id));

    const limited = routeAggregateDependencyEdges(requests, layout, { maxCoordinateSteps: 0 });
    expect([...limited.keys()].toSorted()).toEqual(requests.map(({ id }) => id).toSorted());
    for (const { id } of requests) {
      const route = routeFor(limited, id);
      expectConnected(
        route,
        id.startsWith("narrow") ? box(0, -100, 120, 300) : box(0, 800, 120, 1100),
        id.startsWith("narrow") ? box(800, -100, 920, 300) : box(800, 800, 920, 1100),
      );
      expect(route.routing).toEqual({ stage: "independent", reason: "coordinate-limit" });
      expect(entersBox(route.path, upper)).toBe(false);
      expect(entersBox(route.path, lower)).toBe(false);
    }
  });

  it("rounds both corners despite a nearby parallel branch", () => {
    const layout = layoutOf([
      group("source", 0, 0, 120, 180),
      group("target", 950, 0, 120, 180),
      group("blocker", 420, -100, 180, 380),
      group("wall", 350, 280, 320, 650),
      group("side", 150, -400, 120, 100),
    ]);
    const routes = routeAggregateDependencyEdges(
      [edge("long", "source", "target"), edge("other", "source", "side")],
      layout,
    );
    const route = routeFor(routes, "long");
    const tokens = route.path.split(/\s+/);
    const radii = tokens.flatMap((token, index) =>
      token === "Q"
        ? [
            Math.hypot(
              Number(tokens.at(index - 2)) - Number(tokens.at(index + 1)),
              Number(tokens.at(index - 1)) - Number(tokens.at(index + 2)),
            ),
          ]
        : [],
    );

    expect(route.routing.stage).toBe("normal");
    expectConnected(route, box(0, 0, 120, 180), box(950, 0, 1070, 180));
    expect(radii.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...radii)).toBeGreaterThan(40);
    expect(entersBox(route.path, box(420, -100, 600, 280))).toBe(false);
    expect(entersBox(route.path, box(350, 280, 670, 930))).toBe(false);
    expect(entersBox(route.path, box(150, -400, 270, -300))).toBe(false);
  });

  it("preserves distinct ports when multiple relationships branch and rejoin around an obstacle", () => {
    const obstacle = box(300, -80, 480, 280);
    const layout = layoutOf([
      group("source", 0, 0, 120, 200),
      group("destination", 700, 0, 120, 200),
      group("middle", 300, -80, 180, 360),
    ]);
    const routes = routeAggregateDependencyEdges(
      Array.from({ length: 4 }, (_, index) => edge(`branch-${index}`, "source", "destination")),
      layout,
    );
    const paths = [...routes.values()];
    const starts = paths.map(({ path }) => pathPoints(path).at(0)!);
    const ends = paths.map(({ path }) => pathPoints(path).at(-1)!);

    expect(paths.map(({ routing }) => routing.stage)).toEqual(Array(4).fill("normal"));
    expect(new Set(starts.map(({ x, y }) => `${x}:${y}`)).size).toBe(4);
    expect(new Set(ends.map(({ x, y }) => `${x}:${y}`)).size).toBe(4);
    expect(paths.every(({ path }) => !entersBox(path, obstacle))).toBe(true);
  });

  it("does not depend on projection order, warmed scenes, or the identity of an equivalent layout", () => {
    const layout = layoutOf([
      group("source", 0, 0, 180, 180),
      group("target", 700, 0, 180, 180),
      group("obstacle", 350, -40, 150, 260),
    ]);
    const requests = [
      edge("forward", "source", "target"),
      edge("reverse", "target", "source"),
      edge("other", "source", "obstacle"),
    ];
    const expected = routeAggregateDependencyEdges(requests, structuredClone(layout));
    routeAggregateDependencyEdges([edge("warm", "obstacle", "target")], layout);
    const forward = routeAggregateDependencyEdges(requests, layout);
    const reversed = routeAggregateDependencyEdges(requests.toReversed(), layout);

    for (const { id } of requests) {
      expect(forward.get(id)).toEqual(expected.get(id));
      expect(reversed.get(id)).toEqual(expected.get(id));
    }
  });

  it("does not retain endpoint exceptions or demand from a different focus on the same layout", () => {
    const layout = layoutOf(
      [
        group("parent", 0, 0, 600, 500),
        group("inside", 140, 120, 120, 120, "parent"),
        group("outside", 760, 160, 120, 120),
      ],
      [node("member", 360, 300, 100, 100, "parent")],
    );
    const focused = [edge("parent-child", "parent", "inside"), edge("child-outside", "inside", "outside")];
    const baseline = routeAggregateDependencyEdges(focused, structuredClone(layout));
    routeAggregateDependencyEdges(
      [edge("member-outside", "member", "outside"), edge("outside-parent", "outside", "parent")],
      layout,
    );
    const after = routeAggregateDependencyEdges(focused, layout);

    for (const { id } of focused) expect(after.get(id)).toEqual(baseline.get(id));
  });

  it("returns every route after a dense layout exceeds the static scene limit", () => {
    const groups = [group("source", -300, 0, 100, 100), group("target", 2500, 0, 100, 100)];
    const nodes = Array.from({ length: 2_100 }, (_, index) =>
      node(`card-${index}`, (index % 70) * 30, Math.floor(index / 70) * 30 + 300, 20, 20),
    );
    const requests = Array.from({ length: 12 }, (_, index) => edge(`dense-${index}`, "source", "target"));
    const routes = routeAggregateDependencyEdges(requests, layoutOf(groups, nodes));

    expect([...routes.keys()].toSorted()).toEqual(requests.map(({ id }) => id).toSorted());
    for (const route of routes.values()) {
      expect(route.routing).toEqual({ stage: "direct", reason: "scene-limit" });
      expectConnected(route, box(-300, 0, -200, 100), box(2500, 0, 2600, 100));
    }
  });
});
