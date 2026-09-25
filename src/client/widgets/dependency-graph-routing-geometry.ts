import type { DiagramLayoutPoint, DiagramLayoutSize } from "@/features/diagram/diagram-spatial";
import { getOrThrow } from "@/shared/universal/get-or-throw";

export type Point = DiagramLayoutPoint;
export type Bounds = Readonly<{ position: Point; size: DiagramLayoutSize }>;
export type Rectangle = Readonly<{ left: number; top: number; right: number; bottom: number }>;
export type Side = "top" | "right" | "bottom" | "left";
export type Projection = Readonly<{ id: string; sourceId: string; targetId: string }>;
export type Segment = Readonly<{ from: Point; to: Point; axis: "horizontal" | "vertical" }>;

export const EPSILON = 0.001;
export const CLEARANCE = 64;
export const TRACK_GAP = 32;
export const MIN_GAP = 4;

export function rectangle(bounds: Bounds): Rectangle {
  return {
    left: bounds.position.x,
    top: bounds.position.y,
    right: bounds.position.x + bounds.size.width,
    bottom: bounds.position.y + bounds.size.height,
  };
}

export function center(rect: Rectangle): Point {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

export function portPoint(rect: Rectangle, side: Side, coordinate: number): Point {
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

export function portRange(rect: Rectangle, side: Side): readonly [number, number] {
  const vertical = side === "left" || side === "right";
  const from = vertical ? rect.top : rect.left;
  const to = vertical ? rect.bottom : rect.right;
  const padding = Math.min(48, (to - from) / 4);
  return [from + padding, to - padding];
}

export function sideFacing(rect: Rectangle, other: Rectangle): Side {
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

export function compact(points: readonly Point[]): Point[] {
  const distinct = points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });
  return distinct.filter((point, index) => {
    const previous = index > 0 ? distinct.at(index - 1) : undefined;
    const next = distinct.at(index + 1);
    if (!previous || !next) return true;
    if (previous.x === point.x && point.x === next.x) {
      return (point.y - previous.y) * (next.y - point.y) <= 0;
    }
    if (previous.y === point.y && point.y === next.y) {
      return (point.x - previous.x) * (next.x - point.x) <= 0;
    }
    return true;
  });
}

export function routeLength(points: readonly Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    length += Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
  }
  return length;
}

export function midpoint(points: readonly Point[]): Point {
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

export function interior(point: Point, rect: Rectangle): boolean {
  return (
    point.x > rect.left + EPSILON &&
    point.x < rect.right - EPSILON &&
    point.y > rect.top + EPSILON &&
    point.y < rect.bottom - EPSILON
  );
}

export function crossesObstacle(from: Point, to: Point, rect: Rectangle): boolean {
  if (from.x === to.x && from.y === to.y) return false;
  if (from.y === to.y) {
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

export function segments(points: readonly Point[]): Segment[] {
  const result: Segment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    if (from.x === to.x && from.y === to.y) continue;
    result.push({ from, to, axis: from.y === to.y ? "horizontal" : "vertical" });
  }
  return result;
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

export class MinHeap<T extends { priority: number; cost: number }> {
  private entries: T[] = [];

  private earlier(a: T, b: T): boolean {
    return a.priority < b.priority || (a.priority === b.priority && a.cost < b.cost);
  }

  push(entry: T): void {
    let index = this.entries.length;
    this.entries.push(entry);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.earlier(entry, this.entries[parent]!)) break;
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
      const child =
        right < this.entries.length && this.earlier(this.entries[right]!, this.entries[left]!) ? right : left;
      if (!this.earlier(this.entries[child]!, last)) break;
      this.entries[index] = this.entries[child]!;
      index = child;
    }
    this.entries[index] = last;
    return first;
  }
}
