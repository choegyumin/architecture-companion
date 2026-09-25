import type { EdgeRoute } from "@/client/widgets/dependency-graph-edge-routes";
import type { DiagramLayoutPoint, DiagramLayoutSize } from "@/features/diagram/diagram-spatial";
import { getOrThrow } from "@/shared/universal/get-or-throw";

type Point = DiagramLayoutPoint;
type Bounds = Readonly<{ position: Point; size: DiagramLayoutSize }>;
type Side = "top" | "right" | "bottom" | "left";
type Axis = "horizontal" | "vertical";
type Rectangle = Readonly<{ left: number; top: number; right: number; bottom: number }>;
type Segment = Readonly<{ from: Point; to: Point; axis: Axis }>;
type Projection = Readonly<{ id: string; sourceId: string; targetId: string }>;
type RoutingEdge = Projection & {
  source: Rectangle;
  target: Rectangle;
  sourceSide: Side;
  targetSide: Side;
  start: Point;
  end: Point;
};
type Connection = Readonly<{ point: number; length: number; axis: Axis }>;

const CLEARANCE = 64;
const TRACK_GAP = 32;
const MIN_TRACK_GAP = 4;
const PORT_PADDING = 48;
const PORT_GAP = 32;
const BEND_COST = 256;
const CROSSING_COST = 4_000;
const OVERLAP_COST = 6_000;
const MIN_DETOUR = 256;
const DETOUR_RATIO = 0.25;
const EPSILON = 0.001;

function rectangle(bounds: Bounds): Rectangle {
  return {
    left: bounds.position.x,
    top: bounds.position.y,
    right: bounds.position.x + bounds.size.width,
    bottom: bounds.position.y + bounds.size.height,
  };
}

function center(rect: Rectangle): Point {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

function sideFacing(rect: Rectangle, other: Rectangle): Side {
  const a = center(rect);
  const b = center(other);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (
    Math.abs(dx) / Math.max((rect.right - rect.left) / 2, EPSILON) >=
    Math.abs(dy) / Math.max((rect.bottom - rect.top) / 2, EPSILON)
  ) {
    return dx >= 0 ? "right" : "left";
  }
  return dy >= 0 ? "bottom" : "top";
}

function portRange(rect: Rectangle, side: Side): readonly [number, number] {
  const vertical = side === "left" || side === "right";
  const from = vertical ? rect.top : rect.left;
  const to = vertical ? rect.bottom : rect.right;
  const padding = Math.min(PORT_PADDING, (to - from) / 4);
  return [from + padding, to - padding];
}

function preferredCoordinate(rect: Rectangle, side: Side, other: Rectangle): number {
  const a = center(rect);
  const b = center(other);
  const horizontal = side === "top" || side === "bottom";
  const boundary = horizontal ? (side === "top" ? rect.top : rect.bottom) : side === "left" ? rect.left : rect.right;
  const along = horizontal ? a.x : a.y;
  const delta = horizontal ? b.y - a.y : b.x - a.x;
  const preferred =
    Math.abs(delta) <= EPSILON
      ? along
      : along + ((horizontal ? b.x - a.x : b.y - a.y) * (boundary - (horizontal ? a.y : a.x))) / delta;
  const [minimum, maximum] = portRange(rect, side);
  return Math.min(maximum, Math.max(minimum, preferred));
}

function portPoint(rect: Rectangle, side: Side, coordinate: number): Point {
  switch (side) {
    case "top":
      return { x: coordinate, y: rect.top };
    case "bottom":
      return { x: coordinate, y: rect.bottom };
    case "left":
      return { x: rect.left, y: coordinate };
    case "right":
      return { x: rect.right, y: coordinate };
  }
}

function assignPorts(edges: RoutingEdge[]): void {
  const faces = new Map<string, Array<{ edge: RoutingEdge; source: boolean; preferred: number; distance: number }>>();
  for (const edge of edges) {
    const sourceCenter = center(edge.source);
    const targetCenter = center(edge.target);
    const distance = Math.hypot(sourceCenter.x - targetCenter.x, sourceCenter.y - targetCenter.y);
    for (const source of [true, false]) {
      const id = source ? edge.sourceId : edge.targetId;
      const side = source ? edge.sourceSide : edge.targetSide;
      const preferred = preferredCoordinate(
        source ? edge.source : edge.target,
        side,
        source ? edge.target : edge.source,
      );
      const key = JSON.stringify([id, side]);
      const entries = faces.get(key) ?? [];
      entries.push({ edge, source, preferred, distance });
      faces.set(key, entries);
    }
  }
  for (const entries of faces.values()) {
    const first = getOrThrow(entries.at(0), "Missing aggregate port face");
    const rect = first.source ? first.edge.source : first.edge.target;
    const side = first.source ? first.edge.sourceSide : first.edge.targetSide;
    const [minimum, maximum] = portRange(rect, side);
    const faceAxis = side === "top" || side === "bottom" ? "x" : "y";
    const faceCenter = center(rect)[faceAxis];
    const negative = entries.filter(({ preferred }) => preferred < faceCenter - EPSILON);
    const positive = entries.filter(({ preferred }) => preferred > faceCenter + EPSILON);
    const centered = entries
      .filter(({ preferred }) => Math.abs(preferred - faceCenter) <= EPSILON)
      .sort((a, b) => a.distance - b.distance || a.edge.id.localeCompare(b.edge.id));
    for (const entry of centered) (negative.length <= positive.length ? negative : positive).push(entry);

    const rank = (a: (typeof entries)[number], b: (typeof entries)[number]) =>
      a.distance - b.distance ||
      Math.abs(a.preferred - faceCenter) - Math.abs(b.preferred - faceCenter) ||
      a.edge.id.localeCompare(b.edge.id);
    negative.sort(rank);
    positive.sort(rank);
    const gap = Math.min(
      PORT_GAP,
      negative.length ? (faceCenter - minimum) / (negative.length - 0.5) : PORT_GAP,
      positive.length ? (maximum - faceCenter) / (positive.length - 0.5) : PORT_GAP,
    );
    negative.forEach(({ edge, source }, index) => {
      const point = portPoint(rect, side, faceCenter - (index + 0.5) * gap);
      if (source) edge.start = point;
      else edge.end = point;
    });
    positive.forEach(({ edge, source }, index) => {
      const point = portPoint(rect, side, faceCenter + (index + 0.5) * gap);
      if (source) edge.start = point;
      else edge.end = point;
    });
  }
}

function gapAlongSide(point: Point, side: Side, rect: Rectangle): number {
  switch (side) {
    case "top":
      return point.x > rect.left && point.x < rect.right ? point.y - rect.bottom : 0;
    case "bottom":
      return point.x > rect.left && point.x < rect.right ? rect.top - point.y : 0;
    case "left":
      return point.y > rect.top && point.y < rect.bottom ? point.x - rect.right : 0;
    case "right":
      return point.y > rect.top && point.y < rect.bottom ? rect.left - point.x : 0;
  }
}

function outside(point: Point, side: Side, obstacles: readonly Rectangle[], clearance = CLEARANCE): Point {
  let distance = clearance;
  for (const rect of obstacles) {
    const gap = gapAlongSide(point, side, rect);
    if (gap > 0) distance = Math.min(distance, gap / 2);
  }
  switch (side) {
    case "top":
      return { x: point.x, y: point.y - distance };
    case "bottom":
      return { x: point.x, y: point.y + distance };
    case "left":
      return { x: point.x - distance, y: point.y };
    case "right":
      return { x: point.x + distance, y: point.y };
  }
}

function inflate(rect: Rectangle, amount: number): Rectangle {
  return {
    left: rect.left - amount,
    top: rect.top - amount,
    right: rect.right + amount,
    bottom: rect.bottom + amount,
  };
}

function distanceToRectangle(point: Point, rect: Rectangle): number {
  return Math.max(rect.left - point.x, point.x - rect.right, rect.top - point.y, point.y - rect.bottom, 0);
}

function interior(point: Point, rect: Rectangle): boolean {
  return (
    point.x > rect.left + EPSILON &&
    point.x < rect.right - EPSILON &&
    point.y > rect.top + EPSILON &&
    point.y < rect.bottom - EPSILON
  );
}

function contains(outer: Rectangle, inner: Rectangle): boolean {
  return (
    outer.left <= inner.left && outer.right >= inner.right && outer.top <= inner.top && outer.bottom >= inner.bottom
  );
}

function intersects(a: Rectangle, b: Rectangle): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function obstacleCandidates(
  edge: RoutingEdge,
  elements: ReadonlyMap<string, Bounds>,
  virtualGroups: readonly Bounds[],
): Rectangle[] {
  const window = {
    left: Math.min(edge.source.left, edge.target.left) - 128,
    right: Math.max(edge.source.right, edge.target.right) + 128,
    top: Math.min(edge.source.top, edge.target.top) - 128,
    bottom: Math.max(edge.source.bottom, edge.target.bottom) + 128,
  };
  const candidates = [...elements.entries(), ...virtualGroups.map((bounds) => [undefined, bounds] as const)]
    .filter(([id, bounds]) => {
      const rect = rectangle(bounds);
      return (
        (id === edge.sourceId || id === edge.targetId || intersects(rect, window)) &&
        (id === edge.sourceId ||
          id === edge.targetId ||
          (!contains(edge.source, rect) &&
            !contains(edge.target, rect) &&
            !contains(rect, edge.source) &&
            !contains(rect, edge.target)))
      );
    })
    .map(([, bounds]) => rectangle(bounds));
  return candidates.filter(
    (rect, index) =>
      !candidates.some((other, otherIndex) => otherIndex !== index && contains(other, rect) && !contains(rect, other)),
  );
}

function obstaclesFor(candidates: readonly Rectangle[], start: Point, end: Point, clearance = CLEARANCE): Rectangle[] {
  return candidates
    .filter((rect) => !interior(start, rect) && !interior(end, rect))
    .map((rect) =>
      inflate(rect, Math.min(clearance, distanceToRectangle(start, rect), distanceToRectangle(end, rect))),
    );
}

function segment(from: Point, to: Point): Segment {
  return { from, to, axis: from.y === to.y ? "horizontal" : "vertical" };
}

function crossesObstacle(from: Point, to: Point, axis: Axis, rect: Rectangle): boolean {
  if (axis === "horizontal") {
    return (
      from.y > rect.top + EPSILON &&
      from.y < rect.bottom - EPSILON &&
      Math.min(from.x, to.x) < rect.right - EPSILON &&
      Math.max(from.x, to.x) > rect.left + EPSILON
    );
  }
  return (
    from.x > rect.left + EPSILON &&
    from.x < rect.right - EPSILON &&
    Math.min(from.y, to.y) < rect.bottom - EPSILON &&
    Math.max(from.y, to.y) > rect.top + EPSILON
  );
}

function routingGrid(
  start: Point,
  end: Point,
  obstacles: readonly Rectangle[],
  used: readonly Segment[] = [],
  gap = TRACK_GAP,
) {
  const x = new Set([start.x, end.x]);
  const y = new Set([start.y, end.y]);
  for (const rect of obstacles) {
    for (const boundary of [rect.left, rect.right]) {
      for (const offset of [0, gap, gap * 2]) x.add(boundary + (boundary === rect.left ? -offset : offset));
    }
    for (const boundary of [rect.top, rect.bottom]) {
      for (const offset of [0, gap, gap * 2]) y.add(boundary + (boundary === rect.top ? -offset : offset));
    }
  }
  const window = {
    left: Math.min(...x) - gap,
    right: Math.max(...x) + gap,
    top: Math.min(...y) - gap,
    bottom: Math.max(...y) + gap,
  };
  for (const prior of used) {
    if (prior.axis === "horizontal") {
      if (
        prior.from.y < window.top ||
        prior.from.y > window.bottom ||
        Math.max(prior.from.x, prior.to.x) < window.left ||
        Math.min(prior.from.x, prior.to.x) > window.right
      )
        continue;
      for (const offset of [-gap, gap]) y.add(prior.from.y + offset);
    } else {
      if (
        prior.from.x < window.left ||
        prior.from.x > window.right ||
        Math.max(prior.from.y, prior.to.y) < window.top ||
        Math.min(prior.from.y, prior.to.y) > window.bottom
      )
        continue;
      for (const offset of [-gap, gap]) x.add(prior.from.x + offset);
    }
  }
  const xs = [...x].sort((a, b) => a - b);
  const ys = [...y].sort((a, b) => a - b);
  const points: Point[] = [];
  const indices = new Map<string, number>();
  const key = (point: Point) => `${point.x}:${point.y}`;
  for (const yy of ys) {
    for (const xx of xs) {
      const point = { x: xx, y: yy };
      if (obstacles.some((rect) => interior(point, rect))) continue;
      indices.set(key(point), points.length);
      points.push(point);
    }
  }
  const neighbors: Connection[][] = points.map(() => []);
  const link = (a: number, b: number, axis: Axis) => {
    const from = getOrThrow(points[a], "Missing aggregate grid point");
    const to = getOrThrow(points[b], "Missing aggregate grid point");
    if (obstacles.some((rect) => crossesObstacle(from, to, axis, rect))) return;
    const length = axis === "horizontal" ? Math.abs(from.x - to.x) : Math.abs(from.y - to.y);
    neighbors[a]!.push({ point: b, length, axis });
    neighbors[b]!.push({ point: a, length, axis });
  };
  for (const yy of ys) {
    let previous: number | undefined;
    for (const xx of xs) {
      const index = indices.get(key({ x: xx, y: yy }));
      if (index === undefined) continue;
      if (previous !== undefined) link(previous, index, "horizontal");
      previous = index;
    }
  }
  for (const xx of xs) {
    let previous: number | undefined;
    for (const yy of ys) {
      const index = indices.get(key({ x: xx, y: yy }));
      if (index === undefined) continue;
      if (previous !== undefined) link(previous, index, "vertical");
      previous = index;
    }
  }
  return {
    points,
    neighbors,
    startIndex: getOrThrow(indices.get(key(start)), "Missing aggregate grid start"),
    endIndex: getOrThrow(indices.get(key(end)), "Missing aggregate grid end"),
  };
}

function between(value: number, a: number, b: number): boolean {
  return value >= Math.min(a, b) - EPSILON && value <= Math.max(a, b) + EPSILON;
}

function interaction(first: Segment, second: Segment): Readonly<{ point?: Point; overlap: number; crossing: boolean }> {
  if (first.axis === second.axis) {
    const horizontal = first.axis === "horizontal";
    const fixed = horizontal ? "y" : "x";
    const variable = horizontal ? "x" : "y";
    if (Math.abs(first.from[fixed] - second.from[fixed]) > EPSILON) return { overlap: 0, crossing: false };
    const low = Math.max(
      Math.min(first.from[variable], first.to[variable]),
      Math.min(second.from[variable], second.to[variable]),
    );
    const high = Math.min(
      Math.max(first.from[variable], first.to[variable]),
      Math.max(second.from[variable], second.to[variable]),
    );
    if (high - low > EPSILON) return { overlap: high - low, crossing: false };
    if (low - high > EPSILON) return { overlap: 0, crossing: false };
    return {
      point: horizontal ? { x: low, y: first.from.y } : { x: first.from.x, y: low },
      overlap: 0,
      crossing: false,
    };
  }
  const horizontal = first.axis === "horizontal" ? first : second;
  const vertical = first.axis === "vertical" ? first : second;
  const point = { x: vertical.from.x, y: horizontal.from.y };
  if (!between(point.x, horizontal.from.x, horizontal.to.x) || !between(point.y, vertical.from.y, vertical.to.y))
    return { overlap: 0, crossing: false };
  const crossing =
    point.x > Math.min(horizontal.from.x, horizontal.to.x) + EPSILON &&
    point.x < Math.max(horizontal.from.x, horizontal.to.x) - EPSILON &&
    point.y > Math.min(vertical.from.y, vertical.to.y) + EPSILON &&
    point.y < Math.max(vertical.from.y, vertical.to.y) - EPSILON;
  return { point, overlap: 0, crossing };
}

export function measureAggregateSegmentCongestion(
  candidate: Segment,
  used: readonly Segment[],
): Readonly<{ overlapLength: number; crossings: number }> {
  const intervals: Array<readonly [number, number]> = [];
  const crossings = new Set<string>();
  const variable = candidate.axis === "horizontal" ? "x" : "y";
  for (const prior of used) {
    const relation = interaction(candidate, prior);
    if (relation.overlap > EPSILON) {
      intervals.push([
        Math.max(
          Math.min(candidate.from[variable], candidate.to[variable]),
          Math.min(prior.from[variable], prior.to[variable]),
        ),
        Math.min(
          Math.max(candidate.from[variable], candidate.to[variable]),
          Math.max(prior.from[variable], prior.to[variable]),
        ),
      ]);
    } else if (relation.crossing && relation.point) {
      crossings.add(`${relation.point.x}:${relation.point.y}`);
    }
  }
  intervals.sort((a, b) => a.at(0)! - b.at(0)!);
  let overlapLength = 0;
  let end = Number.NEGATIVE_INFINITY;
  for (const [from, to] of intervals) {
    overlapLength += Math.max(0, to - Math.max(from, end));
    end = Math.max(end, to);
  }
  return { overlapLength, crossings: crossings.size };
}

class MinHeap<T extends { cost: number }> {
  private entries: T[] = [];

  push(entry: T): void {
    let index = this.entries.length;
    this.entries.push(entry);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.entries[parent]!.cost <= entry.cost) break;
      this.entries[index] = this.entries[parent]!;
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): T | undefined {
    const first = this.entries.at(0);
    const last = this.entries.pop();
    if (!first || !last || this.entries.length === 0) return first;
    let index = 0;
    while (index * 2 + 1 < this.entries.length) {
      const left = index * 2 + 1;
      const right = left + 1;
      const child = right < this.entries.length && this.entries[right]!.cost < this.entries[left]!.cost ? right : left;
      if (this.entries[child]!.cost >= last.cost) break;
      this.entries[index] = this.entries[child]!;
      index = child;
    }
    this.entries[index] = last;
    return first;
  }
}

function axisOf(side: Side): Axis {
  return side === "left" || side === "right" ? "horizontal" : "vertical";
}

type SearchState = {
  point: number;
  axis: Axis;
  overlapping: boolean;
  length: number;
  cost: number;
  active: boolean;
  previous?: SearchState;
};

function sharesTrack(candidate: Segment, prior: Segment, gap: number): boolean {
  if (prior.axis !== candidate.axis) return false;
  const fixed = candidate.axis === "horizontal" ? "y" : "x";
  const variable = candidate.axis === "horizontal" ? "x" : "y";
  return (
    Math.abs(candidate.from[fixed] - prior.from[fixed]) < gap - EPSILON &&
    Math.min(
      Math.max(candidate.from[variable], candidate.to[variable]),
      Math.max(prior.from[variable], prior.to[variable]),
    ) -
      Math.max(
        Math.min(candidate.from[variable], candidate.to[variable]),
        Math.min(prior.from[variable], prior.to[variable]),
      ) >
      EPSILON
  );
}

function findPath(
  edge: RoutingEdge,
  grid: ReturnType<typeof routingGrid>,
  used: readonly Segment[],
  maxLength = Infinity,
  minimumTrackGap = 0,
): Point[] | undefined {
  const start = getOrThrow(grid.points[grid.startIndex], "Missing aggregate grid start");
  const end = getOrThrow(grid.points[grid.endIndex], "Missing aggregate grid end");
  const constrained = Number.isFinite(maxLength);
  const keyOf = (point: number, axis: Axis, overlapping: boolean) =>
    point * 4 + (axis === "horizontal" ? 0 : 2) + (overlapping ? 1 : 0);
  const first: SearchState = {
    point: grid.startIndex,
    axis: axisOf(edge.sourceSide),
    overlapping: false,
    length: 0,
    cost: 0,
    active: true,
  };
  const states = new Map<number, SearchState[]>([[keyOf(first.point, first.axis, false), [first]]]);
  const heap = new MinHeap<SearchState>();
  const congestionCache = new Map<string, ReturnType<typeof measureAggregateSegmentCongestion>>();
  heap.push(first);
  let best = Infinity;
  let final: SearchState | undefined;

  while (true) {
    const current = heap.pop();
    if (!current || current.cost >= best) break;
    if (!current.active) continue;
    if (current.point === grid.endIndex) {
      const total = current.cost + (current.axis === axisOf(edge.targetSide) ? 0 : BEND_COST);
      if (total < best) {
        best = total;
        final = current;
      }
      continue;
    }
    for (const neighbor of grid.neighbors[current.point] ?? []) {
      const length = current.length + neighbor.length;
      const point = getOrThrow(grid.points[neighbor.point], "Missing aggregate route point");
      if (length + Math.abs(point.x - end.x) + Math.abs(point.y - end.y) > maxLength + EPSILON) continue;
      const candidate = segment(getOrThrow(grid.points[current.point], "Missing aggregate route point"), point);
      if (minimumTrackGap > 0 && used.some((prior) => sharesTrack(candidate, prior, minimumTrackGap))) continue;
      const cacheKey = `${Math.min(current.point, neighbor.point)}:${Math.max(current.point, neighbor.point)}`;
      let traffic = congestionCache.get(cacheKey);
      if (!traffic) {
        traffic = measureAggregateSegmentCongestion(candidate, used);
        congestionCache.set(cacheKey, traffic);
      }
      const overlapping = traffic.overlapLength > EPSILON;
      const cost =
        current.cost +
        neighbor.length +
        traffic.crossings * CROSSING_COST +
        traffic.overlapLength +
        (overlapping && !current.overlapping ? OVERLAP_COST : 0) +
        (current.axis === neighbor.axis ? 0 : BEND_COST);
      const key = keyOf(neighbor.point, neighbor.axis, overlapping);
      const existing = states.get(key) ?? [];
      if (existing.some((state) => state.cost <= cost && (!constrained || state.length <= length))) continue;
      const retained = existing.filter((state) => {
        const dominated = cost <= state.cost && (!constrained || length <= state.length);
        if (dominated) state.active = false;
        return !dominated;
      });
      const next: SearchState = {
        point: neighbor.point,
        axis: neighbor.axis,
        overlapping,
        length,
        cost,
        active: true,
        previous: current,
      };
      retained.push(next);
      states.set(key, retained);
      heap.push(next);
    }
  }

  if (!final) {
    if (minimumTrackGap > 0) return undefined;
    const bend = axisOf(edge.sourceSide) === "horizontal" ? { x: end.x, y: start.y } : { x: start.x, y: end.y };
    return [start, bend, end];
  }
  const path: Point[] = [];
  for (let state: SearchState | undefined = final; state; state = state.previous) {
    path.push(getOrThrow(grid.points[state.point], "Missing aggregate path point"));
  }
  return path.reverse();
}

function routeLength(points: readonly Point[]): number {
  return points.slice(1).reduce((length, point, index) => {
    const previous = getOrThrow(points[index], "Missing aggregate route point");
    return length + Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
  }, 0);
}

function compact(points: readonly Point[]): Point[] {
  const distinct = points.filter((point, index) => {
    const prior = points[index - 1];
    return !prior || prior.x !== point.x || prior.y !== point.y;
  });
  return distinct.filter((point, index) => {
    const prior = distinct[index - 1];
    const next = distinct.at(index + 1);
    return (
      !prior || !next || !((prior.x === point.x && point.x === next.x) || (prior.y === point.y && point.y === next.y))
    );
  });
}

function roundedPath(points: readonly Point[]): string {
  const first = getOrThrow(points.at(0), "Missing aggregate start point");
  let path = `M ${first.x} ${first.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const before = getOrThrow(points[index - 1], "Missing aggregate point");
    const corner = getOrThrow(points[index], "Missing aggregate corner");
    const after = getOrThrow(points.at(index + 1), "Missing aggregate point");
    const priorLength = Math.hypot(corner.x - before.x, corner.y - before.y);
    const nextLength = Math.hypot(after.x - corner.x, after.y - corner.y);
    const radius = Math.min(96, priorLength / 2, nextLength / 2);
    const entry = {
      x: corner.x + ((before.x - corner.x) * radius) / priorLength,
      y: corner.y + ((before.y - corner.y) * radius) / priorLength,
    };
    const exit = {
      x: corner.x + ((after.x - corner.x) * radius) / nextLength,
      y: corner.y + ((after.y - corner.y) * radius) / nextLength,
    };
    path += ` L ${entry.x.toFixed(1)} ${entry.y.toFixed(1)} Q ${corner.x.toFixed(1)} ${corner.y.toFixed(1)} ${exit.x.toFixed(1)} ${exit.y.toFixed(1)}`;
  }
  const last = getOrThrow(points.at(-1), "Missing aggregate end point");
  return `${path} L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
}

function midpoint(points: readonly Point[]): Point {
  const lengths = points.slice(1).map((point, index) => {
    const prior = getOrThrow(points[index], "Missing aggregate midpoint point");
    return Math.hypot(point.x - prior.x, point.y - prior.y);
  });
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = getOrThrow(lengths[index], "Missing aggregate segment length");
    if (remaining <= length) {
      const a = getOrThrow(points[index], "Missing aggregate midpoint start");
      const b = getOrThrow(points.at(index + 1), "Missing aggregate midpoint end");
      const fraction = length ? remaining / length : 0;
      return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
    }
    remaining -= length;
  }
  return getOrThrow(points.at(-1), "Missing aggregate midpoint");
}

export function routeAggregateDependencyEdges(
  projections: readonly Projection[],
  elements: ReadonlyMap<string, Bounds>,
  virtualGroups: readonly Bounds[] = [],
): ReadonlyMap<string, EdgeRoute> {
  const edges: RoutingEdge[] = projections.map((projection) => {
    const source = rectangle(
      getOrThrow(elements.get(projection.sourceId), `Missing aggregate source: ${projection.sourceId}`),
    );
    const target = rectangle(
      getOrThrow(elements.get(projection.targetId), `Missing aggregate target: ${projection.targetId}`),
    );
    return {
      ...projection,
      source,
      target,
      sourceSide: sideFacing(source, target),
      targetSide: sideFacing(target, source),
      start: center(source),
      end: center(target),
    };
  });
  assignPorts(edges);
  const ordered = [...edges].sort(
    (a, b) =>
      Math.abs(a.start.x - a.end.x) +
        Math.abs(a.start.y - a.end.y) -
        Math.abs(b.start.x - b.end.x) -
        Math.abs(b.start.y - b.end.y) || a.id.localeCompare(b.id),
  );
  const used: Segment[] = [];
  const routes = new Map<string, EdgeRoute>();
  for (const edge of ordered) {
    const candidates = obstacleCandidates(edge, elements, virtualGroups);
    const start = outside(edge.start, edge.sourceSide, candidates);
    const end = outside(edge.end, edge.targetSide, candidates);
    const grid = routingGrid(start, end, obstaclesFor(candidates, start, end));
    const baseline = getOrThrow(findPath(edge, grid, []), "Missing aggregate baseline route");
    const baselineLength = routeLength(baseline);
    const maxLength = baselineLength + Math.max(MIN_DETOUR, baselineLength * DETOUR_RATIO);
    const direct = compact([edge.start, ...baseline, edge.end]);
    const directSegments = direct
      .slice(1)
      .map((point, index) => segment(getOrThrow(direct[index], "Missing aggregate route point"), point));
    const clear = directSegments.every(
      (candidate) =>
        !used.some((prior) => sharesTrack(candidate, prior, TRACK_GAP)) &&
        measureAggregateSegmentCongestion(candidate, used).crossings === 0,
    );
    const relevant = used.filter((prior) =>
      directSegments.some((candidate) => sharesTrack(candidate, prior, TRACK_GAP)),
    );
    let route: Point[] | undefined = clear ? baseline : undefined;
    for (const tracks of relevant.length === used.length ? [relevant] : [relevant, used]) {
      for (let gap = TRACK_GAP; !route && gap >= MIN_TRACK_GAP; gap /= 2) {
        const clearance = Math.min(CLEARANCE, gap * 2);
        const candidateStart = outside(edge.start, edge.sourceSide, candidates, clearance);
        const candidateEnd = outside(edge.end, edge.targetSide, candidates, clearance);
        const obstacles = obstaclesFor(candidates, candidateStart, candidateEnd, clearance);
        route = findPath(edge, routingGrid(candidateStart, candidateEnd, obstacles, tracks, gap), used, maxLength, gap);
      }
      if (route) break;
    }
    route ??= getOrThrow(findPath(edge, grid, used, maxLength), "Missing aggregate route");
    const points = compact([edge.start, ...route, edge.end]);
    used.push(
      ...points
        .slice(1)
        .map((point, index) => segment(getOrThrow(points[index], "Missing aggregate segment start"), point)),
    );
    routes.set(edge.id, { path: roundedPath(points), labelPosition: midpoint(points) });
  }
  return routes;
}
