import {
  type AggregateEdgeRoute,
  routeAggregateDependencyEdges,
} from "@/client/widgets/dependency-graph-aggregate-routes";
import { getDependencyElementBounds } from "@/client/widgets/dependency-graph-edge-routes";
import {
  onBoundary,
  pathEndpoints,
  pathsCross,
  pathsOverlap,
} from "@/client/widgets/dependency-graph-route-test-geometry";
import { collectVirtualBundles } from "@/client/widgets/dependency-graph-routing-scene";
import { parseArtifact } from "@/features/artifact/artifact";
import { layoutDependencyGraph } from "@/features/diagram/_layout/dependency-graph-layout";
import { type DependencyEdgeProjection, projectDependencyEdges } from "@/features/diagram/dependency-edge-projection";
import type { DiagramLayout } from "@/features/diagram/diagram-spatial";
import { getOrThrow } from "@/shared/universal/get-or-throw";

import commanderJson from "../../../showcases/.architecture-companion/designs/commander-dependency-graph.json";
import dependencyCruiserJson from "../../../showcases/.architecture-companion/designs/dependency-cruiser-dependency-graph.json";

type Aggregate = Extract<DependencyEdgeProjection, { type: "aggregate" }>;
type AggregateEndpoint = Readonly<{ id: string; sourceId: string; targetId: string }>;

function aggregates(projections: readonly DependencyEdgeProjection[]): readonly Aggregate[] {
  return projections.filter((projection): projection is Aggregate => projection.type === "aggregate");
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
  projections: readonly AggregateEndpoint[],
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

// Routes that share an endpoint must keep that endpoint distinct and must not
// overlap each other; crossings are asserted separately where the router
// guarantees them (see expectUncrossedRoutes).
function expectEndpointPairsReadable(
  projections: readonly AggregateEndpoint[],
  routes: ReadonlyMap<string, AggregateEdgeRoute>,
  bounds: ReturnType<typeof getDependencyElementBounds>,
  bundles: ReadonlyMap<string, { position: { x: number; y: number }; size: { width: number; height: number } }>,
): void {
  for (const { id, sourceId, targetId } of projections) {
    const route = getOrThrow(routes.get(id), `Missing route: ${id}`);
    const { start, end } = pathEndpoints(route.path);
    const sourceRects = [bounds.get(sourceId), bundles.get(sourceId)].filter(Boolean);
    const targetRects = [bounds.get(targetId), bundles.get(targetId)].filter(Boolean);
    expect(sourceRects.some((rect) => onBoundary(start, rect!))).toBe(true);
    expect(targetRects.some((rect) => onBoundary(end, rect!))).toBe(true);
  }
  for (const [index, first] of projections.entries()) {
    for (const second of projections.slice(index + 1)) {
      const a = getOrThrow(routes.get(first.id), `Missing route: ${first.id}`);
      const b = getOrThrow(routes.get(second.id), `Missing route: ${second.id}`);
      if (first.sourceId === second.sourceId)
        expect(pathEndpoints(a.path).start).not.toEqual(pathEndpoints(b.path).start);
      if (first.targetId === second.targetId) expect(pathEndpoints(a.path).end).not.toEqual(pathEndpoints(b.path).end);
      expect(pathsOverlap(a.path, b.path)).toBe(false);
    }
  }
}

function expectUncrossedRoutes(
  projections: readonly AggregateEndpoint[],
  routes: ReadonlyMap<string, AggregateEdgeRoute>,
): void {
  for (const [index, first] of projections.entries()) {
    for (const second of projections.slice(index + 1)) {
      const a = getOrThrow(routes.get(first.id), `Missing route: ${first.id}`);
      const b = getOrThrow(routes.get(second.id), `Missing route: ${second.id}`);
      expect(pathsCross(a.path, b.path)).toBe(false);
    }
  }
}

type Scene = Readonly<{
  title: string;
  graph: ReturnType<typeof parseArtifact>["diagram"]["graph"];
  layout: Promise<DiagramLayout>;
  focused: ReadonlyMap<string, readonly Aggregate[]>;
}>;

function showcaseScene(title: string, artifactJson: unknown): Scene {
  const diagram = parseArtifact(artifactJson);
  const graph = diagram.diagram.graph;
  const sizes = Object.fromEntries(graph.nodes.map(({ id }) => [id, { width: 288, height: 100 }]));
  // One shared layout keeps the ELK run cached across the generated tests.
  const layout = layoutDependencyGraph(graph, sizes);
  const focused = new Map(
    graph.groups.map(
      (group) => [group.id, aggregates(projectDependencyEdges(graph, { type: "group", id: group.id }))] as const,
    ),
  );
  return { title, graph, layout, focused };
}

// The showcase designs are regenerated from external projects, so tests select
// groups structurally — by projection counts — instead of by literal ids. Flat
// designs (commander) exercise only the overview and per-group sweeps; the
// structural focus tests below register only when the scene contains them.
function busiestGroup(
  scene: Scene,
  direction: "in" | "out",
): { id: string; projections: readonly Aggregate[] } | undefined {
  const ranked = [...scene.focused]
    .map(([id, projections]) => ({
      id,
      projections,
      degree: projections.filter(({ sourceId, targetId }) => (direction === "in" ? targetId === id : sourceId === id))
        .length,
    }))
    .sort((a, b) => b.degree - a.degree || (a.id < b.id ? -1 : 1));
  return ranked.find(({ degree }) => degree > 1);
}

// A parent and one of its child groups both relate to the same focus, so their
// aggregate routes must stay readable while nesting one level apart.
function nestedRelation(scene: Scene): readonly Aggregate[] | undefined {
  const parents = new Map(scene.graph.groups.map((group) => [group.id, group.parentId]));
  for (const [focusId, projections] of scene.focused) {
    const sources = projections.map(({ sourceId }) => sourceId);
    for (const source of sources) {
      const child = sources.find((candidate) => parents.get(candidate) === source);
      if (!child || source === focusId || child === focusId) continue;
      return projections.filter(({ sourceId }) => sourceId === source || sourceId === child);
    }
  }
  return undefined;
}

for (const { title, json } of [
  { title: "commander", json: commanderJson },
  { title: "dependency-cruiser", json: dependencyCruiserJson },
] as const) {
  const scene = showcaseScene(title, json);

  describe(`dependency aggregate routes on the ${title} showcase design`, () => {
    it("keeps distinct overview aggregate edges on separate straight tracks", async () => {
      const layout = await scene.layout;
      const projections = aggregates(projectDependencyEdges(scene.graph));
      expect(projections.length).toBeGreaterThan(0);
      const routes = routeAggregateDependencyEdges(projections, layout);
      expect(overlappingPairs(projections, routes)).toEqual([]);
    });

    // One `it` per group so the five-second timeout applies to each focus rather
    // than to the sweep as a whole; the shared layout keeps the scene cached.
    for (const { id: groupId, title: groupTitle } of scene.graph.groups) {
      it(`keeps ${groupTitle}'s focused boundary edges on separate tracks`, async () => {
        const layout = await scene.layout;
        const projections = getOrThrow(scene.focused.get(groupId), `Missing focused projections: ${groupId}`);
        if (projections.length === 0) return;
        const routes = routeAggregateDependencyEdges(projections, layout);
        expect([...routes].filter(([, route]) => route.routing.stage !== "normal").map(([id]) => id)).toEqual([]);
        expect(overlappingPairs(projections, routes)).toEqual([]);
      });
    }

    // Dense hubs (dependency-cruiser's most-depended-on group has 19 aggregate
    // arrivals) compress parallel tracks below the rounded-corner radius, so a
    // corner arc can sweep across a neighbouring straight track. Distinct
    // endpoints and separate tracks remain guaranteed; full crossing freedom is
    // asserted only where corridors stay wide (see the nested-relation test).
    const hub = busiestGroup(scene, "in");
    if (hub) {
      it("keeps the busiest hub's arrivals on distinct ports and separate tracks", async () => {
        const layout = await scene.layout;
        const bounds = getDependencyElementBounds(layout);
        const bundles = collectVirtualBundles(layout, bounds) ?? new Map();
        const routes = routeAggregateDependencyEdges(hub.projections, layout);
        expectEndpointPairsReadable(hub.projections, routes, bounds, bundles);
        expect(overlappingPairs(hub.projections, routes)).toEqual([]);
      });
    }

    const origin = busiestGroup(scene, "out");
    if (origin) {
      it("keeps the busiest origin's departures on distinct ports and separate tracks", async () => {
        const layout = await scene.layout;
        const bounds = getDependencyElementBounds(layout);
        const bundles = collectVirtualBundles(layout, bounds) ?? new Map();
        const routes = routeAggregateDependencyEdges(origin.projections, layout);
        expectEndpointPairsReadable(origin.projections, routes, bounds, bundles);
        expect(overlappingPairs(origin.projections, routes)).toEqual([]);
      });
    }

    const nested = nestedRelation(scene);
    if (nested) {
      it("keeps nested parent and child sources readable toward the same focus", async () => {
        expect(nested.length).toBeGreaterThan(1);
        const layout = await scene.layout;
        const bounds = getDependencyElementBounds(layout);
        const bundles = collectVirtualBundles(layout, bounds) ?? new Map();
        const routes = routeAggregateDependencyEdges(nested, layout);
        expectEndpointPairsReadable(nested, routes, bounds, bundles);
        expectUncrossedRoutes(nested, routes);
      });
    }
  });
}
