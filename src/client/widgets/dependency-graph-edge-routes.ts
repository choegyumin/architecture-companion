import type { DiagramLayout, DiagramLayoutPoint, DiagramLayoutSize } from "@/features/diagram/diagram-spatial";
import { getPolylineEdgeLabelPlacement } from "@/shared/react-flow/polyline-edge-label-placement";
import { getOrThrow } from "@/shared/universal/get-or-throw";

type Bounds = Readonly<{ position: DiagramLayoutPoint; size: DiagramLayoutSize }>;
type Point = DiagramLayoutPoint;
type Cubic = Readonly<{ start: Point; first: Point; second: Point; end: Point }>;
type Side = "top" | "right" | "bottom" | "left";
type Metrics = Readonly<{ length: number; intrusion: number; touch: number; deepest: number; overshoot: number }>;
type CurveCandidate = Readonly<{ curve: Cubic; metrics: Metrics; score: number }>;
type AggregateInput = Readonly<{ id: string; sourceId: string; targetId: string }>;
type Aggregate = {
  id: string;
  sourceId: string;
  targetId: string;
  source: Bounds;
  target: Bounds;
  sourceSide: Side;
  targetSide: Side;
  start: Point;
  end: Point;
};
type OrthogonalCandidate = Readonly<{
  points: readonly Point[];
  segments: readonly (readonly [Point, Point])[];
  crossings: number;
  cost: number;
}>;

export type EdgeRoute = Readonly<{ path: string; labelPosition: Point }>;

export function getDependencyElementBounds(layout: DiagramLayout): ReadonlyMap<string, Bounds> {
  const groups = new Map(layout.groups.map((group) => [group.id, group]));
  const origins = new Map<string, Point>();
  const originOf = (groupId: string): Point => {
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function center(bounds: Bounds): Point {
  return { x: bounds.position.x + bounds.size.width / 2, y: bounds.position.y + bounds.size.height / 2 };
}

function anchors(source: Bounds, target: Bounds): Readonly<{ start: Point; end: Point; normal: Point }> {
  const a = center(source);
  const b = center(target);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const vertical = Math.abs(dy) >= Math.abs(dx) * 0.85;
  const sign = Math.sign(vertical ? dy : dx) || 1;
  return vertical
    ? {
        start: { x: a.x, y: source.position.y + (sign > 0 ? source.size.height : 0) },
        end: { x: b.x, y: target.position.y + (sign > 0 ? 0 : target.size.height) },
        normal: { x: 0, y: sign },
      }
    : {
        start: { x: source.position.x + (sign > 0 ? source.size.width : 0), y: a.y },
        end: { x: target.position.x + (sign > 0 ? 0 : target.size.width), y: b.y },
        normal: { x: sign, y: 0 },
      };
}

function directCurve(start: Point, end: Point, normal: Point): Cubic {
  const handle = clamp(distance(start, end) * 0.45, 32, 96);
  return {
    start,
    first: { x: start.x + normal.x * handle, y: start.y + normal.y * handle },
    second: { x: end.x - normal.x * handle, y: end.y - normal.y * handle },
    end,
  };
}

function outwardCurve(
  start: Point,
  end: Point,
  normal: Point,
  offset: number,
  handle: number,
  endOffset = offset,
  endHandle = handle,
): Cubic {
  const length = distance(start, end) || 1;
  const tangent = { x: -normal.y, y: normal.x };
  const side = { x: -(end.y - start.y) / length, y: (end.x - start.x) / length };
  const sideAlong = side.x * tangent.x + side.y * tangent.y;
  const sideOut = side.x * normal.x + side.y * normal.y;
  const endOut = (end.x - start.x) * normal.x + (end.y - start.y) * normal.y;
  const endAlong = (end.x - start.x) * tangent.x + (end.y - start.y) * tangent.y;
  const departureAlong = sideAlong * offset;
  const requestedOut = handle + sideOut * offset;
  const departureOut = Math.max(handle, requestedOut, Math.abs(departureAlong));
  const arrivalOut = Math.max(0, endOut - endHandle + sideOut * endOffset - (departureOut - requestedOut));
  const arrivalAlong = endAlong + sideAlong * endOffset;
  return {
    start,
    first: {
      x: start.x + normal.x * departureOut + tangent.x * departureAlong,
      y: start.y + normal.y * departureOut + tangent.y * departureAlong,
    },
    second: {
      x: start.x + normal.x * arrivalOut + tangent.x * arrivalAlong,
      y: start.y + normal.y * arrivalOut + tangent.y * arrivalAlong,
    },
    end,
  };
}

function sampleCurve(curve: Cubic, t: number): Point {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * curve.start.x +
      3 * inverse ** 2 * t * curve.first.x +
      3 * inverse * t ** 2 * curve.second.x +
      t ** 3 * curve.end.x,
    y:
      inverse ** 3 * curve.start.y +
      3 * inverse ** 2 * t * curve.first.y +
      3 * inverse * t ** 2 * curve.second.y +
      t ** 3 * curve.end.y,
  };
}

function nearbyCards(curve: Cubic, cards: readonly Bounds[]): Bounds[] {
  const left = Math.min(curve.start.x, curve.first.x, curve.second.x, curve.end.x);
  const right = Math.max(curve.start.x, curve.first.x, curve.second.x, curve.end.x);
  const top = Math.min(curve.start.y, curve.first.y, curve.second.y, curve.end.y);
  const bottom = Math.max(curve.start.y, curve.first.y, curve.second.y, curve.end.y);
  return cards.filter(
    ({ position, size }) =>
      position.x + size.width > left && position.x < right && position.y + size.height > top && position.y < bottom,
  );
}

function measureCurve(curve: Cubic, cards: readonly Bounds[], source: Bounds, target: Bounds): Metrics {
  const nearby = nearbyCards(curve, cards);
  const inside = new Map<Bounds, number>();
  const checkX = Math.abs(curve.end.x - curve.start.x) > (source.size.width + target.size.width) / 4;
  const checkY = Math.abs(curve.end.y - curve.start.y) > ((source.size.height + target.size.height) / 2) * 1.5;
  let length = 0;
  let intrusion = 0;
  let touch = 0;
  let deepest = 0;
  let overshoot = 0;
  let previous = curve.start;
  for (let step = 1; step <= 32; step += 1) {
    const point = sampleCurve(curve, step / 32);
    const stepLength = distance(previous, point);
    length += stepLength;
    if (checkX) {
      overshoot = Math.max(
        overshoot,
        Math.min(curve.start.x, curve.end.x) - point.x,
        point.x - Math.max(curve.start.x, curve.end.x),
      );
    }
    if (checkY) {
      overshoot = Math.max(
        overshoot,
        Math.min(curve.start.y, curve.end.y) - point.y,
        point.y - Math.max(curve.start.y, curve.end.y),
      );
    }
    for (const card of nearby) {
      const { x, y } = card.position;
      const { width, height } = card.size;
      if (point.x > x && point.x < x + width && point.y > y && point.y < y + height) touch += stepLength;
      if (point.x > x + 14 && point.x < x + width - 14 && point.y > y + 12 && point.y < y + height - 12) {
        const total = (inside.get(card) ?? 0) + stepLength;
        inside.set(card, total);
        intrusion += stepLength;
        deepest = Math.max(deepest, total);
      }
    }
    previous = point;
  }
  return { length, intrusion, touch, deepest, overshoot };
}

function centerRisk(curve: Cubic, cards: readonly Bounds[]): ReadonlyMap<Bounds, number> {
  const nearby = nearbyCards(curve, cards);
  const risk = new Map<Bounds, number>();
  if (nearby.length === 0) return risk;
  const controlLength =
    distance(curve.start, curve.first) + distance(curve.first, curve.second) + distance(curve.second, curve.end);
  const steps = clamp(Math.ceil(controlLength / 5), 64, 256);
  for (let step = 0; step <= steps; step += 1) {
    const point = sampleCurve(curve, step / steps);
    for (const card of nearby) {
      const relativeX = Math.abs(point.x - card.position.x - card.size.width / 2) / (card.size.width / 2 - 14);
      const relativeY = Math.abs(point.y - card.position.y - card.size.height / 2) / (card.size.height / 2 - 12);
      const value = 1 - Math.max(relativeX, relativeY);
      if (value > (risk.get(card) ?? 0)) risk.set(card, value);
    }
  }
  return risk;
}

function centerRegression(result: ReadonlyMap<Bounds, number>, baseline: ReadonlyMap<Bounds, number>): number {
  let regression = 0;
  result.forEach((risk, card) => {
    regression = Math.max(regression, risk - (baseline.get(card) ?? 0));
  });
  return regression;
}

function lateralSeparation(candidate: Cubic, baseline: Cubic): number {
  const dx = baseline.end.x - baseline.start.x;
  const dy = baseline.end.y - baseline.start.y;
  const length = Math.hypot(dx, dy) || 1;
  return [0.25, 0.5, 0.75].reduce((sum, t) => {
    const point = sampleCurve(candidate, t);
    const reference = sampleCurve(baseline, t);
    return sum + Math.abs(dx * (point.y - reference.y) - dy * (point.x - reference.x)) / length / 3;
  }, 0);
}

function blendCurve(baseline: Cubic, selected: Cubic, weight: number): Cubic {
  return {
    start: baseline.start,
    end: baseline.end,
    first: {
      x: baseline.first.x + (selected.first.x - baseline.first.x) * weight,
      y: baseline.first.y + (selected.first.y - baseline.first.y) * weight,
    },
    second: {
      x: baseline.second.x + (selected.second.x - baseline.second.x) * weight,
      y: baseline.second.y + (selected.second.y - baseline.second.y) * weight,
    },
  };
}

function routeScore(metrics: Metrics, offset: number): number {
  return (
    metrics.length +
    metrics.intrusion * 5 +
    metrics.deepest * 0.9 +
    metrics.touch * 2 +
    metrics.overshoot * 4 +
    Math.abs(offset) * 0.23
  );
}

function movesForward(curve: Cubic, normal: Point): boolean {
  const axis = normal.y ? "y" : "x";
  let previous = 0;
  for (const point of [curve.first, curve.second, curve.end]) {
    const progress = (point[axis] - curve.start[axis]) * normal[axis];
    if (progress < previous - 12) return false;
    previous = progress;
  }
  return true;
}

function curveRoute(curve: Cubic): EdgeRoute {
  return {
    path: `M ${curve.start.x} ${curve.start.y} C ${curve.first.x.toFixed(1)} ${curve.first.y.toFixed(1)} ${curve.second.x.toFixed(1)} ${curve.second.y.toFixed(1)} ${curve.end.x.toFixed(1)} ${curve.end.y.toFixed(1)}`,
    labelPosition: sampleCurve(curve, 0.5),
  };
}

export function routeNodeDependencyEdge(source: Bounds, target: Bounds, otherCards: readonly Bounds[]): EdgeRoute {
  const { start, end, normal } = anchors(source, target);
  const baseline = directCurve(start, end, normal);
  const baseMetrics = measureCurve(baseline, otherCards, source, target);
  if (baseMetrics.deepest < 32) return curveRoute(baseline);

  let selected: CurveCandidate = {
    curve: baseline,
    metrics: baseMetrics,
    score: baseMetrics.length + baseMetrics.intrusion * 5 + baseMetrics.deepest * 0.9,
  };
  const candidates: CurveCandidate[] = [];
  const length = distance(start, end);
  const consider = (curve: Cubic, offset: number) => {
    const metrics = measureCurve(curve, otherCards, source, target);
    if (metrics.length > baseMetrics.length * 1.35) return;
    const candidate = { curve, metrics, score: routeScore(metrics, offset) };
    candidates.push(candidate);
    if (candidate.score < selected.score) selected = candidate;
  };
  for (const offset of [0, 75, -75, 150, -150, 240, -240]) {
    if (Math.abs(offset) > Math.min(290, length * 0.28)) continue;
    for (const scale of [0.28, 0.44]) {
      consider(outwardCurve(start, end, normal, offset, clamp(length * scale, 52, 190)), offset);
    }
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (
    normal.x &&
    Math.abs(dx) > (source.size.width + target.size.width) / 4 &&
    Math.abs(dy) > ((source.size.height + target.size.height) / 2) * 1.5
  ) {
    const direction = Math.sign(dx) * Math.sign(dy);
    for (const first of [160, 200, 240, 320]) {
      if (first > Math.min(330, length * 0.38)) continue;
      for (const last of [80, 160, 200, 240]) {
        for (const handle of [80, 110, 140]) {
          const curve = outwardCurve(start, end, normal, direction * first, handle, -direction * last, 120);
          if (movesForward(curve, normal)) consider(curve, Math.max(first, last));
        }
      }
    }
  }
  if (selected.curve === baseline) return curveRoute(baseline);

  const baselineRisk = centerRisk(baseline, otherCards);
  if (centerRegression(centerRisk(selected.curve, otherCards), baselineRisk) <= 0.25) {
    return curveRoute(selected.curve);
  }
  const requiredSeparation = Math.max(8, lateralSeparation(selected.curve, baseline) * 0.35);
  const maxScore = selected.score + Math.max(150, baseMetrics.length * 0.12);
  const acceptable = (candidate: CurveCandidate): boolean =>
    centerRegression(centerRisk(candidate.curve, otherCards), baselineRisk) <= 0.25 &&
    lateralSeparation(candidate.curve, baseline) >= requiredSeparation &&
    candidate.metrics.length <= baseMetrics.length * 1.35 &&
    candidate.score <= maxScore;
  const existing = candidates
    .filter(acceptable)
    .sort((a, b) => a.score - b.score)
    .at(0);
  if (existing) return curveRoute(existing.curve);

  let intermediate: CurveCandidate | undefined;
  for (const weight of [0.35, 0.5, 0.65]) {
    const curve = blendCurve(baseline, selected.curve, weight);
    const metrics = measureCurve(curve, otherCards, source, target);
    const candidate = { curve, metrics, score: routeScore(metrics, 0) };
    if (acceptable(candidate) && (!intermediate || candidate.score < intermediate.score)) intermediate = candidate;
  }
  return curveRoute(intermediate?.curve ?? selected.curve);
}

export function routeOriginalDependencyEdge(
  points: readonly Point[],
  source: Bounds,
  target: Bounds,
  otherCards: readonly Bounds[],
): EdgeRoute {
  if (points.length < 2) throw new Error("Dependency edge is missing endpoints.");
  if (points.length !== 2) {
    if (source.position.x === target.position.x && source.position.y === target.position.y) {
      const start = getOrThrow(points.at(0), "Missing self-loop start");
      const end = getOrThrow(points.at(-1), "Missing self-loop end");
      const along = Math.min(source.size.width / 6, 48);
      const outward = Math.max(40, along);
      return curveRoute({
        start,
        first: { x: start.x + along, y: start.y - outward },
        second: { x: end.x - along, y: end.y - outward },
        end,
      });
    }
    return {
      path: points.map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" "),
      labelPosition: getPolylineEdgeLabelPlacement(points),
    };
  }
  return routeNodeDependencyEdge(source, target, otherCards);
}

function preferredSides(source: Bounds, target: Bounds): Readonly<{ sourceSide: Side; targetSide: Side }> {
  const a = center(source);
  const b = center(target);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const horizontalGap = Math.abs(dx) - (source.size.width + target.size.width) / 2;
  const verticalGap = Math.abs(dy) - (source.size.height + target.size.height) / 2;
  if (verticalGap > horizontalGap) {
    return dy >= 0 ? { sourceSide: "bottom", targetSide: "top" } : { sourceSide: "top", targetSide: "bottom" };
  }
  return dx >= 0 ? { sourceSide: "right", targetSide: "left" } : { sourceSide: "left", targetSide: "right" };
}

function portOn(bounds: Bounds, side: Side, coordinate: number): Point {
  const { x, y } = bounds.position;
  const { width, height } = bounds.size;
  if (side === "top" || side === "bottom") return { x: coordinate, y: y + (side === "bottom" ? height : 0) };
  return { x: x + (side === "right" ? width : 0), y: coordinate };
}

function distributePorts(aggregates: Aggregate[]): void {
  type Endpoint = { edge: Aggregate; end: "start" | "end"; bounds: Bounds; side: Side; preferred: number };
  const faces = new Map<string, Endpoint[]>();
  for (const edge of aggregates) {
    for (const end of ["start", "end"] as const) {
      const bounds = end === "start" ? edge.source : edge.target;
      const side = end === "start" ? edge.sourceSide : edge.targetSide;
      const opposite = end === "start" ? edge.target : edge.source;
      const horizontal = side === "top" || side === "bottom";
      const start = horizontal ? bounds.position.x : bounds.position.y;
      const size = horizontal ? bounds.size.width : bounds.size.height;
      const preferred = clamp(horizontal ? center(opposite).x : center(opposite).y, start, start + size);
      const key = JSON.stringify([end === "start" ? edge.sourceId : edge.targetId, side]);
      const entries = faces.get(key) ?? [];
      entries.push({ edge, end, bounds, side, preferred });
      faces.set(key, entries);
    }
  }
  for (const entries of faces.values()) {
    entries.sort((a, b) => a.preferred - b.preferred || a.edge.id.localeCompare(b.edge.id));
    const { bounds, side } = getOrThrow(entries.at(0), "Missing dependency edge face");
    const horizontal = side === "top" || side === "bottom";
    const faceStart = horizontal ? bounds.position.x : bounds.position.y;
    const length = horizontal ? bounds.size.width : bounds.size.height;
    const padding = Math.min(40, length / 4);
    const minimum = faceStart + padding;
    const maximum = faceStart + length - padding;
    const gap = entries.length > 1 ? Math.min(36, (maximum - minimum) / (entries.length - 1)) : 0;
    const positions = entries.map(({ preferred }) => clamp(preferred, minimum, maximum));
    for (let index = 1; index < positions.length; index += 1) {
      positions[index] = Math.max(
        getOrThrow(positions[index], "Missing port"),
        getOrThrow(positions[index - 1], "Missing port") + gap,
      );
    }
    const shift = Math.max(0, getOrThrow(positions.at(-1), "Missing last port") - maximum);
    entries.forEach(({ edge, end }, index) => {
      edge[end] = portOn(bounds, side, getOrThrow(positions[index], "Missing port") - shift);
    });
  }
}

function exterior(point: Point, side: Side, clearance: number): Point {
  if (side === "top") return { x: point.x, y: point.y - clearance };
  if (side === "bottom") return { x: point.x, y: point.y + clearance };
  if (side === "left") return { x: point.x - clearance, y: point.y };
  return { x: point.x + clearance, y: point.y };
}

function routeClearance(source: Bounds, target: Bounds, side: Side): number {
  const a = source.position;
  const b = target.position;
  const gap =
    side === "right"
      ? b.x - (a.x + source.size.width)
      : side === "left"
        ? a.x - (b.x + target.size.width)
        : side === "bottom"
          ? b.y - (a.y + source.size.height)
          : a.y - (b.y + target.size.height);
  return gap > 0 ? Math.min(26, Math.max(4, gap / 3)) : 26;
}

function contains(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.position.x >= outer.position.x &&
    inner.position.y >= outer.position.y &&
    inner.position.x + inner.size.width <= outer.position.x + outer.size.width &&
    inner.position.y + inner.size.height <= outer.position.y + outer.size.height
  );
}

function crossesBounds(a: Point, b: Point, bounds: Bounds): boolean {
  const left = bounds.position.x - 8;
  const top = bounds.position.y - 8;
  const right = bounds.position.x + bounds.size.width + 8;
  const bottom = bounds.position.y + bounds.size.height + 8;
  if (a.x === b.x) return a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom;
  if (a.y === b.y) return a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right;
  return false;
}

function reversesDirection(points: readonly Point[]): boolean {
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = getOrThrow(points[index - 1], "Missing route point");
    const corner = getOrThrow(points[index], "Missing route point");
    const next = getOrThrow(points.at(index + 1), "Missing route point");
    if (previous.x === corner.x && corner.x === next.x && (corner.y - previous.y) * (next.y - corner.y) < 0)
      return true;
    if (previous.y === corner.y && corner.y === next.y && (corner.x - previous.x) * (next.x - corner.x) < 0)
      return true;
  }
  return false;
}

function compactPoints(points: readonly Point[]): Point[] {
  const distinct = points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || point.x !== previous.x || point.y !== previous.y;
  });
  return distinct.filter((point, index) => {
    const previous = distinct[index - 1];
    const next = distinct.at(index + 1);
    return (
      !previous ||
      !next ||
      ((point.x !== previous.x || point.x !== next.x) && (point.y !== previous.y || point.y !== next.y))
    );
  });
}

function roundedPath(points: readonly Point[]): string {
  const route = compactPoints(points);
  const first = getOrThrow(route.at(0), "Missing aggregate route start");
  let path = `M ${first.x} ${first.y}`;
  for (let index = 1; index < route.length - 1; index += 1) {
    const previous = getOrThrow(route[index - 1], "Missing previous route point");
    const corner = getOrThrow(route[index], "Missing route corner");
    const next = getOrThrow(route.at(index + 1), "Missing next route point");
    const before = distance(previous, corner);
    const after = distance(corner, next);
    const radius = Math.min(14, before / 2, after / 2);
    const entry = {
      x: corner.x + ((previous.x - corner.x) * radius) / before,
      y: corner.y + ((previous.y - corner.y) * radius) / before,
    };
    const exit = {
      x: corner.x + ((next.x - corner.x) * radius) / after,
      y: corner.y + ((next.y - corner.y) * radius) / after,
    };
    path += ` L ${entry.x.toFixed(1)} ${entry.y.toFixed(1)} Q ${corner.x.toFixed(1)} ${corner.y.toFixed(1)} ${exit.x.toFixed(1)} ${exit.y.toFixed(1)}`;
  }
  const last = getOrThrow(route.at(-1), "Missing aggregate route end");
  return `${path} L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
}

function routeMidpoint(points: readonly Point[]): Point {
  const segments = points
    .slice(1)
    .map((point, index) => distance(getOrThrow(points[index], "Missing route point"), point));
  let remaining = segments.reduce((sum, length) => sum + length, 0) / 2;
  for (let index = 0; index < segments.length; index += 1) {
    const length = getOrThrow(segments[index], "Missing route length");
    if (remaining <= length) {
      const a = getOrThrow(points[index], "Missing route point");
      const b = getOrThrow(points.at(index + 1), "Missing route point");
      const ratio = length ? remaining / length : 0;
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
    }
    remaining -= length;
  }
  return getOrThrow(points.at(-1), "Missing route end");
}

function sharedLength(first: OrthogonalCandidate, second: OrthogonalCandidate): number {
  let shared = 0;
  for (const [a, b] of first.segments) {
    for (const [c, d] of second.segments) {
      if (a.x === b.x && c.x === d.x && Math.abs(a.x - c.x) < 8) {
        const length = Math.max(
          0,
          Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)),
        );
        shared += length * (1 - Math.abs(a.x - c.x) / 8);
      }
      if (a.y === b.y && c.y === d.y && Math.abs(a.y - c.y) < 8) {
        const length = Math.max(
          0,
          Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)),
        );
        shared += length * (1 - Math.abs(a.y - c.y) / 8);
      }
    }
  }
  return shared;
}

function corridorTracks(tracks: ReadonlySet<number>, departure: number, arrival: number): number[] {
  const values = [...tracks];
  const midpoint = (departure + arrival) / 2;
  const chosen = new Set([departure, arrival, midpoint, Math.min(...values), Math.max(...values)]);
  for (const anchor of [departure, arrival, midpoint]) {
    values
      .toSorted((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor))
      .slice(0, 6)
      .forEach((value) => chosen.add(value));
  }
  return [...chosen];
}

function aggregateCandidates(edge: Aggregate, elements: ReadonlyMap<string, Bounds>): OrthogonalCandidate[] {
  const { source, target, start, end, sourceSide, targetSide } = edge;
  const clearance = routeClearance(source, target, sourceSide);
  const departure = exterior(start, sourceSide, clearance);
  const arrival = exterior(end, targetSide, clearance);
  const searchLeft = Math.min(source.position.x, target.position.x) - 96;
  const searchRight = Math.max(source.position.x + source.size.width, target.position.x + target.size.width) + 96;
  const searchTop = Math.min(source.position.y, target.position.y) - 96;
  const searchBottom = Math.max(source.position.y + source.size.height, target.position.y + target.size.height) + 96;
  const obstacles = [...elements.entries()]
    .filter(
      ([id, bounds]) =>
        id !== edge.sourceId &&
        id !== edge.targetId &&
        !contains(source, bounds) &&
        !contains(target, bounds) &&
        !contains(bounds, source) &&
        !contains(bounds, target) &&
        bounds.position.x < searchRight &&
        bounds.position.x + bounds.size.width > searchLeft &&
        bounds.position.y < searchBottom &&
        bounds.position.y + bounds.size.height > searchTop,
    )
    .map(([, bounds]) => bounds);
  const xTracks = new Set([departure.x, arrival.x, (departure.x + arrival.x) / 2]);
  const yTracks = new Set([departure.y, arrival.y, (departure.y + arrival.y) / 2]);
  for (const bounds of [source, target, ...obstacles]) {
    for (const clearance of [24, 60, 96]) {
      xTracks.add(bounds.position.x - clearance);
      xTracks.add(bounds.position.x + bounds.size.width + clearance);
      yTracks.add(bounds.position.y - clearance);
      yTracks.add(bounds.position.y + bounds.size.height + clearance);
    }
  }
  const xCorridors = corridorTracks(xTracks, departure.x, arrival.x);
  const yCorridors = corridorTracks(yTracks, departure.y, arrival.y);
  const candidates = new Map<string, OrthogonalCandidate>();
  const consider = (waypoints: readonly Point[]) => {
    const proposed = [start, departure, ...waypoints, arrival, end];
    if (reversesDirection(proposed)) return;
    const points = compactPoints(proposed);
    const segments = points
      .slice(1)
      .map((point, index): readonly [Point, Point] => [getOrThrow(points[index], "Missing route point"), point]);
    if (segments.some(([a, b]) => a.x !== b.x && a.y !== b.y)) return;
    const key = points.map(({ x, y }) => `${x},${y}`).join(";");
    if (candidates.has(key)) return;
    const crossings = segments.reduce(
      (count, [a, b]) => count + obstacles.filter((bounds) => crossesBounds(a, b, bounds)).length,
      0,
    );
    const length = segments.reduce((total, [a, b]) => total + distance(a, b), 0);
    candidates.set(key, { points, segments, crossings, cost: length + (points.length - 2) * 16 });
  };
  const sourceHorizontal = sourceSide === "left" || sourceSide === "right";
  const targetHorizontal = targetSide === "left" || targetSide === "right";
  if (sourceHorizontal && targetHorizontal) {
    for (const x of xCorridors)
      consider([
        { x, y: departure.y },
        { x, y: arrival.y },
      ]);
    for (const y of yCorridors)
      consider([
        { x: departure.x, y },
        { x: arrival.x, y },
      ]);
    for (const x of xCorridors) {
      for (const y of yCorridors)
        consider([
          { x, y: departure.y },
          { x, y },
          { x: arrival.x, y },
        ]);
    }
  } else if (!sourceHorizontal && !targetHorizontal) {
    for (const y of yCorridors)
      consider([
        { x: departure.x, y },
        { x: arrival.x, y },
      ]);
    for (const x of xCorridors)
      consider([
        { x, y: departure.y },
        { x, y: arrival.y },
      ]);
  } else if (sourceHorizontal) {
    consider([{ x: arrival.x, y: departure.y }]);
    for (const x of xCorridors) {
      for (const y of yCorridors)
        consider([
          { x, y: departure.y },
          { x, y },
          { x: arrival.x, y },
        ]);
    }
  } else {
    consider([{ x: departure.x, y: arrival.y }]);
    for (const x of xCorridors) {
      for (const y of yCorridors)
        consider([
          { x: departure.x, y },
          { x, y },
          { x, y: arrival.y },
        ]);
    }
  }
  const options = [...candidates.values()];
  const minimum = Math.min(...options.map(({ crossings }) => crossings));
  const clear = options.filter(({ crossings }) => crossings === minimum).sort((a, b) => a.cost - b.cost);
  const shortest = getOrThrow(clear.at(0), "Missing aggregate candidate").cost;
  const viable = clear.filter(({ cost }) => cost <= shortest + Math.max(300, distance(start, end) * 0.75));
  const chosen = new Set(viable.slice(0, 16));
  const left = Math.min(source.position.x, target.position.x);
  const right = Math.max(source.position.x + source.size.width, target.position.x + target.size.width);
  const top = Math.min(source.position.y, target.position.y);
  const bottom = Math.max(source.position.y + source.size.height, target.position.y + target.size.height);
  for (const outside of [
    (point: Point) => point.x < left,
    (point: Point) => point.x > right,
    (point: Point) => point.y < top,
    (point: Point) => point.y > bottom,
  ]) {
    viable
      .filter(({ points }) => points.some(outside))
      .slice(0, 3)
      .forEach((candidate) => chosen.add(candidate));
  }
  return [...chosen];
}

export function routeAggregateDependencyEdges(
  projections: readonly AggregateInput[],
  elements: ReadonlyMap<string, Bounds>,
): ReadonlyMap<string, EdgeRoute> {
  const aggregates: Aggregate[] = projections.map(({ id, sourceId, targetId }) => {
    const source = getOrThrow(elements.get(sourceId), `Missing aggregate source: ${sourceId}`);
    const target = getOrThrow(elements.get(targetId), `Missing aggregate target: ${targetId}`);
    const { sourceSide, targetSide } = preferredSides(source, target);
    return {
      id,
      sourceId,
      targetId,
      source,
      target,
      sourceSide,
      targetSide,
      start: center(source),
      end: center(target),
    };
  });
  distributePorts(aggregates);
  const pairs = new Map<string, Aggregate[]>();
  for (const edge of aggregates) {
    const key = JSON.stringify([edge.sourceId, edge.targetId].sort());
    const pair = pairs.get(key) ?? [];
    pair.push(edge);
    pairs.set(key, pair);
  }
  const routes = new Map<string, EdgeRoute>();
  const routed: OrthogonalCandidate[] = [];
  for (const pair of pairs.values()) {
    const candidates = pair.map((edge) =>
      aggregateCandidates(edge, elements).map((route) => ({
        route,
        score:
          route.cost +
          Math.min(
            600,
            routed.reduce((sum, previous) => sum + sharedLength(route, previous) * 15, 0),
          ),
      })),
    );
    let selection: OrthogonalCandidate[];
    if (pair.length === 1) {
      const best = getOrThrow(candidates.at(0), "Missing aggregate candidates").reduce((current, candidate) =>
        candidate.score < current.score ? candidate : current,
      );
      selection = [best.route];
    } else {
      const first = getOrThrow(candidates.at(0), "Missing forward candidates");
      const second = getOrThrow(candidates.at(1), "Missing reverse candidates");
      let bestScore = Infinity;
      selection = [];
      for (const forward of first) {
        for (const reverse of second) {
          const score = forward.score + reverse.score + sharedLength(forward.route, reverse.route) * 40;
          if (score < bestScore) {
            bestScore = score;
            selection = [forward.route, reverse.route];
          }
        }
      }
    }
    pair.forEach((edge, index) => {
      const chosen = getOrThrow(selection[index], `Missing aggregate route: ${edge.id}`);
      routes.set(edge.id, { path: roundedPath(chosen.points), labelPosition: routeMidpoint(chosen.points) });
      routed.push(chosen);
    });
  }
  return routes;
}
