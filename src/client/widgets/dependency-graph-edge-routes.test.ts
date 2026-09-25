import {
  measureAggregateSegmentCongestion,
  routeAggregateDependencyEdges,
} from "@/client/widgets/dependency-graph-aggregate-routes";
import { getDependencyElementBounds, routeOriginalDependencyEdge } from "@/client/widgets/dependency-graph-edge-routes";
import { layoutDependencyGraph } from "@/features/diagram/_layout/dependency-graph-layout";
import { projectDependencyEdges } from "@/features/diagram/dependency-edge-projection";
import { parseDiagram } from "@/features/diagram/diagram";
import { getOrThrow } from "@/shared/universal/get-or-throw";

import artifactJson from "../../../.architecture-companion/designs/dependency-graph.json";

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

function overlappingStraightLength(first: string, second: string, distance = 8) {
  let overlap = 0;
  for (const [ax, ay, bx, by] of straightSegments(first)) {
    for (const [cx, cy, dx, dy] of straightSegments(second)) {
      if (ax === bx && cx === dx && Math.abs(ax - cx) < distance) {
        overlap += Math.max(
          0,
          Math.min(Math.max(ay, by), Math.max(cy, dy)) - Math.max(Math.min(ay, by), Math.min(cy, dy)),
        );
      }
      if (ay === by && cy === dy && Math.abs(ay - cy) < distance) {
        overlap += Math.max(
          0,
          Math.min(Math.max(ax, bx), Math.max(cx, dx)) - Math.max(Math.min(ax, bx), Math.min(cx, dx)),
        );
      }
    }
  }
  return overlap;
}

async function focusedAggregateRoutes(focusId: string) {
  const diagram = parseDiagram(artifactJson);
  const sizes = Object.fromEntries(diagram.graph.nodes.map(({ id }) => [id, { width: 288, height: 100 }]));
  const layout = await layoutDependencyGraph(diagram.graph, sizes);
  const bounds = getDependencyElementBounds(layout);
  const projections = projectDependencyEdges(diagram.graph, { type: "group", id: focusId }).filter(
    (projection) => projection.type === "aggregate",
  );
  const endpointIds = new Set(projections.flatMap(({ sourceId, targetId }) => [sourceId, targetId]));
  const elements = new Map(
    [...layout.groups, ...layout.nodes.filter(({ id, parentId }) => !parentId || endpointIds.has(id))].map(
      ({ id }) => [id, getOrThrow(bounds.get(id), `Missing aggregate element: ${id}`)] as const,
    ),
  );
  const virtualGroups = new Map<string | undefined, NonNullable<ReturnType<typeof bounds.get>>>();
  for (const node of layout.nodes) {
    const current = getOrThrow(bounds.get(node.id), `Missing node bounds: ${node.id}`);
    const previous = virtualGroups.get(node.parentId);
    if (!previous) {
      virtualGroups.set(node.parentId, current);
      continue;
    }
    const left = Math.min(previous.position.x, current.position.x);
    const top = Math.min(previous.position.y, current.position.y);
    const right = Math.max(previous.position.x + previous.size.width, current.position.x + current.size.width);
    const bottom = Math.max(previous.position.y + previous.size.height, current.position.y + current.size.height);
    virtualGroups.set(node.parentId, {
      position: { x: left, y: top },
      size: { width: right - left, height: bottom - top },
    });
  }
  const routes = routeAggregateDependencyEdges(projections, elements, [...virtualGroups.values()]);
  return { projections, routes, bounds };
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

  it("allows point contacts and counts continuous overlap once across used segments", () => {
    const horizontal = (from: number, to: number) => ({
      from: { x: from, y: 0 },
      to: { x: to, y: 0 },
      axis: "horizontal" as const,
    });
    const vertical = (x: number, from: number, to: number) => ({
      from: { x, y: from },
      to: { x, y: to },
      axis: "vertical" as const,
    });
    const used = [horizontal(0, 60), horizontal(40, 100)];

    expect(measureAggregateSegmentCongestion(vertical(100, -50, 50), used)).toEqual({ overlapLength: 0, crossings: 0 });
    expect(measureAggregateSegmentCongestion(vertical(50, -50, 0), used)).toEqual({ overlapLength: 0, crossings: 0 });
    expect(measureAggregateSegmentCongestion(vertical(50, -50, 50), used)).toEqual({ overlapLength: 0, crossings: 1 });
    expect(measureAggregateSegmentCongestion(horizontal(0, 100), used)).toEqual({ overlapLength: 100, crossings: 0 });
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

    if (!route) throw new Error("Missing route around group");
    expect(route.path).toMatch(/^M .+ Q /);
    expect(route.labelPosition.x < 0 || route.labelPosition.x > 100).toBe(true);
  });

  it("routes around the boundary of a direct-node virtual group", () => {
    const distantTarget = { position: { x: 0, y: 500 }, size: target.size };
    const virtualGroup = { position: { x: -50, y: 200 }, size: { width: 200, height: 100 } };
    const route = routeAggregateDependencyEdges(
      [{ id: "aggregate", sourceId: "source", targetId: "target" }],
      new Map([
        ["source", source],
        ["target", distantTarget],
      ]),
      [virtualGroup],
    ).get("aggregate");

    if (!route) throw new Error("Missing route around virtual group");
    expect(route.path).toContain(" Q ");
    expect(route.labelPosition.x < -50 || route.labelPosition.x > 150).toBe(true);
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

  it("gives the shortest face-to-face edges the closest ports on each projected side", () => {
    const origin = { position: { x: 0, y: 0 }, size: { width: 300, height: 200 } };
    const elements = new Map([
      ["origin", origin],
      ["near-left", { position: { x: 60, y: 420 }, size: { width: 80, height: 80 } }],
      ["far-left", { position: { x: -140, y: 900 }, size: { width: 80, height: 80 } }],
      ["near-right", { position: { x: 260, y: 500 }, size: { width: 80, height: 80 } }],
      ["far-right", { position: { x: 380, y: 920 }, size: { width: 80, height: 80 } }],
    ]);
    const projections = ["far-left", "far-right", "near-left", "near-right"].map((id) => ({
      id,
      sourceId: "origin",
      targetId: id,
    }));
    const routes = routeAggregateDependencyEdges(projections, elements);
    const sourceX = (id: string) => {
      const start = routes.get(id)?.path.match(/^M ([-\d.]+) ([-\d.]+)/);
      if (!start) throw new Error(`Missing source port: ${id}`);
      return Number(start.at(1));
    };

    expect(sourceX("far-left")).toBeLessThan(sourceX("near-left"));
    expect(sourceX("near-left")).toBeLessThan(150);
    expect(sourceX("near-right")).toBeGreaterThan(150);
    expect(sourceX("near-right")).toBeLessThan(sourceX("far-right"));
    expect(150 - sourceX("near-left")).toBeLessThan(150 - sourceX("far-left"));
    expect(sourceX("near-right") - 150).toBeLessThan(sourceX("far-right") - 150);
  });

  it("uses facing side midpoints instead of group centers to rank incoming ports", () => {
    const routes = routeAggregateDependencyEdges(
      [
        { id: "center-near", sourceId: "center-near", targetId: "target" },
        { id: "face-near", sourceId: "face-near", targetId: "target" },
      ],
      new Map([
        ["target", { position: { x: 0, y: 800 }, size: { width: 300, height: 100 } }],
        ["center-near", { position: { x: -240, y: 450 }, size: { width: 80, height: 80 } }],
        ["face-near", { position: { x: -125, y: 0 }, size: { width: 500, height: 600 } }],
      ]),
    );
    const targetX = (id: string) => {
      const endpoint = routes.get(id)?.path.match(/ L ([-\d.]+) ([-\d.]+)$/);
      if (!endpoint) throw new Error(`Missing target port: ${id}`);
      return Number(endpoint.at(1));
    };

    expect(targetX("face-near")).toBeLessThan(150);
    expect(targetX("face-near")).toBeGreaterThan(targetX("center-near"));
  });

  it("uses the destination side midpoint when ranking departure ports", () => {
    const routes = routeAggregateDependencyEdges(
      [
        { id: "center-near", sourceId: "origin", targetId: "center-near" },
        { id: "face-near", sourceId: "origin", targetId: "face-near" },
      ],
      new Map([
        ["origin", { position: { x: 0, y: 0 }, size: { width: 300, height: 200 } }],
        ["center-near", { position: { x: 360, y: 450 }, size: { width: 80, height: 80 } }],
        ["face-near", { position: { x: 125, y: 400 }, size: { width: 80, height: 600 } }],
      ]),
    );
    const sourceX = (id: string) => {
      const start = routes.get(id)?.path.match(/^M ([-\d.]+) ([-\d.]+)/);
      if (!start) throw new Error(`Missing source port: ${id}`);
      return Number(start.at(1));
    };

    expect(sourceX("face-near")).toBeGreaterThan(150);
    expect(sourceX("face-near")).toBeLessThan(sourceX("center-near"));
  });

  it("ranks shared-side ports by Euclidean rather than Manhattan face-midpoint distance", () => {
    const routes = routeAggregateDependencyEdges(
      [
        { id: "far", sourceId: "origin", targetId: "far" },
        { id: "near", sourceId: "origin", targetId: "near" },
      ],
      new Map([
        ["origin", { position: { x: 0, y: 0 }, size: { width: 300, height: 200 } }],
        ["near", { position: { x: 310, y: 460 }, size: { width: 80, height: 80 } }],
        ["far", { position: { x: 125, y: 610 }, size: { width: 80, height: 80 } }],
      ]),
    );
    const sourceX = (id: string) => {
      const start = routes.get(id)?.path.match(/^M ([-\d.]+) ([-\d.]+)/);
      if (!start) throw new Error(`Missing source port: ${id}`);
      return Number(start.at(1));
    };

    expect(sourceX("near")).toBeGreaterThan(150);
    expect(sourceX("near")).toBeLessThan(sourceX("far"));
  });

  it("keeps 32px port gaps unless the face needs tighter spacing", () => {
    const sourcePorts = (width: number) => {
      const centerX = width / 2;
      const projections = [0, 1, 2].map((index) => ({
        id: `edge${index}`,
        sourceId: "origin",
        targetId: `target${index}`,
      }));
      const elements = new Map([
        ["origin", { position: { x: 0, y: 0 }, size: { width, height: 200 } }],
        ...projections.map(
          ({ targetId }, index) =>
            [
              targetId,
              { position: { x: centerX + 20 + index * 5, y: 420 + index * 100 }, size: { width: 80, height: 80 } },
            ] as const,
        ),
      ]);
      const routes = routeAggregateDependencyEdges(projections, elements);
      return projections.map(({ id }) => {
        const start = routes.get(id)?.path.match(/^M ([-\d.]+) ([-\d.]+)/);
        if (!start) throw new Error(`Missing source port: ${id}`);
        return Number(start.at(1));
      });
    };
    const wide = sourcePorts(300);
    const narrow = sourcePorts(100);

    expect(wide.at(1)! - wide.at(0)!).toBe(32);
    expect(wide.at(2)! - wide.at(1)!).toBe(32);
    expect(narrow.at(1)! - narrow.at(0)!).toBeGreaterThan(0);
    expect(narrow.at(1)! - narrow.at(0)!).toBeLessThan(32);
    expect(narrow.at(2)! - narrow.at(1)!).toBeCloseTo(narrow.at(1)! - narrow.at(0)!);
  });

  it("orders tied destination ports by the approaching tracks", () => {
    const elements = new Map([
      ["client", { position: { x: 0, y: 0 }, size: { width: 300, height: 300 } }],
      ["parts", { position: { x: 50, y: 50 }, size: { width: 200, height: 210 } }],
      ["server", { position: { x: 30, y: 360 }, size: { width: 500, height: 350 } }],
      ["features", { position: { x: 0, y: 900 }, size: { width: 300, height: 120 } }],
    ]);
    const routes = routeAggregateDependencyEdges(
      [
        { id: "client-features", sourceId: "client", targetId: "features" },
        { id: "parts-features", sourceId: "parts", targetId: "features" },
      ],
      elements,
    );
    const targetX = (id: string) => {
      const path = routes.get(id)?.path;
      const last = path?.match(/ L ([-\d.]+) ([-\d.]+)$/);
      if (!last) throw new Error(`Missing aggregate destination: ${id}`);
      return Number(last.at(1));
    };

    expect(targetX("parts-features")).toBeLessThan(targetX("client-features"));
  });

  it("prioritizes focused features' arrivals by facing-side distance", async () => {
    const featuresId = "group:directory:src/features";
    const { projections, routes, bounds } = await focusedAggregateRoutes(featuresId);
    const targetX = (sourceId: string) => {
      const projection = projections.find((edge) => edge.sourceId === sourceId && edge.targetId === featuresId);
      if (!projection) throw new Error(`Missing features edge: ${sourceId}`);
      const route = getOrThrow(routes.get(projection.id), `Missing features route: ${sourceId}`);
      const endpoint = route.path.match(/ L ([-\d.]+) ([-\d.]+)$/);
      if (!endpoint) throw new Error(`Missing features port: ${sourceId}`);
      return Number(endpoint.at(1));
    };

    const features = getOrThrow(bounds.get(featuresId), "Missing features bounds");
    const centerX = features.position.x + features.size.width / 2;
    expect(targetX("group:directory:src/client/pages")).toBeLessThan(centerX);
    expect(Math.abs(targetX("group:directory:src/client") - centerX)).toBeLessThan(
      Math.abs(targetX("group:directory:src/client/parts") - centerX),
    );
  });

  it("gives the two nearest incoming edges to focused shared distinct center-nearest ports", async () => {
    const sharedId = "group:directory:src/shared";
    const diagramId = "group:directory:src/features/diagram";
    const layoutId = "group:directory:src/features/diagram/_layout";
    const { projections, routes, bounds } = await focusedAggregateRoutes(sharedId);
    const ports = projections
      .filter(({ targetId }) => targetId === sharedId)
      .map(({ id, sourceId }) => {
        const endpoint = routes.get(id)?.path.match(/ L ([-\d.]+) ([-\d.]+)$/);
        if (!endpoint) throw new Error(`Missing shared port: ${sourceId}`);
        return { sourceId, x: Number(endpoint.at(1)) };
      });
    const shared = getOrThrow(bounds.get(sharedId), "Missing shared bounds");
    const centerX = shared.position.x + shared.size.width / 2;
    const nearest = ports.toSorted((a, b) => Math.abs(a.x - centerX) - Math.abs(b.x - centerX)).slice(0, 2);

    expect(new Set(nearest.map(({ sourceId }) => sourceId))).toEqual(new Set([diagramId, layoutId]));
    expect(nearest.at(0)?.x).not.toBe(nearest.at(1)?.x);
  });

  it("places the focused client's closer departure nearer its center", async () => {
    const clientId = "group:directory:src/client";
    const { projections, routes, bounds } = await focusedAggregateRoutes(clientId);
    const sourceX = (targetId: string) => {
      const projection = projections.find((edge) => edge.sourceId === clientId && edge.targetId === targetId);
      if (!projection) throw new Error(`Missing client edge: ${targetId}`);
      const route = getOrThrow(routes.get(projection.id), `Missing client route: ${targetId}`);
      const start = route.path.match(/^M ([-\d.]+) ([-\d.]+)/);
      if (!start) throw new Error(`Missing client port: ${targetId}`);
      return Number(start.at(1));
    };

    const client = getOrThrow(bounds.get(clientId), "Missing client bounds");
    const centerX = client.position.x + client.size.width / 2;
    const layoutPort = sourceX("group:directory:src/features/diagram/_layout");
    expect(layoutPort).toBeLessThan(centerX);
    expect(Math.abs(layoutPort - centerX)).toBeLessThan(
      Math.abs(sourceX("group:directory:src/shared/react-ui") - centerX),
    );
  });

  it("separates routes in a crowded corridor by narrowing their track spacing", () => {
    const origin = { position: { x: 0, y: 0 }, size: { width: 600, height: 100 } };
    const middle = { position: { x: 150, y: 292 }, size: { width: 700, height: 100 } };
    const destinations = Array.from(
      { length: 8 },
      (_, index) =>
        [
          `destination${index}`,
          { position: { x: 1000 + index * 120, y: 600 }, size: { width: 80, height: 80 } },
        ] as const,
    );
    const projections = destinations.map(([id]) => ({ id, sourceId: "origin", targetId: id }));
    const routes = routeAggregateDependencyEdges(
      projections,
      new Map([["origin", origin] as const, ["middle", middle] as const, ...destinations]),
    );
    const paths = projections.map(({ id }) => {
      const route = routes.get(id);
      if (!route) throw new Error(`Missing route: ${id}`);
      return route.path;
    });
    const overlaps = paths.flatMap((path, index) =>
      paths.slice(index + 1).map((other) => overlappingStraightLength(path, other, 2.1)),
    );
    const corridorTracks = paths.flatMap((path) =>
      straightSegments(path).flatMap(([fromX, fromY, toX, toY]) =>
        fromY === toY && fromY > 100 && fromY < 292 && Math.min(fromX, toX) < 600 && Math.max(fromX, toX) > 600
          ? [fromY]
          : [],
      ),
    );

    const orderedTracks = corridorTracks.toSorted((a, b) => a - b);
    const smallestGap = Math.min(...orderedTracks.slice(1).map((track, index) => track - orderedTracks[index]!));
    expect(overlaps.every((length) => length === 0)).toBe(true);
    expect(corridorTracks.length).toBe(8);
    expect(smallestGap).toBeGreaterThanOrEqual(2.1);
    expect(smallestGap).toBeLessThan(32);
  });

  it("separates vertical tracks in a crowded passage", () => {
    const origin = { position: { x: 0, y: 0 }, size: { width: 100, height: 600 } };
    const middle = { position: { x: 292, y: 150 }, size: { width: 100, height: 700 } };
    const destinations = Array.from(
      { length: 8 },
      (_, index) =>
        [
          `destination${index}`,
          { position: { x: 600, y: 1000 + index * 120 }, size: { width: 80, height: 80 } },
        ] as const,
    );
    const projections = destinations.map(([id]) => ({ id, sourceId: "origin", targetId: id }));
    const routes = routeAggregateDependencyEdges(
      projections,
      new Map([["origin", origin] as const, ["middle", middle] as const, ...destinations]),
    );
    const paths = projections.map(({ id }) => {
      const route = routes.get(id);
      if (!route) throw new Error(`Missing route: ${id}`);
      return route.path;
    });
    const corridorTracks = paths.flatMap((path) =>
      straightSegments(path).flatMap(([fromX, fromY, toX, toY]) =>
        fromX === toX && fromX > 100 && fromX < 292 && Math.min(fromY, toY) < 700 && Math.max(fromY, toY) > 700
          ? [fromX]
          : [],
      ),
    );
    const orderedTracks = corridorTracks.toSorted((a, b) => a - b);
    const smallestGap = Math.min(...orderedTracks.slice(1).map((track, index) => track - orderedTracks[index]!));

    expect(
      paths
        .flatMap((path, index) => paths.slice(index + 1).map((other) => overlappingStraightLength(path, other, 2.1)))
        .every((length) => length === 0),
    ).toBe(true);
    expect(corridorTracks.length).toBe(8);
    expect(smallestGap).toBeGreaterThanOrEqual(2.1);
    expect(smallestGap).toBeLessThan(32);
  });

  it("keeps ports and routes stable when projections arrive in another order", () => {
    const elements = new Map([
      ["origin", { position: { x: 0, y: 0 }, size: { width: 320, height: 280 } }],
      ["one", { position: { x: 500, y: 0 }, size: { width: 160, height: 100 } }],
      ["two", { position: { x: 500, y: 200 }, size: { width: 160, height: 100 } }],
    ]);
    const projections = [
      { id: "out-one", sourceId: "origin", targetId: "one" },
      { id: "out-two", sourceId: "origin", targetId: "two" },
      { id: "in-one", sourceId: "one", targetId: "origin" },
    ];
    const forward = routeAggregateDependencyEdges(projections, elements);
    const reverse = routeAggregateDependencyEdges(projections.toReversed(), elements);

    for (const { id } of projections) expect(forward.get(id)).toEqual(reverse.get(id));
  });

  it("uses wide bends when both neighboring segments leave enough room", () => {
    const routes = routeAggregateDependencyEdges(
      [{ id: "diagonal", sourceId: "origin", targetId: "destination" }],
      new Map([
        ["origin", { position: { x: 0, y: 0 }, size: { width: 100, height: 100 } }],
        ["destination", { position: { x: 600, y: 400 }, size: { width: 100, height: 100 } }],
      ]),
    );
    const path = routes.get("diagonal")?.path;
    if (!path) throw new Error("Missing diagonal route");
    const commands = [...path.matchAll(/([MLQ]) ([-\d.]+) ([-\d.]+)(?: ([-\d.]+) ([-\d.]+))?/g)];
    const radii = commands.flatMap(([_, command, x, y], index) => {
      if (command !== "Q") return [];
      const entry = commands[index - 1];
      if (!entry) throw new Error("Missing rounded corner entry");
      return [Math.hypot(Number(x) - Number(entry.at(2)), Number(y) - Number(entry.at(3)))];
    });

    expect(radii.length).toBeGreaterThan(0);
    expect(Math.max(...radii)).toBeGreaterThan(14);
    expect(Math.max(...radii)).toBeLessThanOrEqual(96);
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
      expect(Math.max(...ordinates)).toBeLessThan(server.position.y + server.size.height / 2);
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
