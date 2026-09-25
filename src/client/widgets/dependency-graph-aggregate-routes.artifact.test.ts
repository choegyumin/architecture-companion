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
});
