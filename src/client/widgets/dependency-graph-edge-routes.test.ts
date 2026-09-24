import {
  routeAggregateDependencyEdges,
  routeOriginalDependencyEdge,
} from "@/client/widgets/dependency-graph-edge-routes";

const source = { position: { x: 0, y: 0 }, size: { width: 100, height: 60 } };
const target = { position: { x: 0, y: 220 }, size: { width: 100, height: 60 } };
const points = [
  { x: 50, y: 60 },
  { x: 50, y: 220 },
];

function routeBetween(elements: ReadonlyMap<string, typeof source>) {
  return routeAggregateDependencyEdges([{ id: "aggregate", sourceId: "source", targetId: "target" }], elements).get(
    "aggregate",
  );
}

function straightSegments(path: string) {
  const commands = path.matchAll(/([MLQ]) ([-\d.]+) ([-\d.]+)(?: ([-\d.]+) ([-\d.]+))?/g);
  const segments: Array<readonly [number, number, number, number]> = [];
  let previous: readonly [number, number] | undefined;
  for (const [, command, x, y, endX, endY] of commands) {
    if (!x || !y) throw new Error("Missing SVG point");
    const point = [Number(x), Number(y)] as const;
    if (command === "L" && previous) {
      const [fromX, fromY] = previous;
      const [toX, toY] = point;
      segments.push([fromX, fromY, toX, toY]);
    }
    previous = command === "Q" ? [Number(endX), Number(endY)] : point;
  }
  return segments;
}

function overlappingStraightLength(first: string, second: string) {
  let overlap = 0;
  for (const [ax, ay, bx, by] of straightSegments(first)) {
    for (const [cx, cy, dx, dy] of straightSegments(second)) {
      if (ax === bx && cx === dx && Math.abs(ax - cx) < 8) {
        overlap += Math.max(
          0,
          Math.min(Math.max(ay, by), Math.max(cy, dy)) - Math.max(Math.min(ay, by), Math.min(cy, dy)),
        );
      }
      if (ay === by && cy === dy && Math.abs(ay - cy) < 8) {
        overlap += Math.max(
          0,
          Math.min(Math.max(ax, bx), Math.max(cx, dx)) - Math.max(Math.min(ax, bx), Math.min(cx, dx)),
        );
      }
    }
  }
  return overlap;
}

describe("dependency edge routes", () => {
  it("keeps an unobstructed node relation as a smooth curve", () => {
    const route = routeOriginalDependencyEdge(points, source, target, []);

    expect(route.path).toMatch(/^M .+ C /);
    expect(route.labelPosition).toEqual({ x: 50, y: 140 });
  });

  it("avoids another card using one outward-departing curve, not an orthogonal detour", () => {
    const distantTarget = { position: { x: 0, y: 520 }, size: { width: 100, height: 60 } };
    const interveningCard = { position: { x: 0, y: 290 }, size: { width: 100, height: 60 } };
    const route = routeOriginalDependencyEdge(
      [
        { x: 50, y: 60 },
        { x: 50, y: 520 },
      ],
      source,
      distantTarget,
      [interveningCard],
    );
    const controls = route.path.match(/^M ([-\d.]+) ([-\d.]+) C ([-\d.]+) ([-\d.]+)/);
    if (!controls) throw new Error("Missing cubic controls");

    expect(route.path).not.toContain(" Q ");
    expect(Math.abs(route.labelPosition.x - 50)).toBeGreaterThan(20);
    expect(Number(controls.at(4)) - Number(controls.at(2))).toBeGreaterThanOrEqual(
      Math.abs(Number(controls.at(3)) - Number(controls.at(1))),
    );
  });

  it("draws a self-loop with one outward cubic above its node", () => {
    const loop = [
      { x: 75, y: 0 },
      { x: 75, y: -16 },
      { x: 25, y: -16 },
      { x: 25, y: 0 },
    ];
    const route = routeOriginalDependencyEdge(loop, source, source, []);

    expect(route.path).toMatch(/^M 75 0 C .+ 25\.0 0\.0$/);
    expect(route.labelPosition.y).toBeLessThan(0);
  });

  it("routes an aggregate around a group with rounded corners", () => {
    const interveningGroup = { position: { x: 0, y: 100 }, size: { width: 100, height: 60 } };
    const route = routeBetween(
      new Map([
        ["source", source],
        ["target", target],
        ["middle", interveningGroup],
      ]),
    );

    expect(route?.path).toMatch(/^M .+ Q /);
    expect(route?.labelPosition.x).toBeLessThan(0);
  });

  it("distributes each group endpoint independently on a shared face", () => {
    const server = { position: { x: 0, y: 0 }, size: { width: 200, height: 400 } };
    const others = [0, 1, 2].map(
      (index) => [`other${index}`, { position: { x: 500, y: index * 120 }, size: { width: 200, height: 80 } }] as const,
    );
    const elements = new Map([["server", server] as const, ...others]);
    const projections = others.flatMap(([id]) => [
      { id: `out-${id}`, sourceId: "server", targetId: id },
      { id: `in-${id}`, sourceId: id, targetId: "server" },
    ]);
    const routes = routeAggregateDependencyEdges(projections, elements);
    const serverY = projections.map(({ id }) => {
      const path = routes.get(id)?.path;
      if (!path) throw new Error(`Missing route: ${id}`);
      const endpoint = id.startsWith("out-")
        ? path.match(/^M ([-\d.]+) ([-\d.]+)/)
        : path.match(/ L ([-\d.]+) ([-\d.]+)$/);
      if (!endpoint) throw new Error(`Missing endpoint: ${id}`);
      expect(Number(endpoint.at(1))).toBe(200);
      return Number(endpoint.at(2));
    });

    expect(new Set(serverY).size).toBe(6);
    expect(serverY.every((y) => y > 0 && y < 400)).toBe(true);
  });

  it("separates the middle corridors of opposite aggregates without reusing a port", () => {
    const server = { position: { x: 992, y: 393 }, size: { width: 988, height: 1166 } };
    const tooling = { position: { x: 2400, y: 650 }, size: { width: 330, height: 280 } };
    const root = { position: { x: 2070, y: 710 }, size: { width: 252, height: 76 } };
    const routes = routeAggregateDependencyEdges(
      [
        { id: "server-tooling", sourceId: "server", targetId: "tooling" },
        { id: "tooling-server", sourceId: "tooling", targetId: "server" },
      ],
      new Map([
        ["server", server],
        ["tooling", tooling],
        ["root", root],
      ]),
    );
    const forward = routes.get("server-tooling");
    const reverse = routes.get("tooling-server");
    if (!forward || !reverse) throw new Error("Missing reciprocal routes");

    expect(forward.path).toMatch(/ Q /);
    expect(reverse.path).toMatch(/ Q /);
    const forwardPort = forward.path.match(/^M 1980 ([-\d.]+)/)?.at(1);
    const reversePort = reverse.path.match(/ L 1980(?:\.0)? ([-\d.]+)$/)?.at(1);
    expect(forwardPort).toBeDefined();
    expect(reversePort).toBeDefined();
    expect(forwardPort).not.toBe(reversePort);
    expect(overlappingStraightLength(forward.path, reverse.path)).toBeLessThan(40);
  });

  it("does not send later aggregate pairs around the far edge of a large group", () => {
    const server = { position: { x: 464, y: 2734 }, size: { width: 352, height: 2454 } };
    const tooling = { position: { x: 880, y: 2734 }, size: { width: 352, height: 348 } };
    const integrations = { position: { x: 1296, y: 2734 }, size: { width: 352, height: 348 } };
    const root = { position: { x: 1712, y: 2734 }, size: { width: 288, height: 58 } };
    const routes = routeAggregateDependencyEdges(
      [
        { id: "server-root", sourceId: "server", targetId: "root" },
        { id: "root-server", sourceId: "root", targetId: "server" },
        { id: "server-tooling", sourceId: "server", targetId: "tooling" },
        { id: "tooling-server", sourceId: "tooling", targetId: "server" },
        { id: "server-integrations", sourceId: "server", targetId: "integrations" },
        { id: "integrations-server", sourceId: "integrations", targetId: "server" },
      ],
      new Map([
        ["server", server],
        ["tooling", tooling],
        ["integrations", integrations],
        ["root", root],
      ]),
    );
    for (const id of ["server-integrations", "integrations-server"]) {
      const path = routes.get(id)?.path;
      if (!path) throw new Error(`Missing route: ${id}`);
      const ordinates = [...path.matchAll(/[-\d.]+ ([-\d.]+)/g)].map((match) => Number(match.at(1)));
      expect(Math.max(...ordinates)).toBeLessThan(3500);
    }
    const toRoot = routes.get("server-root")?.path;
    const toIntegrations = routes.get("server-integrations")?.path;
    const fromRoot = routes.get("root-server")?.path;
    const fromIntegrations = routes.get("integrations-server")?.path;
    if (!toRoot || !toIntegrations || !fromRoot || !fromIntegrations) throw new Error("Missing distinct routes");
    expect(overlappingStraightLength(toRoot, toIntegrations)).toBeLessThan(40);
    expect(overlappingStraightLength(fromRoot, fromIntegrations)).toBeLessThan(40);
    const firstTurn = toIntegrations.match(/^M 816 [-\d.]+ L ([-\d.]+)/)?.at(1);
    expect(Number(firstTurn)).toBeGreaterThanOrEqual(840);
  });
});
