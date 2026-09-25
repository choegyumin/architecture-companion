import { type EdgeRoute, getDependencyElementBounds } from "@/client/widgets/dependency-graph-edge-routes";
import { coordinateRoutingPlan, renderRoutingPath } from "@/client/widgets/dependency-graph-routing-coordinates";
import {
  type Bounds,
  center,
  compact,
  midpoint,
  portPoint,
  type Projection,
  rectangle,
  routeLength,
  sideFacing,
} from "@/client/widgets/dependency-graph-routing-geometry";
import {
  collectRoutingRequests,
  independentPlan,
  type RoutingPlan,
  type RoutingRequest,
  selectRoutingPlan,
  type WorkBudget,
} from "@/client/widgets/dependency-graph-routing-plan";
import { buildRoutingScene, type RoutingScene } from "@/client/widgets/dependency-graph-routing-scene";
import type { DiagramLayout } from "@/features/diagram/diagram-spatial";
import { getOrThrow } from "@/shared/universal/get-or-throw";

export { measureAggregateSegmentCongestion } from "@/client/widgets/dependency-graph-routing-geometry";

export type AggregateRoutingStage = "normal" | "detour" | "independent" | "direct";
type RoutingReason =
  | "routed"
  | "extended-detour"
  | "spacing-limit"
  | "search-limit"
  | "order-limit"
  | "coordinate-limit"
  | "scene-limit"
  | "no-path";
export type AggregateEdgeRoute = EdgeRoute &
  Readonly<{
    routing: Readonly<{ stage: AggregateRoutingStage; reason: RoutingReason }>;
  }>;
export type AggregateRoutingOptions = Readonly<{
  maxSearchSteps?: number;
  maxOrderSteps?: number;
  maxCoordinateSteps?: number;
  maxImprovementPasses?: number;
}>;

const scenes = new WeakMap<DiagramLayout, RoutingScene>();
const budget = (limit: number): WorkBudget => ({
  remaining: Math.max(0, Math.min(2_000_000, Number.isNaN(limit) ? 0 : Math.floor(limit))),
  exhausted: false,
});

function directRoute(edge: Projection, bounds: ReadonlyMap<string, Bounds>): EdgeRoute {
  const source = rectangle(getOrThrow(bounds.get(edge.sourceId), `Missing aggregate source: ${edge.sourceId}`));
  const target = rectangle(getOrThrow(bounds.get(edge.targetId), `Missing aggregate target: ${edge.targetId}`));
  const sourceSide = sideFacing(source, target);
  let targetSide = sideFacing(target, source);
  const a = center(source);
  const b = center(target);
  const start = portPoint(source, sourceSide, sourceSide === "top" || sourceSide === "bottom" ? a.x : a.y);
  let end = portPoint(target, targetSide, targetSide === "top" || targetSide === "bottom" ? b.x : b.y);
  if (start.x === end.x && start.y === end.y) {
    targetSide =
      targetSide === "right" ? "left" : targetSide === "left" ? "right" : targetSide === "top" ? "bottom" : "top";
    end = portPoint(target, targetSide, targetSide === "top" || targetSide === "bottom" ? b.x : b.y);
  }
  const bend = sourceSide === "top" || sourceSide === "bottom" ? { x: start.x, y: end.y } : { x: end.x, y: start.y };
  const points = compact([start, bend, end]);
  return {
    path: points.map(({ x, y }, index) => `${index ? "L" : "M"} ${x} ${y}`).join(" "),
    labelPosition: midpoint(points),
  };
}

export function routeAggregateDependencyEdges(
  projections: readonly Projection[],
  layout: DiagramLayout,
  options: AggregateRoutingOptions = {},
): ReadonlyMap<string, AggregateEdgeRoute> {
  if (!projections.length) return new Map();
  const edges = [...projections].sort((a, b) => a.id.localeCompare(b.id) || (a.id < b.id ? -1 : Number(a.id > b.id)));
  let scene = scenes.get(layout);
  const bounds = scene?.bounds ?? getDependencyElementBounds(layout);
  // Even scene construction is optional: every relationship already has a visible route.
  const routes = new Map<string, AggregateEdgeRoute>(
    edges.map((edge) => [
      edge.id,
      { ...directRoute(edge, bounds), routing: { stage: "direct", reason: "scene-limit" } },
    ]),
  );
  if (!scene) {
    scene = buildRoutingScene(layout, bounds);
    if (!scene) return routes;
    scenes.set(layout, scene);
  }

  const searchLimit = options.maxSearchSteps ?? 250_000;
  const orderLimit = options.maxOrderSteps ?? 250_000;
  const coordinateLimit = options.maxCoordinateSteps ?? 500_000;
  const searchBudget = budget(searchLimit);
  let requests = collectRoutingRequests(scene, edges, searchBudget);
  const queries = new Map(requests.map(({ edge, query }) => [edge.id, query]));
  const independent = new Map<string, EdgeRoute>();
  const baselineLengths = new Map<string, number>();
  const preserveIndependent = (entries: readonly RoutingRequest[]) => {
    for (const request of entries) {
      if (independent.has(request.edge.id)) continue;
      for (const candidate of request.candidates) {
        const result = coordinateRoutingPlan(scene, independentPlan(candidate), queries, budget(100_000));
        const points = result.paths.get(request.edge.id);
        const route = points && renderRoutingPath(points, request.query.obstacles);
        if (!route) continue;
        independent.set(request.edge.id, route);
        baselineLengths.set(request.edge.id, routeLength(points!));
        break;
      }
    }
  };
  preserveIndependent(requests);

  const evaluate = (plan: RoutingPlan, work: WorkBudget, extended = false) => {
    const result = coordinateRoutingPlan(scene, plan, queries, work);
    const rendered = new Map<string, EdgeRoute>();
    for (const [id, points] of result.paths) {
      const reference = baselineLengths.get(id);
      if (
        reference !== undefined &&
        routeLength(points) > reference + Math.max(extended ? 1_024 : 256, reference * (extended ? 1 : 0.25))
      )
        continue;
      const route = renderRoutingPath(points, queries.get(id)!.obstacles);
      if (route) rendered.set(id, route);
    }
    return { plan, rendered, cost: result.cost, compression: result.compression };
  };
  const orderBudget = budget(orderLimit);
  const coordinateBudget = budget(coordinateLimit);
  let selected = evaluate(selectRoutingPlan(scene, requests, orderBudget), coordinateBudget);
  const improves = (next: typeof selected, previous: typeof selected) =>
    [...previous.rendered.keys()].every((id) => next.rendered.has(id)) &&
    (next.rendered.size > previous.rendered.size ||
      (next.rendered.size === previous.rendered.size &&
        (next.compression < previous.compression ||
          (next.compression === previous.compression && next.cost < previous.cost))));
  const refine = (extended: boolean, ordering: WorkBudget, coordinates: WorkBudget) => {
    for (let pass = 0; pass < Math.min(4, options.maxImprovementPasses ?? 1); pass += 1) {
      let changed = false;
      const ordered = [...requests].sort(
        (a, b) => Number(selected.rendered.has(a.edge.id)) - Number(selected.rendered.has(b.edge.id)),
      );
      for (const request of ordered) {
        for (const candidate of request.candidates) {
          if (ordering.exhausted || coordinates.exhausted) return;
          if (selected.plan.selected.get(request.edge.id) === candidate) continue;
          const preferred = new Map(selected.plan.selected);
          preferred.set(request.edge.id, candidate);
          const trial = evaluate(
            selectRoutingPlan(scene, requests, ordering, extended, preferred),
            coordinates,
            extended,
          );
          if (!improves(trial, selected)) continue;
          selected = trial;
          changed = true;
        }
      }
      if (!changed) break;
    }
  };
  refine(false, orderBudget, coordinateBudget);
  const normal = selected;
  let extendedOrder: WorkBudget | undefined;
  let extendedCoordinates: WorkBudget | undefined;
  if (selected.rendered.size < edges.length) {
    if (requests.some(({ candidates }) => !candidates.length) && searchBudget.exhausted) {
      const additional = collectRoutingRequests(scene, edges, budget(searchLimit * 2));
      requests = requests.map((request, index) => (request.candidates.length ? request : additional[index]!));
      preserveIndependent(requests);
    }
    extendedOrder = budget(orderLimit * 2);
    extendedCoordinates = budget(coordinateLimit * 2);
    const trial = evaluate(selectRoutingPlan(scene, requests, extendedOrder, true), extendedCoordinates, true);
    if (improves(trial, selected)) selected = trial;
    refine(true, extendedOrder, extendedCoordinates);
  }

  for (const edge of edges) {
    const complete = selected.rendered.get(edge.id);
    if (complete) {
      const extended = normal.rendered.get(edge.id)?.path !== complete.path;
      routes.set(edge.id, {
        ...complete,
        routing: extended ? { stage: "detour", reason: "extended-detour" } : { stage: "normal", reason: "routed" },
      });
      continue;
    }
    const reason: RoutingReason = !requests.find(({ edge: entry }) => entry.id === edge.id)?.candidates.length
      ? searchBudget.exhausted
        ? "search-limit"
        : "no-path"
      : orderBudget.exhausted || extendedOrder?.exhausted
        ? "order-limit"
        : coordinateBudget.exhausted || extendedCoordinates?.exhausted
          ? "coordinate-limit"
          : "spacing-limit";
    const fallback = independent.get(edge.id);
    routes.set(edge.id, {
      ...(fallback ?? routes.get(edge.id)!),
      routing: { stage: fallback ? "independent" : "direct", reason },
    });
  }
  return routes;
}
