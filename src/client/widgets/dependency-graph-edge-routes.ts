import type { DiagramLayout, DiagramLayoutPoint, DiagramLayoutSize } from "@/features/diagram/diagram-spatial";
import { getPolylineEdgeLabelPlacement } from "@/shared/react-flow/polyline-edge-label-placement";
import { getOrThrow } from "@/shared/universal/get-or-throw";

type Bounds = Readonly<{ position: DiagramLayoutPoint; size: DiagramLayoutSize }>;
type Point = DiagramLayoutPoint;
type Cubic = Readonly<{ start: Point; first: Point; second: Point; end: Point }>;
type Metrics = Readonly<{ length: number; intrusion: number; touch: number; deepest: number; overshoot: number }>;
type CurveCandidate = Readonly<{ curve: Cubic; metrics: Metrics; score: number }>;
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
