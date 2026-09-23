import type { DiagramLayout, DiagramLayoutPoint, DiagramLayoutSize } from "@/features/diagram/diagram-spatial";
import { getPolylineEdgeLabelPlacement } from "@/shared/react-flow/polyline-edge-label-placement";
import { getOrThrow } from "@/shared/universal/get-or-throw";

type Bounds = Readonly<{ position: DiagramLayoutPoint; size: DiagramLayoutSize }>;
export type EdgeRoute = Readonly<{ path: string; labelPosition: DiagramLayoutPoint }>;

export function getDependencyElementBounds(layout: DiagramLayout): ReadonlyMap<string, Bounds> {
  const groups = new Map(layout.groups.map((group) => [group.id, group]));
  const origins = new Map<string, DiagramLayoutPoint>();
  const originOf = (groupId: string): DiagramLayoutPoint => {
    const known = origins.get(groupId);
    if (known) return known;
    const group = getOrThrow(groups.get(groupId), `Missing dependency group placement: ${groupId}`);
    const parent = group.parentId ? originOf(group.parentId) : { x: 0, y: 0 };
    const origin = { x: parent.x + group.position.x, y: parent.y + group.position.y };
    origins.set(groupId, origin);
    return origin;
  };
  const entries: Array<readonly [string, Bounds]> = [
    ...layout.groups.map((group): readonly [string, Bounds] => [
      group.id,
      { position: originOf(group.id), size: group.size },
    ]),
    ...layout.nodes.map((node): readonly [string, Bounds] => {
      const parent = node.parentId ? originOf(node.parentId) : { x: 0, y: 0 };
      return [
        node.id,
        {
          position: { x: parent.x + node.position.x, y: parent.y + node.position.y },
          size: node.size,
        },
      ];
    }),
  ];
  return new Map(entries);
}

export function curveBetween(start: DiagramLayoutPoint, end: DiagramLayoutPoint): EdgeRoute {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const vertical = Math.abs(dy) >= Math.abs(dx);
  const bend = Math.max(32, Math.min(96, Math.abs(vertical ? dy : dx) * 0.45));
  const controlA = vertical
    ? { x: start.x, y: start.y + Math.sign(dy || 1) * bend }
    : { x: start.x + Math.sign(dx || 1) * bend, y: start.y };
  const controlB = vertical
    ? { x: end.x, y: end.y - Math.sign(dy || 1) * bend }
    : { x: end.x - Math.sign(dx || 1) * bend, y: end.y };
  return {
    path: `M ${start.x} ${start.y} C ${controlA.x} ${controlA.y} ${controlB.x} ${controlB.y} ${end.x} ${end.y}`,
    labelPosition: {
      x: (start.x + 3 * controlA.x + 3 * controlB.x + end.x) / 8,
      y: (start.y + 3 * controlA.y + 3 * controlB.y + end.y) / 8,
    },
  };
}

type Obstacle = Readonly<{ left: number; top: number; right: number; bottom: number }>;
const ROUTE_CLEARANCE = 24;

function asObstacle(bounds: Bounds): Obstacle {
  return {
    left: bounds.position.x - 12,
    top: bounds.position.y - 12,
    right: bounds.position.x + bounds.size.width + 12,
    bottom: bounds.position.y + bounds.size.height + 12,
  };
}

function crossesObstacle(start: DiagramLayoutPoint, end: DiagramLayoutPoint, obstacle: Obstacle): boolean {
  if (start.x === end.x) {
    return (
      start.x > obstacle.left &&
      start.x < obstacle.right &&
      Math.max(start.y, end.y) > obstacle.top &&
      Math.min(start.y, end.y) < obstacle.bottom
    );
  }
  if (start.y === end.y) {
    return (
      start.y > obstacle.top &&
      start.y < obstacle.bottom &&
      Math.max(start.x, end.x) > obstacle.left &&
      Math.min(start.x, end.x) < obstacle.right
    );
  }
  return false;
}

function curveCrossesCard(start: DiagramLayoutPoint, end: DiagramLayoutPoint, obstacles: readonly Obstacle[]): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const vertical = Math.abs(dy) >= Math.abs(dx);
  const bend = Math.max(32, Math.min(96, Math.abs(vertical ? dy : dx) * 0.45));
  const controlA = vertical
    ? { x: start.x, y: start.y + Math.sign(dy || 1) * bend }
    : { x: start.x + Math.sign(dx || 1) * bend, y: start.y };
  const controlB = vertical
    ? { x: end.x, y: end.y - Math.sign(dy || 1) * bend }
    : { x: end.x - Math.sign(dx || 1) * bend, y: end.y };
  for (let step = 1; step < 24; step += 1) {
    const t = step / 24;
    const inverse = 1 - t;
    const x =
      inverse ** 3 * start.x + 3 * inverse ** 2 * t * controlA.x + 3 * inverse * t ** 2 * controlB.x + t ** 3 * end.x;
    const y =
      inverse ** 3 * start.y + 3 * inverse ** 2 * t * controlA.y + 3 * inverse * t ** 2 * controlB.y + t ** 3 * end.y;
    if (obstacles.some((rect) => x > rect.left && x < rect.right && y > rect.top && y < rect.bottom)) return true;
  }
  return false;
}

function outside(point: DiagramLayoutPoint, bounds: Bounds): DiagramLayoutPoint {
  const { x, y } = bounds.position;
  const { width, height } = bounds.size;
  if (Math.abs(point.y - y) < 1) return { x: point.x, y: point.y - ROUTE_CLEARANCE };
  if (Math.abs(point.y - (y + height)) < 1) return { x: point.x, y: point.y + ROUTE_CLEARANCE };
  if (Math.abs(point.x - x) < 1) return { x: point.x - ROUTE_CLEARANCE, y: point.y };
  if (Math.abs(point.x - (x + width)) < 1) return { x: point.x + ROUTE_CLEARANCE, y: point.y };
  return point;
}

function roundedPath(points: readonly DiagramLayoutPoint[]): string {
  const reduced = points.filter((point, index) => {
    const previous = points.at(index - 1);
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });
  const start = getOrThrow(reduced.at(0), "Missing route start");
  let path = `M ${start.x} ${start.y}`;
  for (let index = 1; index < reduced.length - 1; index += 1) {
    const previous = getOrThrow(reduced[index - 1], "Missing route segment");
    const corner = getOrThrow(reduced[index], "Missing route corner");
    const next = getOrThrow(reduced.at(index + 1), "Missing route segment");
    const before = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const after = Math.hypot(next.x - corner.x, next.y - corner.y);
    const radius = Math.min(12, before / 2, after / 2);
    const enter = {
      x: corner.x + ((previous.x - corner.x) / before) * radius,
      y: corner.y + ((previous.y - corner.y) / before) * radius,
    };
    const exit = {
      x: corner.x + ((next.x - corner.x) / after) * radius,
      y: corner.y + ((next.y - corner.y) / after) * radius,
    };
    path += ` L ${enter.x} ${enter.y} Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`;
  }
  const end = getOrThrow(reduced.at(-1), "Missing route end");
  return `${path} L ${end.x} ${end.y}`;
}

export function routeOriginalDependencyEdge(
  points: readonly DiagramLayoutPoint[],
  source: Bounds,
  target: Bounds,
  otherCards: readonly Bounds[],
): EdgeRoute {
  const start = points.at(0);
  const end = points.at(-1);
  if (!start || !end) throw new Error("Dependency edge is missing endpoints.");
  if (points.length !== 2) {
    return {
      path: points.map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" "),
      labelPosition: getPolylineEdgeLabelPlacement(points),
    };
  }
  const obstacles = otherCards.map(asObstacle);
  if (!curveCrossesCard(start, end, obstacles)) return curveBetween(start, end);

  const departure = outside(start, source);
  const arrival = outside(end, target);
  const verticalCandidates = new Set([departure.x, arrival.x]);
  const horizontalCandidates = new Set([departure.y, arrival.y]);
  obstacles.forEach((rect) => {
    if (rect.bottom > Math.min(departure.y, arrival.y) && rect.top < Math.max(departure.y, arrival.y)) {
      verticalCandidates.add(rect.left - ROUTE_CLEARANCE);
      verticalCandidates.add(rect.right + ROUTE_CLEARANCE);
    }
    if (rect.right > Math.min(departure.x, arrival.x) && rect.left < Math.max(departure.x, arrival.x)) {
      horizontalCandidates.add(rect.top - ROUTE_CLEARANCE);
      horizontalCandidates.add(rect.bottom + ROUTE_CLEARANCE);
    }
  });
  let best: { points: DiagramLayoutPoint[]; score: number } | undefined;
  const consider = (route: DiagramLayoutPoint[]) => {
    const segments = route.slice(1).map((point, index) => [route[index], point] as const);
    const crossings = segments.reduce(
      (total, [a, b]) => total + obstacles.filter((rect) => a && crossesObstacle(a, b, rect)).length,
      0,
    );
    const length = segments.reduce((sum, [a, b]) => sum + (a ? Math.abs(a.x - b.x) + Math.abs(a.y - b.y) : 0), 0);
    const score = crossings * 100_000 + length;
    if (!best || score < best.score) best = { points: route, score };
  };
  verticalCandidates.forEach((x) =>
    consider([start, departure, { x, y: departure.y }, { x, y: arrival.y }, arrival, end]),
  );
  horizontalCandidates.forEach((y) =>
    consider([start, departure, { x: departure.x, y }, { x: arrival.x, y }, arrival, end]),
  );
  const route = getOrThrow(best, "Missing dependency edge route").points;
  return { path: roundedPath(route), labelPosition: getPolylineEdgeLabelPlacement(route) };
}

export function routeAggregateDependencyEdge(
  source: Bounds,
  target: Bounds,
  otherElements: readonly Bounds[] = [],
): EdgeRoute {
  const sourceCenter = {
    x: source.position.x + source.size.width / 2,
    y: source.position.y + source.size.height / 2,
  };
  const targetCenter = {
    x: target.position.x + target.size.width / 2,
    y: target.position.y + target.size.height / 2,
  };
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const horizontalGap = Math.abs(dx) - (source.size.width + target.size.width) / 2;
  const verticalGap = Math.abs(dy) - (source.size.height + target.size.height) / 2;
  const vertical = verticalGap > horizontalGap;
  const down = dy >= 0;
  const right = dx >= 0;
  const start = vertical
    ? { x: sourceCenter.x, y: source.position.y + (down ? source.size.height : 0) }
    : { x: source.position.x + (right ? source.size.width : 0), y: sourceCenter.y };
  const end = vertical
    ? { x: targetCenter.x, y: target.position.y + (down ? 0 : target.size.height) }
    : { x: target.position.x + (right ? 0 : target.size.width), y: targetCenter.y };
  return routeOriginalDependencyEdge([start, end], source, target, otherElements);
}
