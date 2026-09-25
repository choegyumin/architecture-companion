import {
  type AggregateEdgeRoute,
  measureAggregateSegmentCongestion,
  routeAggregateDependencyEdges,
} from "@/client/widgets/dependency-graph-aggregate-routes";
import { getDependencyElementBounds, routeOriginalDependencyEdge } from "@/client/widgets/dependency-graph-edge-routes";
import {
  onBoundary,
  pathEndpoints,
  pathEntersBounds,
  pathsCross,
  pathsOverlap,
} from "@/client/widgets/dependency-graph-route-test-geometry";
import { layoutDependencyGraph } from "@/features/diagram/_layout/dependency-graph-layout";
import { projectDependencyEdges } from "@/features/diagram/dependency-edge-projection";
import { parseDiagram } from "@/features/diagram/diagram";
import type { DiagramLayout, DiagramLayoutGroup } from "@/features/diagram/diagram-spatial";
import { getOrThrow } from "@/shared/universal/get-or-throw";

import artifactJson from "../../../.architecture-companion/designs/dependency-graph.json";

const source = { position: { x: 0, y: 0 }, size: { width: 100, height: 60 } };
const target = { position: { x: 0, y: 220 }, size: { width: 100, height: 60 } };
const points = [
  { x: 50, y: 60 },
  { x: 50, y: 220 },
];

function layoutForGroups(
  elements: ReadonlyMap<string, Pick<DiagramLayoutGroup, "position" | "size">>,
  parentIds: ReadonlyMap<string, string> = new Map(),
): DiagramLayout {
  return {
    groups: [...elements].map(([id, bounds]) => ({ id, ...bounds, parentId: parentIds.get(id) })),
    nodes: [],
    edges: [],
    initialView: { mode: "fit" },
  };
}

function routeBetween(elements: ReadonlyMap<string, typeof source>) {
  return routeAggregateDependencyEdges(
    [{ id: "aggregate", sourceId: "source", targetId: "target" }],
    layoutForGroups(elements),
  ).get("aggregate");
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

function renderedPoints(path: string): Array<readonly [number, number]> {
  const points: Array<readonly [number, number]> = [];
  let previous: readonly [number, number] | undefined;
  for (const [, command, x, y, endX, endY] of path.matchAll(/([MLQ]) ([-\d.]+) ([-\d.]+)(?: ([-\d.]+) ([-\d.]+))?/g)) {
    const point: readonly [number, number] = [Number(x), Number(y)];
    if (command === "M") points.push(point);
    if (command === "Q" && previous) {
      const end: readonly [number, number] = [Number(endX), Number(endY)];
      for (let step = 1; step <= 16; step += 1) {
        const t = step / 16;
        points.push([
          (1 - t) ** 2 * previous.at(0)! + 2 * (1 - t) * t * point.at(0)! + t ** 2 * end.at(0)!,
          (1 - t) ** 2 * previous.at(1)! + 2 * (1 - t) * t * point.at(1)! + t ** 2 * end.at(1)!,
        ]);
      }
      previous = end;
    } else {
      if (command === "L") points.push(point);
      previous = point;
    }
  }
  return points;
}

function ordinateAtX(path: string, x: number): number[] {
  const points = renderedPoints(path);
  return points.slice(1).flatMap((end, index) => {
    const start = points.at(index)!;
    if (start.at(0) === end.at(0) || x <= Math.min(start.at(0)!, end.at(0)!) || x >= Math.max(start.at(0)!, end.at(0)!))
      return [];
    return [start.at(1)! + ((x - start.at(0)!) * (end.at(1)! - start.at(1)!)) / (end.at(0)! - start.at(0)!)];
  });
}

type AggregateProjection = Readonly<{ id: string; sourceId: string; targetId: string }>;
type ReadabilityOptions = Readonly<{
  // Accept extended-budget detours: the plan is still connected and legible, but the
  // normal budget could not fit it. Port separation, overlap, and crossing checks stay.
  allowDetour?: boolean;
  // Source-id pairs whose crossing is a known router limitation (crossing-cost
  // minimization cannot remove it under the current port-slot ordering).
  toleratedCrossings?: readonly (readonly [string, string])[];
}>;

function expectReadableRoutes(
  projections: readonly AggregateProjection[],
  routes: ReadonlyMap<string, AggregateEdgeRoute>,
  bounds: ReturnType<typeof getDependencyElementBounds>,
  { allowDetour = false, toleratedCrossings = [] }: ReadabilityOptions = {},
): void {
  for (const { id, sourceId, targetId } of projections) {
    const route = getOrThrow(routes.get(id), `Missing normal route: ${id}`);
    const { start, end } = pathEndpoints(route.path);
    expect(allowDetour ? ["normal", "detour"] : ["normal"]).toContain(route.routing.stage);
    expect(onBoundary(start, getOrThrow(bounds.get(sourceId), `Missing source: ${sourceId}`))).toBe(true);
    expect(onBoundary(end, getOrThrow(bounds.get(targetId), `Missing target: ${targetId}`))).toBe(true);
  }
  for (const [index, first] of projections.entries()) {
    for (const second of projections.slice(index + 1)) {
      const a = getOrThrow(routes.get(first.id), `Missing route: ${first.id}`);
      const b = getOrThrow(routes.get(second.id), `Missing route: ${second.id}`);
      if (first.sourceId === second.sourceId)
        expect(pathEndpoints(a.path).start).not.toEqual(pathEndpoints(b.path).start);
      if (first.targetId === second.targetId) expect(pathEndpoints(a.path).end).not.toEqual(pathEndpoints(b.path).end);
      const crossingTolerated = toleratedCrossings.some(
        ([firstSource, secondSource]) =>
          (firstSource === first.sourceId && secondSource === second.sourceId) ||
          (firstSource === second.sourceId && secondSource === first.sourceId),
      );
      expect(pathsCross(a.path, b.path) && !crossingTolerated).toBe(false);
      expect(overlappingStraightLength(a.path, b.path, 2.1)).toBe(0);
      expect(pathsOverlap(a.path, b.path)).toBe(false);
    }
  }
}

async function focusedAggregateRoutes(focusId: string) {
  const diagram = parseDiagram(artifactJson);
  const sizes = Object.fromEntries(diagram.graph.nodes.map(({ id }) => [id, { width: 288, height: 100 }]));
  const layout = await layoutDependencyGraph(diagram.graph, sizes);
  const bounds = getDependencyElementBounds(layout);
  const projections = projectDependencyEdges(diagram.graph, { type: "group", id: focusId }).filter(
    (projection) => projection.type === "aggregate",
  );
  const routes = routeAggregateDependencyEdges(projections, layout);
  return { projections, routes, bounds };
}

async function expectFocusedRelations(
  focusId: string,
  pairs: readonly (readonly [string, string])[],
  options: ReadabilityOptions = {},
): Promise<void> {
  const { projections, routes, bounds } = await focusedAggregateRoutes(focusId);
  const selected = pairs.map(([sourceId, targetId]) => {
    const projection = projections.find((edge) => edge.sourceId === sourceId && edge.targetId === targetId);
    return getOrThrow(projection, `Missing focused relation: ${sourceId} → ${targetId}`);
  });
  expectReadableRoutes(selected, routes, bounds, options);
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
    expect(route.routing.stage).toBe("normal");
    expect(pathEntersBounds(route.path, interveningGroup)).toBe(false);
    expect(route.labelPosition.x < 0 || route.labelPosition.x > 100).toBe(true);
  });

  it("routes around the boundary of a direct-node virtual group", () => {
    const distantTarget = { position: { x: 0, y: 500 }, size: target.size };
    const layout: DiagramLayout = {
      groups: [
        { id: "container", position: { x: -200, y: -100 }, size: { width: 500, height: 800 } },
        { id: "source", parentId: "container", position: { x: 200, y: 100 }, size: source.size },
        { id: "target", parentId: "container", position: { x: 200, y: 600 }, size: distantTarget.size },
      ],
      nodes: [
        { id: "left-card", parentId: "container", position: { x: 150, y: 300 }, size: { width: 100, height: 100 } },
        { id: "right-card", parentId: "container", position: { x: 250, y: 300 }, size: { width: 100, height: 100 } },
      ],
      edges: [],
      initialView: { mode: "fit" },
    };
    const route = routeAggregateDependencyEdges(
      [{ id: "aggregate", sourceId: "source", targetId: "target" }],
      layout,
    ).get("aggregate");

    if (!route) throw new Error("Missing route around virtual group");
    expect(route.routing.stage).toBe("normal");
    expect(pathEntersBounds(route.path, { position: { x: -50, y: 200 }, size: { width: 200, height: 100 } })).toBe(
      false,
    );
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
    const layout = layoutForGroups(elements);
    const routes = routeAggregateDependencyEdges(projections, layout);
    const bounds = getDependencyElementBounds(layout);
    const serverPorts = projections.map(({ id }) => {
      const route = getOrThrow(routes.get(id), `Missing route: ${id}`);
      return id.startsWith("out-") ? pathEndpoints(route.path).start : pathEndpoints(route.path).end;
    });

    expectReadableRoutes(projections, routes, bounds);
    expect(new Set(serverPorts.map(({ x, y }) => `${x}:${y}`)).size).toBe(6);
  });

  it("separates four outbound paths to near and far destinations", () => {
    expect.hasAssertions();
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
    const layout = layoutForGroups(elements);
    const routes = routeAggregateDependencyEdges(projections, layout);

    expectReadableRoutes(projections, routes, getDependencyElementBounds(layout));
  });

  it("keeps incoming paths separate when a wide source hides their center order", () => {
    expect.hasAssertions();
    const projections = [
      { id: "center-near", sourceId: "center-near", targetId: "target" },
      { id: "face-near", sourceId: "face-near", targetId: "target" },
    ];
    const layout = layoutForGroups(
      new Map([
        ["target", { position: { x: 0, y: 800 }, size: { width: 300, height: 100 } }],
        ["center-near", { position: { x: -240, y: 450 }, size: { width: 80, height: 80 } }],
        ["face-near", { position: { x: -125, y: 0 }, size: { width: 500, height: 600 } }],
      ]),
    );

    expectReadableRoutes(
      projections,
      routeAggregateDependencyEdges(projections, layout),
      getDependencyElementBounds(layout),
    );
  });

  it("keeps outward paths separate when a tall target hides their center order", () => {
    expect.hasAssertions();
    const projections = [
      { id: "center-near", sourceId: "origin", targetId: "center-near" },
      { id: "face-near", sourceId: "origin", targetId: "face-near" },
    ];
    const layout = layoutForGroups(
      new Map([
        ["origin", { position: { x: 0, y: 0 }, size: { width: 300, height: 200 } }],
        ["center-near", { position: { x: 310, y: 450 }, size: { width: 80, height: 80 } }],
        ["face-near", { position: { x: 125, y: 400 }, size: { width: 80, height: 600 } }],
      ]),
    );

    expectReadableRoutes(
      projections,
      routeAggregateDependencyEdges(projections, layout),
      getDependencyElementBounds(layout),
    );
  });

  it("keeps diagonal departures separate regardless of face-midpoint distance", () => {
    expect.hasAssertions();
    const projections = [
      { id: "far", sourceId: "origin", targetId: "far" },
      { id: "near", sourceId: "origin", targetId: "near" },
    ];
    const layout = layoutForGroups(
      new Map([
        ["origin", { position: { x: 0, y: 0 }, size: { width: 300, height: 200 } }],
        ["near", { position: { x: 310, y: 460 }, size: { width: 80, height: 80 } }],
        ["far", { position: { x: 125, y: 610 }, size: { width: 80, height: 80 } }],
      ]),
    );

    expectReadableRoutes(
      projections,
      routeAggregateDependencyEdges(projections, layout),
      getDependencyElementBounds(layout),
    );
  });

  it("separates centered arrivals and departures around the same blocker", () => {
    const elements = new Map([
      ["near", { position: { x: 0, y: 0 }, size: { width: 300, height: 100 } }],
      ["far", { position: { x: 0, y: 160 }, size: { width: 300, height: 100 } }],
      ["group", { position: { x: 0, y: 900 }, size: { width: 300, height: 100 } }],
      ["blocker", { position: { x: -500, y: 400 }, size: { width: 720, height: 200 } }],
    ]);
    const layout = layoutForGroups(elements);
    const bounds = getDependencyElementBounds(layout);
    for (const projections of [
      ["near", "far"].map((id) => ({ id, sourceId: id, targetId: "group" })),
      ["near", "far"].map((id) => ({ id, sourceId: "group", targetId: id })),
    ]) {
      const routes = routeAggregateDependencyEdges(projections, layout);
      expectReadableRoutes(projections, routes, bounds);
      for (const { id } of projections) {
        expect(
          pathEntersBounds(getOrThrow(routes.get(id), `Missing route: ${id}`).path, elements.get("blocker")!),
        ).toBe(false);
      }
    }
  });

  it("fits three readable departures on wide and narrow source bounds", () => {
    for (const width of [300, 100]) {
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
      const layout = layoutForGroups(elements);
      const routes = routeAggregateDependencyEdges(projections, layout);
      const starts = projections.map(
        ({ id }) => pathEndpoints(getOrThrow(routes.get(id), `Missing route: ${id}`).path).start,
      );

      // The outermost departure only fits on the extended budget; port separation,
      // overlap, and crossing checks still apply.
      expectReadableRoutes(projections, routes, getDependencyElementBounds(layout), { allowDetour: true });
      for (const [index, first] of starts.entries()) {
        for (const second of starts.slice(index + 1)) {
          expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThan(2.1);
        }
      }
    }
  });

  it("gives nested and outer sources separate arrivals beyond an intervening group", () => {
    const elements = new Map([
      ["client", { position: { x: 0, y: 0 }, size: { width: 300, height: 300 } }],
      ["parts", { position: { x: 50, y: 50 }, size: { width: 200, height: 210 } }],
      ["server", { position: { x: 30, y: 360 }, size: { width: 500, height: 350 } }],
      ["features", { position: { x: 0, y: 900 }, size: { width: 300, height: 120 } }],
    ]);
    const projections = [
      { id: "client-features", sourceId: "client", targetId: "features" },
      { id: "parts-features", sourceId: "parts", targetId: "features" },
    ];
    const layout = layoutForGroups(elements, new Map([["parts", "client"]]));
    const routes = routeAggregateDependencyEdges(projections, layout);

    expectReadableRoutes(projections, routes, getDependencyElementBounds(layout));
    for (const { id } of projections) {
      expect(pathEntersBounds(getOrThrow(routes.get(id), `Missing route: ${id}`).path, elements.get("server")!)).toBe(
        false,
      );
    }
  });

  it("keeps focused features' client arrivals distinct and uncrossed", async () => {
    expect.hasAssertions();
    const featuresId = "group:directory:src/features";
    // TODO(port-slots): the pages/parts crossing survives crossing-cost minimization
    // because mixed arrival faces need an ordering the current slot solver cannot express.
    await expectFocusedRelations(
      featuresId,
      [
        ["group:directory:src/client/pages", featuresId],
        ["group:directory:src/client", featuresId],
        ["group:directory:src/client/parts", featuresId],
      ],
      {
        allowDetour: true,
        toleratedCrossings: [["group:directory:src/client/pages", "group:directory:src/client/parts"]],
      },
    );
  });

  it("keeps focused shared's diagram and layout arrivals distinct", async () => {
    expect.hasAssertions();
    const sharedId = "group:directory:src/shared";
    await expectFocusedRelations(sharedId, [
      ["group:directory:src/features/diagram", sharedId],
      ["group:directory:src/features/diagram/_layout", sharedId],
    ]);
  });

  it("fans out focused cli and plugins departures without reusing tracks", async () => {
    expect.hasAssertions();
    const cases = [
      {
        sourceId: "group:directory:src/cli",
        targets: [
          "group:directory:src/server",
          "group:directory:src/features/diagram-generator",
          "group:directory:src/shared/node",
        ],
      },
      {
        sourceId: "group:directory:src/plugins",
        targets: ["group:directory:src/features/diagram", "group:directory:src/shared/node", "group:external-packages"],
      },
    ] as const;
    for (const { sourceId, targets } of cases) {
      await expectFocusedRelations(
        sourceId,
        targets.map((targetId) => [sourceId, targetId] as const),
      );
    }
  });

  it("keeps focused annotation's local and external departures legible", async () => {
    expect.hasAssertions();
    const annotationId = "group:directory:src/features/annotation";
    await expectFocusedRelations(annotationId, [
      [annotationId, "group:external-packages"],
      [annotationId, "group:directory:src/features/artifact"],
    ]);
  });

  it("keeps focused annotation's client arrivals distinct and uncrossed", async () => {
    expect.hasAssertions();
    const annotationId = "group:directory:src/features/annotation";
    // TODO(port-slots): client's top approach crosses widgets' below-annotation wrap;
    // mixed arrival faces need an ordering the current slot solver cannot express.
    await expectFocusedRelations(
      annotationId,
      [
        ["group:directory:src/client", annotationId],
        ["group:directory:src/client/widgets", annotationId],
        ["group:directory:src/client/pages", annotationId],
      ],
      {
        toleratedCrossings: [["group:directory:src/client", "group:directory:src/client/widgets"]],
      },
    );
  });

  it("separates focused features' universal and external departures", async () => {
    expect.hasAssertions();
    const featuresId = "group:directory:src/features";
    await expectFocusedRelations(featuresId, [
      [featuresId, "group:directory:src/shared/universal"],
      [featuresId, "group:external-packages"],
    ]);
  });

  it("separates focused client's layout and shared departures", async () => {
    expect.hasAssertions();
    const clientId = "group:directory:src/client";
    await expectFocusedRelations(clientId, [
      [clientId, "group:directory:src/features/diagram/_layout"],
      [clientId, "group:directory:src/shared/react-ui"],
    ]);
  });

  it("separates routes in a crowded corridor by narrowing their track spacing", () => {
    const origin = { position: { x: 0, y: 0 }, size: { width: 600, height: 100 } };
    const middle = { position: { x: 150, y: 292 }, size: { width: 700, height: 100 } };
    const upper = { position: { x: 600, y: -200 }, size: { width: 250, height: 300 } };
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
      layoutForGroups(
        new Map([["origin", origin] as const, ["middle", middle] as const, ["upper", upper] as const, ...destinations]),
      ),
    );
    const paths = projections.map(({ id }) => {
      const route = routes.get(id);
      if (!route) throw new Error(`Missing route: ${id}`);
      expect(route.routing.stage).toBe("normal");
      return route.path;
    });
    const overlaps = paths.flatMap((path, index) =>
      paths.slice(index + 1).map((other) => overlappingStraightLength(path, other, 2.1)),
    );
    // Rounded corners may swing across the probe line, so measure the rendered ordinate.
    const corridorTracks = paths.flatMap((path) => ordinateAtX(path, 600).filter((y) => y > 100 && y < 292));

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
    const upper = { position: { x: -200, y: 600 }, size: { width: 300, height: 250 } };
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
      layoutForGroups(
        new Map([["origin", origin] as const, ["middle", middle] as const, ["upper", upper] as const, ...destinations]),
      ),
    );
    const paths = projections.map(({ id }) => {
      const route = routes.get(id);
      if (!route) throw new Error(`Missing route: ${id}`);
      expect(route.routing.stage).toBe("normal");
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
    const layout = layoutForGroups(elements);
    const forward = routeAggregateDependencyEdges(projections, layout);
    const reverse = routeAggregateDependencyEdges(projections.toReversed(), layout);

    for (const { id } of projections) expect(forward.get(id)).toEqual(reverse.get(id));
  });

  it("uses wide bends when both neighboring segments leave enough room", () => {
    const routes = routeAggregateDependencyEdges(
      [{ id: "diagonal", sourceId: "origin", targetId: "destination" }],
      layoutForGroups(
        new Map([
          ["origin", { position: { x: 0, y: 0 }, size: { width: 100, height: 100 } }],
          ["destination", { position: { x: 600, y: 400 }, size: { width: 100, height: 100 } }],
        ]),
      ),
    );
    const route = getOrThrow(routes.get("diagonal"), "Missing diagonal route");
    expect(route.routing.stage).toBe("normal");
    const commands = [...route.path.matchAll(/([MLQ]) ([-\d.]+) ([-\d.]+)(?: ([-\d.]+) ([-\d.]+))?/g)];
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
    const layout: DiagramLayout = {
      groups: [
        { id: "server", ...server },
        { id: "tooling", ...tooling },
      ],
      nodes: [{ id: "root", ...root }],
      edges: [],
      initialView: { mode: "fit" },
    };
    const routes = routeAggregateDependencyEdges(
      [
        { id: "server-tooling", sourceId: "server", targetId: "tooling" },
        { id: "tooling-server", sourceId: "tooling", targetId: "server" },
      ],
      layout,
    );
    const forward = routes.get("server-tooling");
    const reverse = routes.get("tooling-server");
    if (!forward || !reverse) throw new Error("Missing reciprocal routes");

    expectReadableRoutes(
      [
        { id: "server-tooling", sourceId: "server", targetId: "tooling" },
        { id: "tooling-server", sourceId: "tooling", targetId: "server" },
      ],
      routes,
      getDependencyElementBounds(layout),
    );
    expect(pathEndpoints(forward.path).start).not.toEqual(pathEndpoints(reverse.path).end);
    expect(overlappingStraightLength(forward.path, reverse.path)).toBeLessThan(40);
  });

  it("does not send later aggregate pairs around the far edge of a large group", () => {
    const server = { position: { x: 464, y: 2734 }, size: { width: 352, height: 2454 } };
    const tooling = { position: { x: 880, y: 2734 }, size: { width: 352, height: 348 } };
    const integrations = { position: { x: 1296, y: 2734 }, size: { width: 352, height: 348 } };
    const root = { position: { x: 1712, y: 2734 }, size: { width: 288, height: 58 } };
    const layout: DiagramLayout = {
      groups: [
        { id: "server", ...server },
        { id: "tooling", ...tooling },
        { id: "integrations", ...integrations },
      ],
      nodes: [{ id: "root", ...root }],
      edges: [],
      initialView: { mode: "fit" },
    };
    const routes = routeAggregateDependencyEdges(
      [
        { id: "server-root", sourceId: "server", targetId: "root" },
        { id: "root-server", sourceId: "root", targetId: "server" },
        { id: "server-tooling", sourceId: "server", targetId: "tooling" },
        { id: "tooling-server", sourceId: "tooling", targetId: "server" },
        { id: "server-integrations", sourceId: "server", targetId: "integrations" },
        { id: "integrations-server", sourceId: "integrations", targetId: "server" },
      ],
      layout,
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
    for (const id of ["server-integrations", "integrations-server"]) {
      const route = getOrThrow(routes.get(id), `Missing route: ${id}`);
      expect(route.routing.stage).toBe("normal");
      expect(pathEntersBounds(route.path, tooling)).toBe(false);
    }
  });
});
