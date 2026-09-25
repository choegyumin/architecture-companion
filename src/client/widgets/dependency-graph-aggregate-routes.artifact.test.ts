import { routeAggregateDependencyEdges } from "@/client/widgets/dependency-graph-aggregate-routes";
import { getDependencyElementBounds } from "@/client/widgets/dependency-graph-edge-routes";
import { layoutDependencyGraph } from "@/features/diagram/_layout/dependency-graph-layout";
import { type DependencyEdgeProjection, projectDependencyEdges } from "@/features/diagram/dependency-edge-projection";
import { parseDiagram } from "@/features/diagram/diagram";
import { getOrThrow } from "@/shared/universal/get-or-throw";

import artifactJson from "../../../.architecture-companion/designs/dependency-graph.json";

function routeOrdinateRange(path: string): readonly [number, number] {
  const ordinates = [...path.matchAll(/[MLQ] [-\d.]+ ([-\d.]+)/g)].map((match) => Number(match.at(1)));
  return [Math.min(...ordinates), Math.max(...ordinates)];
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

function renderedSegments(path: string) {
  const segments: Array<readonly [number, number, number, number]> = [];
  let previous: readonly [number, number] | undefined;
  for (const [, command, x, y, endX, endY] of path.matchAll(/([MLQ]) ([-\d.]+) ([-\d.]+)(?: ([-\d.]+) ([-\d.]+))?/g)) {
    const point = [Number(x), Number(y)] as const;
    if (command === "L" && previous) segments.push([...previous, ...point]);
    if (command === "Q" && previous) {
      const [fromX, fromY] = previous;
      let prior = previous;
      for (let step = 1; step <= 20; step += 1) {
        const t = step / 20;
        const next = [
          (1 - t) ** 2 * fromX + 2 * (1 - t) * t * Number(x) + t ** 2 * Number(endX),
          (1 - t) ** 2 * fromY + 2 * (1 - t) * t * Number(y) + t ** 2 * Number(endY),
        ] as const;
        segments.push([...prior, ...next]);
        prior = next;
      }
    }
    previous = command === "Q" ? [Number(endX), Number(endY)] : point;
  }
  return segments;
}

function pathsCross(first: string, second: string): boolean {
  for (const [ax, ay, bx, by] of renderedSegments(first)) {
    for (const [cx, cy, dx, dy] of renderedSegments(second)) {
      const vx = bx - ax;
      const vy = by - ay;
      const wx = dx - cx;
      const wy = dy - cy;
      const denominator = vx * wy - vy * wx;
      if (Math.abs(denominator) < 0.000001) continue;
      const t = ((cx - ax) * wy - (cy - ay) * wx) / denominator;
      const u = ((cx - ax) * vy - (cy - ay) * vx) / denominator;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
    }
  }
  return false;
}

function overlappingPairs(
  projections: readonly Readonly<{ id: string; sourceId: string; targetId: string }>[],
  routes: ReadonlyMap<string, Readonly<{ path: string }>>,
): string[] {
  const overlaps: string[] = [];
  for (let index = 0; index < projections.length; index += 1) {
    const first = getOrThrow(projections[index], "Missing first aggregate edge");
    for (const second of projections.slice(index + 1)) {
      if (
        overlapsVisibly(
          getOrThrow(routes.get(first.id), "Missing first aggregate route").path,
          getOrThrow(routes.get(second.id), "Missing second aggregate route").path,
        )
      )
        overlaps.push(`${first.sourceId} → ${first.targetId} / ${second.sourceId} → ${second.targetId}`);
    }
  }
  return overlaps;
}

async function focusedRoutes(focusId?: string) {
  const diagram = parseDiagram(artifactJson);
  const sizes = Object.fromEntries(diagram.graph.nodes.map(({ id }) => [id, { width: 288, height: 100 }]));
  const layout = await layoutDependencyGraph(diagram.graph, sizes);
  const bounds = getDependencyElementBounds(layout);
  const projections = projectDependencyEdges(
    diagram.graph,
    focusId ? { type: "group", id: focusId } : undefined,
  ).filter(
    (projection): projection is Extract<DependencyEdgeProjection, { type: "aggregate" }> =>
      projection.type === "aggregate",
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
  const pathFrom = (sourceId: string, targetId: string) => {
    const projection = projections.find((edge) => edge.sourceId === sourceId && edge.targetId === targetId);
    if (!projection) throw new Error(`Missing aggregate edge: ${sourceId} → ${targetId}`);
    return getOrThrow(routes.get(projection.id), `Missing route: ${projection.id}`).path;
  };
  return { pathFrom, bounds };
}

describe("dependency aggregate routes on the checked-in design", () => {
  it("does not wrap unrelated groups or travel beyond the destination to avoid other edges", async () => {
    const diagram = parseDiagram(artifactJson);
    const sizes = Object.fromEntries(diagram.graph.nodes.map(({ id }) => [id, { width: 288, height: 100 }]));
    const layout = await layoutDependencyGraph(diagram.graph, sizes);
    const bounds = getDependencyElementBounds(layout);
    const elements = new Map(
      [...layout.groups, ...layout.nodes.filter(({ parentId }) => !parentId)].map(
        ({ id }) => [id, getOrThrow(bounds.get(id), `Missing aggregate element: ${id}`)] as const,
      ),
    );
    const projections = projectDependencyEdges(diagram.graph).filter(
      (projection): projection is Extract<DependencyEdgeProjection, { type: "aggregate" }> =>
        projection.type === "aggregate",
    );
    const routes = routeAggregateDependencyEdges(projections, elements);
    const externalId = "group:external-packages";
    const pathFrom = (sourceId: string) => {
      const projection = projections.find((edge) => edge.sourceId === sourceId && edge.targetId === externalId);
      if (!projection) throw new Error(`Missing aggregate to external packages: ${sourceId}`);
      return getOrThrow(routes.get(projection.id), `Missing aggregate route: ${projection.id}`).path;
    };
    const clientId = "group:directory:src/client";
    const featuresId = "group:directory:src/features";
    const client = getOrThrow(bounds.get(clientId), "Missing client group");
    const external = getOrThrow(bounds.get(externalId), "Missing external group");

    expect(routeOrdinateRange(pathFrom(clientId)).at(0)).toBeGreaterThanOrEqual(client.position.y);
    expect(routeOrdinateRange(pathFrom(featuresId)).at(-1)).toBeLessThanOrEqual(
      external.position.y + external.size.height,
    );
  });

  it("places root arrivals from the left before the central and right-hand arrivals", async () => {
    const externalId = "group:external-packages";
    const { pathFrom } = await focusedRoutes();
    const incomingX = (sourceId: string) => {
      const endpoint = pathFrom(sourceId, externalId).match(/ L ([-\d.]+) ([-\d.]+)$/);
      if (!endpoint) throw new Error(`Missing external arrival port: ${sourceId}`);
      return Number(endpoint.at(1));
    };
    const sharedX = incomingX("group:directory:src/shared");

    expect(incomingX("group:directory:src/client")).toBeLessThan(sharedX);
    for (const sourceId of [
      "group:directory:src/features",
      "group:directory:src/server",
      "group:directory:src/plugins",
    ]) {
      expect(incomingX(sourceId)).toBeGreaterThan(sharedX);
    }
  });

  it("keeps distinct aggregate edges on separate straight tracks", async () => {
    const diagram = parseDiagram(artifactJson);
    const sizes = Object.fromEntries(diagram.graph.nodes.map(({ id }) => [id, { width: 288, height: 100 }]));
    const layout = await layoutDependencyGraph(diagram.graph, sizes);
    const bounds = getDependencyElementBounds(layout);
    const elements = new Map(
      [...layout.groups, ...layout.nodes.filter(({ parentId }) => !parentId)].map(
        ({ id }) => [id, getOrThrow(bounds.get(id), `Missing aggregate element: ${id}`)] as const,
      ),
    );
    const projections = projectDependencyEdges(diagram.graph).filter(
      (projection): projection is Extract<DependencyEdgeProjection, { type: "aggregate" }> =>
        projection.type === "aggregate",
    );
    const routes = routeAggregateDependencyEdges(projections, elements);
    expect(overlappingPairs(projections, routes)).toEqual([]);
  });

  it("keeps focused groups' boundary edges on separate tracks", async () => {
    const diagram = parseDiagram(artifactJson);
    const sizes = Object.fromEntries(diagram.graph.nodes.map(({ id }) => [id, { width: 288, height: 100 }]));
    const layout = await layoutDependencyGraph(diagram.graph, sizes);
    const bounds = getDependencyElementBounds(layout);
    const cards = layout.nodes.map(({ id, parentId }) => ({
      parentId,
      bounds: getOrThrow(bounds.get(id), `Missing node bounds: ${id}`),
    }));
    const virtualGroups = new Map<string | undefined, (typeof cards)[number]["bounds"]>();
    for (const { parentId, bounds: current } of cards) {
      const previous = virtualGroups.get(parentId);
      if (!previous) {
        virtualGroups.set(parentId, current);
        continue;
      }
      const left = Math.min(previous.position.x, current.position.x);
      const top = Math.min(previous.position.y, current.position.y);
      const right = Math.max(previous.position.x + previous.size.width, current.position.x + current.size.width);
      const bottom = Math.max(previous.position.y + previous.size.height, current.position.y + current.size.height);
      virtualGroups.set(parentId, {
        position: { x: left, y: top },
        size: { width: right - left, height: bottom - top },
      });
    }
    const overlaps: string[] = [];
    for (const group of diagram.graph.groups) {
      const projections = projectDependencyEdges(diagram.graph, { type: "group", id: group.id }).filter(
        (projection): projection is Extract<DependencyEdgeProjection, { type: "aggregate" }> =>
          projection.type === "aggregate",
      );
      const endpointIds = new Set(projections.flatMap(({ sourceId, targetId }) => [sourceId, targetId]));
      const elements = new Map(
        [...layout.groups, ...layout.nodes.filter(({ id, parentId }) => !parentId || endpointIds.has(id))].map(
          ({ id }) => [id, getOrThrow(bounds.get(id), `Missing aggregate element: ${id}`)] as const,
        ),
      );
      const routes = routeAggregateDependencyEdges(projections, elements, [...virtualGroups.values()]);
      overlaps.push(...overlappingPairs(projections, routes).map((pair) => `${group.title}: ${pair}`));
    }
    expect(overlaps).toEqual([]);
  });

  it("avoids crossings at grid vertices for server and artifact focus", async () => {
    const server = "group:directory:src/server";
    const artifact = "group:directory:src/features/artifact";
    const cases = [
      [server, server, artifact, server, "group:directory:src/features/diagram"],
      [artifact, "group:directory:src/client", artifact, "group:directory:src/client/pages", artifact],
    ] as const;
    const crossings: string[] = [];
    for (const [focusId, firstSource, firstTarget, secondSource, secondTarget] of cases) {
      const { pathFrom } = await focusedRoutes(focusId);
      if (pathsCross(pathFrom(firstSource, firstTarget), pathFrom(secondSource, secondTarget))) crossings.push(focusId);
    }
    expect(crossings).toEqual([]);
  });

  it("keeps the focused diagram's outward departures from crossing", async () => {
    const diagramId = "group:directory:src/features/diagram";
    const { pathFrom } = await focusedRoutes(diagramId);
    expect(
      pathsCross(
        pathFrom(diagramId, "group:directory:src/shared/universal"),
        pathFrom(diagramId, "group:external-packages"),
      ),
    ).toBe(false);
  });

  it("keeps focused features' arrivals uncrossed around server", async () => {
    const featuresId = "group:directory:src/features";
    const { pathFrom } = await focusedRoutes(featuresId);
    const groups = [
      ["group:directory:src/client/pages", "group:directory:src/client/parts", "group:directory:src/client"],
      [
        "group:directory:src/client/widgets",
        "group:directory:src/plugins/diagram-generators/js-module-dependency-graph",
        "group:directory:src/plugins/diagram-generators/react-component-structure",
      ],
    ];
    const crossings: string[] = [];
    for (const sources of groups) {
      for (let index = 0; index < sources.length; index += 1) {
        for (const sourceId of sources.slice(index + 1)) {
          const first = getOrThrow(sources[index], "Missing first features source");
          if (pathsCross(pathFrom(first, featuresId), pathFrom(sourceId, featuresId)))
            crossings.push(`${first} / ${sourceId}`);
        }
      }
    }
    expect(crossings).toEqual([]);
  });

  it("spreads focused annotation arrivals through the free corridor above it", async () => {
    const annotationId = "group:directory:src/features/annotation";
    const serverId = "group:directory:src/server";
    const { pathFrom, bounds } = await focusedRoutes(annotationId);
    const annotation = getOrThrow(bounds.get(annotationId), "Missing annotation group");
    const server = getOrThrow(bounds.get(serverId), "Missing server group");
    const upper = server.position.y + server.size.height;
    const lower = annotation.position.y;
    const levels = [
      "group:directory:src/client",
      "group:directory:src/client/pages",
      "group:directory:src/client/parts",
      "group:directory:src/client/widgets",
    ].flatMap((sourceId) =>
      straightSegments(pathFrom(sourceId, annotationId)).flatMap(([fromX, fromY, toX, toY]) =>
        fromY === toY && Math.abs(toX - fromX) > 100 && fromY > upper && fromY < lower ? [fromY] : [],
      ),
    );

    expect(levels.length).toBeGreaterThanOrEqual(4);
    expect(Math.min(...levels)).toBeLessThan((upper + lower) / 2);
    expect(Math.max(...levels)).toBeGreaterThan((upper + lower) / 2);
  });
});
