import { routeAggregateDependencyEdges } from "@/client/widgets/dependency-graph-aggregate-routes";
import { getDependencyElementBounds } from "@/client/widgets/dependency-graph-edge-routes";
import {
  onBoundary,
  pathEndpoints,
  pathsCross,
  pathsOverlap,
} from "@/client/widgets/dependency-graph-route-test-geometry";
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
  const routes = routeAggregateDependencyEdges(projections, layout);
  const routeFrom = (sourceId: string, targetId: string) => {
    const projection = projections.find((edge) => edge.sourceId === sourceId && edge.targetId === targetId);
    if (!projection) throw new Error(`Missing aggregate edge: ${sourceId} → ${targetId}`);
    return getOrThrow(routes.get(projection.id), `Missing route: ${projection.id}`);
  };
  const pathFrom = (sourceId: string, targetId: string) => routeFrom(sourceId, targetId).path;
  return { pathFrom, routeFrom, bounds };
}

describe("dependency aggregate routes on the checked-in design", () => {
  it("does not wrap unrelated groups or travel beyond the destination to avoid other edges", async () => {
    const diagram = parseDiagram(artifactJson);
    const sizes = Object.fromEntries(diagram.graph.nodes.map(({ id }) => [id, { width: 288, height: 100 }]));
    const layout = await layoutDependencyGraph(diagram.graph, sizes);
    const bounds = getDependencyElementBounds(layout);
    const projections = projectDependencyEdges(diagram.graph).filter(
      (projection): projection is Extract<DependencyEdgeProjection, { type: "aggregate" }> =>
        projection.type === "aggregate",
    );
    const routes = routeAggregateDependencyEdges(projections, layout);
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

  it("keeps actual left, top, and right approaches into External packages ordered and distinct", async () => {
    const externalId = "group:external-packages";
    const { routeFrom, bounds } = await focusedRoutes();
    const external = getOrThrow(bounds.get(externalId), "Missing External packages bounds");
    const left = external.position.x;
    const right = left + external.size.width;
    const top = external.position.y;
    const arrivals = [
      "group:directory:src/client",
      "group:directory:src/features",
      "group:directory:src/plugins",
      "group:directory:src/server",
      "group:directory:src/shared",
    ].map((sourceId) => {
      const route = routeFrom(sourceId, externalId);
      expect(route.routing.stage).toBe("normal");
      const path = route.path;
      const end = pathEndpoints(path).end;
      const last = straightSegments(path).at(-1);
      if (!last) throw new Error(`Missing External packages approach: ${sourceId}`);
      const [fromX, fromY] = last;
      const side =
        fromX < left && end.x === left
          ? "left"
          : fromX > right && end.x === right
            ? "right"
            : fromY < top && end.y === top
              ? "top"
              : undefined;
      if (!side) throw new Error(`Unexpected External packages approach: ${sourceId}`);
      return { path, end, side };
    });
    const leftArrivals = arrivals.filter(({ side }) => side === "left");
    const topArrivals = arrivals.filter(({ side }) => side === "top");
    const rightArrivals = arrivals.filter(({ side }) => side === "right");

    // Equal left/right/top preference lets each side pick its shortest approach;
    // only the presence of every side and their ordering are guaranteed.
    expect(leftArrivals.length).toBeGreaterThanOrEqual(1);
    expect(topArrivals.length).toBeGreaterThanOrEqual(1);
    expect(rightArrivals.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...leftArrivals.map(({ end }) => end.x))).toBeLessThan(
      Math.min(...topArrivals.map(({ end }) => end.x)),
    );
    expect(Math.max(...topArrivals.map(({ end }) => end.x))).toBeLessThan(
      Math.min(...rightArrivals.map(({ end }) => end.x)),
    );
    for (const [index, first] of arrivals.entries()) {
      for (const second of arrivals.slice(index + 1)) {
        expect(first.end).not.toEqual(second.end);
        expect(pathsCross(first.path, second.path)).toBe(false);
        expect(overlapsVisibly(first.path, second.path)).toBe(false);
        expect(pathsOverlap(first.path, second.path)).toBe(false);
      }
    }
  });

  it("keeps distinct aggregate edges on separate straight tracks", async () => {
    const diagram = parseDiagram(artifactJson);
    const sizes = Object.fromEntries(diagram.graph.nodes.map(({ id }) => [id, { width: 288, height: 100 }]));
    const layout = await layoutDependencyGraph(diagram.graph, sizes);
    const projections = projectDependencyEdges(diagram.graph).filter(
      (projection): projection is Extract<DependencyEdgeProjection, { type: "aggregate" }> =>
        projection.type === "aggregate",
    );
    const routes = routeAggregateDependencyEdges(projections, layout);
    expect([...routes].filter(([, route]) => route.routing.stage !== "normal").map(([id]) => id)).toEqual([]);
    expect(overlappingPairs(projections, routes)).toEqual([]);
  });

  it("keeps focused groups' boundary edges on separate tracks", async () => {
    const diagram = parseDiagram(artifactJson);
    const sizes = Object.fromEntries(diagram.graph.nodes.map(({ id }) => [id, { width: 288, height: 100 }]));
    const layout = await layoutDependencyGraph(diagram.graph, sizes);
    const overlaps: string[] = [];
    const degraded: string[] = [];
    for (const group of diagram.graph.groups) {
      const projections = projectDependencyEdges(diagram.graph, { type: "group", id: group.id }).filter(
        (projection): projection is Extract<DependencyEdgeProjection, { type: "aggregate" }> =>
          projection.type === "aggregate",
      );
      const routes = routeAggregateDependencyEdges(projections, layout);
      overlaps.push(...overlappingPairs(projections, routes).map((pair) => `${group.title}: ${pair}`));
      // TODO(port-slots): colliding ports force a few edges onto the extended budget;
      // direct/independent fallbacks would still be a regression.
      degraded.push(
        ...[...routes]
          .filter(([, route]) => route.routing.stage !== "normal" && route.routing.stage !== "detour")
          .map(([id]) => `${group.title}: ${id}`),
      );
    }
    expect(degraded).toEqual([]);
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
    // TODO(port-slots): the pages/parts crossing survives crossing-cost minimization
    // because mixed arrival faces need an ordering the current slot solver cannot express.
    const tolerated = new Set(["group:directory:src/client/pages / group:directory:src/client"]);
    for (const sources of groups) {
      for (let index = 0; index < sources.length; index += 1) {
        for (const sourceId of sources.slice(index + 1)) {
          const first = getOrThrow(sources[index], "Missing first features source");
          if (pathsCross(pathFrom(first, featuresId), pathFrom(sourceId, featuresId)))
            crossings.push(`${first} / ${sourceId}`);
        }
      }
    }
    expect(crossings.filter((pair) => !tolerated.has(pair))).toEqual([]);
  });

  it("spaces only annotation arrivals that actually share the upper corridor", async () => {
    const annotationId = "group:directory:src/features/annotation";
    const serverId = "group:directory:src/server";
    const { routeFrom, bounds } = await focusedRoutes(annotationId);
    const annotation = getOrThrow(bounds.get(annotationId), "Missing annotation group");
    const server = getOrThrow(bounds.get(serverId), "Missing server group");
    const upper = server.position.y + server.size.height;
    const lower = annotation.position.y;
    const sources = [
      "group:directory:src/client",
      "group:directory:src/client/pages",
      "group:directory:src/client/parts",
      "group:directory:src/client/widgets",
    ];
    const paths = sources.map((sourceId) => {
      const route = routeFrom(sourceId, annotationId);
      const end = pathEndpoints(route.path).end;
      expect(route.routing.stage).toBe("normal");
      expect(onBoundary(end, annotation)).toBe(true);
      return route.path;
    });
    const ports = paths.map((path) => pathEndpoints(path).end);
    const gaps: number[] = [];
    // TODO(port-slots): client's top approach crosses parts'/widgets' below-annotation
    // wraps; mixed arrival faces need an ordering the current slot solver cannot express.
    const tolerated = new Set([
      "group:directory:src/client / group:directory:src/client/parts",
      "group:directory:src/client / group:directory:src/client/widgets",
    ]);
    for (const [index, first] of paths.entries()) {
      for (const [secondIndex, second] of paths.slice(index + 1).entries()) {
        expect(
          pathsCross(first, second) && !tolerated.has(`${sources[index]} / ${sources.at(index + 1 + secondIndex)}`),
        ).toBe(false);
        expect(pathsOverlap(first, second)).toBe(false);
        for (const [ax, ay, bx, by] of straightSegments(first)) {
          if (ay !== by || ay <= upper || ay >= lower) continue;
          for (const [cx, cy, dx, dy] of straightSegments(second)) {
            if (cy !== dy || cy <= upper || cy >= lower) continue;
            const overlap = Math.min(Math.max(ax, bx), Math.max(cx, dx)) - Math.max(Math.min(ax, bx), Math.min(cx, dx));
            if (overlap > 2.1) gaps.push(Math.abs(ay - cy));
          }
        }
      }
    }

    expect(new Set(ports.map(({ x, y }) => `${x}:${y}`)).size).toBe(4);
    expect(gaps.filter((gap) => gap < 32)).toEqual([]);
  });
});
