import type { DiagramLayoutPoint, DiagramLayoutSize } from "@/features/diagram/diagram-spatial";
import { getOrThrow } from "@/shared/universal/get-or-throw";

export type TopLevelDependencyRoutingModule = Readonly<{
  id: string;
  position: DiagramLayoutPoint;
  size: DiagramLayoutSize;
}>;

export type TopLevelDependencyRoutingEdge = Readonly<{
  id: string;
  source: string;
  target: string;
}>;

export type RoutedTopLevelDependencyEdge = Readonly<{
  id: string;
  points: readonly DiagramLayoutPoint[];
}>;

export type DependencyEdgeRoutingOptions = Readonly<{
  bounds?: Readonly<{
    position: DiagramLayoutPoint;
    size: DiagramLayoutSize;
  }>;
  clearance?: number;
  trackGap?: number;
  trackCount?: number;
  getObstacles?: (edge: TopLevelDependencyRoutingEdge) => readonly TopLevelDependencyRoutingModule[];
}>;

type Side = "top" | "right" | "bottom" | "left";
type Axis = "horizontal" | "vertical";

type Rectangle = Readonly<{
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}>;

type RoutingEdge = {
  id: string;
  source: string;
  target: string;
  sourceRectangle: Rectangle;
  targetRectangle: Rectangle;
  sourceSide: Side;
  targetSide: Side;
  sourcePoint?: DiagramLayoutPoint;
  targetPoint?: DiagramLayoutPoint;
};

type Segment = Readonly<{
  start: DiagramLayoutPoint;
  end: DiagramLayoutPoint;
  axis: Axis;
}>;

type GraphConnection = Readonly<{
  target: number;
  segment: Segment;
}>;

type QueueEntry = Readonly<{
  key: string;
  cost: number;
}>;

type ResolvedRoutingOptions = Readonly<{
  bounds?: Rectangle;
  clearance: number;
  trackGap: number;
  trackCount: number;
  getObstacles?: DependencyEdgeRoutingOptions["getObstacles"];
}>;

const DEFAULT_MODULE_CLEARANCE = 32;
const DEFAULT_ROUTING_TRACK_GAP = 16;
const DEFAULT_ROUTING_TRACK_COUNT = 2;
const PORT_PADDING = 48;
const PORT_GAP = 32;
const BEND_COST = 256;
const CROSSING_COST = 4_000;
const OVERLAP_COST = 6_000;
const EPSILON = 0.001;

function getCenter(rectangle: Rectangle): DiagramLayoutPoint {
  return {
    x: (rectangle.left + rectangle.right) / 2,
    y: (rectangle.top + rectangle.bottom) / 2,
  };
}

function toRectangle(module: TopLevelDependencyRoutingModule): Rectangle {
  return {
    id: module.id,
    left: module.position.x,
    top: module.position.y,
    right: module.position.x + module.size.width,
    bottom: module.position.y + module.size.height,
  };
}

function resolveRoutingOptions(options?: DependencyEdgeRoutingOptions): ResolvedRoutingOptions {
  return {
    ...(options?.bounds
      ? {
          bounds: toRectangle({ id: "routing-bounds", ...options.bounds }),
        }
      : {}),
    clearance: options?.clearance ?? DEFAULT_MODULE_CLEARANCE,
    trackGap: options?.trackGap ?? DEFAULT_ROUTING_TRACK_GAP,
    trackCount: options?.trackCount ?? DEFAULT_ROUTING_TRACK_COUNT,
    ...(options?.getObstacles ? { getObstacles: options.getObstacles } : {}),
  };
}

function inflateRectangle(rectangle: Rectangle, amount: number): Rectangle {
  return {
    id: rectangle.id,
    left: rectangle.left - amount,
    top: rectangle.top - amount,
    right: rectangle.right + amount,
    bottom: rectangle.bottom + amount,
  };
}

function getPreferredSide(rectangle: Rectangle, opposite: Rectangle): Side {
  const center = getCenter(rectangle);
  const oppositeCenter = getCenter(opposite);
  const horizontalDistance = oppositeCenter.x - center.x;
  const verticalDistance = oppositeCenter.y - center.y;
  const horizontalScale = Math.max((rectangle.right - rectangle.left) / 2, EPSILON);
  const verticalScale = Math.max((rectangle.bottom - rectangle.top) / 2, EPSILON);

  if (Math.abs(horizontalDistance) / horizontalScale >= Math.abs(verticalDistance) / verticalScale) {
    return horizontalDistance >= 0 ? "right" : "left";
  }
  return verticalDistance >= 0 ? "bottom" : "top";
}

function getPreferredSides(source: Rectangle, target: Rectangle): Readonly<{ source: Side; target: Side }> {
  return {
    source: getPreferredSide(source, target),
    target: getPreferredSide(target, source),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function getPortRange(rectangle: Rectangle, side: Side): Readonly<{ minimum: number; maximum: number }> {
  const vertical = side === "left" || side === "right";
  const minimum = vertical ? rectangle.top : rectangle.left;
  const maximum = vertical ? rectangle.bottom : rectangle.right;
  const padding = Math.min(PORT_PADDING, (maximum - minimum) / 4);
  return { minimum: minimum + padding, maximum: maximum - padding };
}

function getPreferredPortCoordinate(rectangle: Rectangle, side: Side, opposite: Rectangle): number {
  const center = getCenter(rectangle);
  const oppositeCenter = getCenter(opposite);
  const range = getPortRange(rectangle, side);

  if (side === "top" || side === "bottom") {
    const boundary = side === "top" ? rectangle.top : rectangle.bottom;
    const delta = oppositeCenter.y - center.y;
    const coordinate =
      Math.abs(delta) <= EPSILON
        ? center.x
        : center.x + (oppositeCenter.x - center.x) * ((boundary - center.y) / delta);
    return clamp(coordinate, range.minimum, range.maximum);
  }

  const boundary = side === "left" ? rectangle.left : rectangle.right;
  const delta = oppositeCenter.x - center.x;
  const coordinate =
    Math.abs(delta) <= EPSILON ? center.y : center.y + (oppositeCenter.y - center.y) * ((boundary - center.x) / delta);
  return clamp(coordinate, range.minimum, range.maximum);
}

function fitPortCoordinates(coordinates: readonly number[], minimum: number, maximum: number): number[] {
  const fitted = [...coordinates];
  const first = fitted.at(0);
  const last = fitted.at(-1);
  if (first === undefined || last === undefined) return fitted;
  const offset = last > maximum ? maximum - last : first < minimum ? minimum - first : 0;
  return fitted.map((coordinate) => coordinate + offset);
}

function spreadPortCoordinates(
  preferredCoordinates: readonly number[],
  minimum: number,
  maximum: number,
): readonly number[] {
  if (preferredCoordinates.length <= 1) {
    return preferredCoordinates.map((coordinate) => clamp(coordinate, minimum, maximum));
  }

  const gap = Math.min(PORT_GAP, (maximum - minimum) / (preferredCoordinates.length - 1));
  const forward = preferredCoordinates.map((coordinate) => clamp(coordinate, minimum, maximum));
  for (let index = 1; index < forward.length; index += 1) {
    forward[index] = Math.max(forward[index]!, forward[index - 1]! + gap);
  }
  const fittedForward = fitPortCoordinates(forward, minimum, maximum);

  const backward = preferredCoordinates.map((coordinate) => clamp(coordinate, minimum, maximum));
  for (let index = backward.length - 2; index >= 0; index -= 1) {
    backward[index] = Math.min(backward[index]!, backward.at(index + 1)! - gap);
  }
  const fittedBackward = fitPortCoordinates(backward, minimum, maximum);

  return fittedForward.map((coordinate, index) => (coordinate + fittedBackward[index]!) / 2);
}

function getPortPoint(rectangle: Rectangle, side: Side, coordinate: number): DiagramLayoutPoint {
  return side === "top" || side === "bottom"
    ? { x: coordinate, y: side === "top" ? rectangle.top : rectangle.bottom }
    : { x: side === "left" ? rectangle.left : rectangle.right, y: coordinate };
}

function getPortSortValue(edge: RoutingEdge, endpoint: "source" | "target"): number {
  const rectangle = endpoint === "source" ? edge.sourceRectangle : edge.targetRectangle;
  const side = endpoint === "source" ? edge.sourceSide : edge.targetSide;
  const opposite = endpoint === "source" ? edge.targetRectangle : edge.sourceRectangle;
  return getPreferredPortCoordinate(rectangle, side, opposite);
}

function assignPortPoints(edges: RoutingEdge[]): void {
  const endpointGroups = new Map<string, { edge: RoutingEdge; endpoint: "source" | "target" }[]>();

  for (const edge of edges) {
    for (const endpoint of ["source", "target"] as const) {
      const moduleId = endpoint === "source" ? edge.source : edge.target;
      const side = endpoint === "source" ? edge.sourceSide : edge.targetSide;
      const key = `${moduleId}:${side}`;
      const group = endpointGroups.get(key) ?? [];
      group.push({ edge, endpoint });
      endpointGroups.set(key, group);
    }
  }

  for (const group of endpointGroups.values()) {
    group.sort(
      (first, second) =>
        getPortSortValue(first.edge, first.endpoint) - getPortSortValue(second.edge, second.endpoint) ||
        first.edge.id.localeCompare(second.edge.id),
    );
    const first = group.at(0);
    if (!first) continue;
    const rectangle = first.endpoint === "source" ? first.edge.sourceRectangle : first.edge.targetRectangle;
    const side = first.endpoint === "source" ? first.edge.sourceSide : first.edge.targetSide;
    const range = getPortRange(rectangle, side);
    const coordinates = spreadPortCoordinates(
      group.map(({ edge, endpoint }) => getPortSortValue(edge, endpoint)),
      range.minimum,
      range.maximum,
    );

    group.forEach(({ edge, endpoint }, index) => {
      const point = getPortPoint(
        rectangle,
        side,
        getOrThrow(coordinates[index], `Missing port coordinate: ${edge.id}`),
      );
      if (endpoint === "source") edge.sourcePoint = point;
      else edge.targetPoint = point;
    });
  }
}

function movePointOutward(point: DiagramLayoutPoint, side: Side, distance: number): DiagramLayoutPoint {
  switch (side) {
    case "top":
      return { x: point.x, y: point.y - distance };
    case "right":
      return { x: point.x + distance, y: point.y };
    case "bottom":
      return { x: point.x, y: point.y + distance };
    case "left":
      return { x: point.x - distance, y: point.y };
  }
}

function getSideAxis(side: Side): Axis {
  return side === "top" || side === "bottom" ? "vertical" : "horizontal";
}

function isInsideRectangle(point: DiagramLayoutPoint, rectangle: Rectangle): boolean {
  return (
    point.x > rectangle.left + EPSILON &&
    point.x < rectangle.right - EPSILON &&
    point.y > rectangle.top + EPSILON &&
    point.y < rectangle.bottom - EPSILON
  );
}

function toSegment(start: DiagramLayoutPoint, end: DiagramLayoutPoint): Segment {
  return {
    start,
    end,
    axis: start.y === end.y ? "horizontal" : "vertical",
  };
}

function segmentCrossesRectangle(segment: Segment, rectangle: Rectangle): boolean {
  if (segment.axis === "horizontal") {
    if (segment.start.y <= rectangle.top + EPSILON || segment.start.y >= rectangle.bottom - EPSILON) return false;
    const start = Math.min(segment.start.x, segment.end.x);
    const end = Math.max(segment.start.x, segment.end.x);
    return start < rectangle.right - EPSILON && end > rectangle.left + EPSILON;
  }

  if (segment.start.x <= rectangle.left + EPSILON || segment.start.x >= rectangle.right - EPSILON) return false;
  const start = Math.min(segment.start.y, segment.end.y);
  const end = Math.max(segment.start.y, segment.end.y);
  return start < rectangle.bottom - EPSILON && end > rectangle.top + EPSILON;
}

function isSegmentClear(segment: Segment, obstacles: readonly Rectangle[]): boolean {
  return !obstacles.some((obstacle) => segmentCrossesRectangle(segment, obstacle));
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((first, second) => first - second);
}

function getRoutingCoordinates(
  start: DiagramLayoutPoint,
  end: DiagramLayoutPoint,
  obstacles: readonly Rectangle[],
  options: ResolvedRoutingOptions,
): Readonly<{ x: readonly number[]; y: readonly number[] }> {
  const x = [start.x, end.x];
  const y = [start.y, end.y];

  for (const obstacle of obstacles) {
    x.push(obstacle.left, obstacle.right);
    y.push(obstacle.top, obstacle.bottom);
    for (let lane = 1; lane <= options.trackCount; lane += 1) {
      const offset = options.trackGap * lane;
      x.push(obstacle.left - offset, obstacle.right + offset);
      y.push(obstacle.top - offset, obstacle.bottom + offset);
    }
  }

  if (options.bounds) {
    x.push(options.bounds.left, options.bounds.right);
    y.push(options.bounds.top, options.bounds.bottom);
  } else {
    const minLeft = Math.min(...obstacles.map(({ left }) => left), start.x, end.x);
    const maxRight = Math.max(...obstacles.map(({ right }) => right), start.x, end.x);
    const minTop = Math.min(...obstacles.map(({ top }) => top), start.y, end.y);
    const maxBottom = Math.max(...obstacles.map(({ bottom }) => bottom), start.y, end.y);
    x.push(minLeft - options.trackGap, maxRight + options.trackGap);
    y.push(minTop - options.trackGap, maxBottom + options.trackGap);
  }

  return {
    x: uniqueSorted(x).filter(
      (value) => !options.bounds || (value >= options.bounds.left && value <= options.bounds.right),
    ),
    y: uniqueSorted(y).filter(
      (value) => !options.bounds || (value >= options.bounds.top && value <= options.bounds.bottom),
    ),
  };
}

function getPointKey(point: DiagramLayoutPoint): string {
  return `${point.x}:${point.y}`;
}

function buildRoutingGraph(
  start: DiagramLayoutPoint,
  end: DiagramLayoutPoint,
  obstacles: readonly Rectangle[],
  options: ResolvedRoutingOptions,
): Readonly<{
  points: readonly DiagramLayoutPoint[];
  connections: ReadonlyMap<number, readonly GraphConnection[]>;
  startIndex: number;
  endIndex: number;
}> {
  const coordinates = getRoutingCoordinates(start, end, obstacles, options);
  const points: DiagramLayoutPoint[] = [];
  const pointIndexByKey = new Map<string, number>();

  for (const y of coordinates.y) {
    for (const x of coordinates.x) {
      const point = { x, y };
      if (obstacles.some((obstacle) => isInsideRectangle(point, obstacle))) continue;
      pointIndexByKey.set(getPointKey(point), points.length);
      points.push(point);
    }
  }

  const connections = new Map<number, GraphConnection[]>();
  const connect = (first: number, second: number): void => {
    const segment = toSegment(
      getOrThrow(points[first], `Missing routing point: ${first}`),
      getOrThrow(points[second], `Missing routing point: ${second}`),
    );
    if (!isSegmentClear(segment, obstacles)) return;
    const firstConnections = connections.get(first) ?? [];
    const secondConnections = connections.get(second) ?? [];
    firstConnections.push({ target: second, segment });
    secondConnections.push({ target: first, segment: toSegment(segment.end, segment.start) });
    connections.set(first, firstConnections);
    connections.set(second, secondConnections);
  };

  for (const y of coordinates.y) {
    const row = coordinates.x
      .map((x) => pointIndexByKey.get(getPointKey({ x, y })))
      .filter((index): index is number => index !== undefined);
    for (let index = 1; index < row.length; index += 1) connect(row[index - 1]!, row[index]!);
  }
  for (const x of coordinates.x) {
    const column = coordinates.y
      .map((y) => pointIndexByKey.get(getPointKey({ x, y })))
      .filter((index): index is number => index !== undefined);
    for (let index = 1; index < column.length; index += 1) connect(column[index - 1]!, column[index]!);
  }

  return {
    points,
    connections,
    startIndex: getOrThrow(pointIndexByKey.get(getPointKey(start)), "Missing routing start point."),
    endIndex: getOrThrow(pointIndexByKey.get(getPointKey(end)), "Missing routing end point."),
  };
}

function getSegmentLength(segment: Segment): number {
  return Math.abs(segment.end.x - segment.start.x) + Math.abs(segment.end.y - segment.start.y);
}

function getOverlapLength(first: Segment, second: Segment): number {
  if (first.axis !== second.axis) return 0;
  if (first.axis === "horizontal") {
    if (Math.abs(first.start.y - second.start.y) > EPSILON) return 0;
    return Math.max(
      0,
      Math.min(Math.max(first.start.x, first.end.x), Math.max(second.start.x, second.end.x)) -
        Math.max(Math.min(first.start.x, first.end.x), Math.min(second.start.x, second.end.x)),
    );
  }
  if (Math.abs(first.start.x - second.start.x) > EPSILON) return 0;
  return Math.max(
    0,
    Math.min(Math.max(first.start.y, first.end.y), Math.max(second.start.y, second.end.y)) -
      Math.max(Math.min(first.start.y, first.end.y), Math.min(second.start.y, second.end.y)),
  );
}

function segmentsCross(first: Segment, second: Segment): boolean {
  if (first.axis === second.axis) return false;
  const horizontal = first.axis === "horizontal" ? first : second;
  const vertical = first.axis === "vertical" ? first : second;
  const horizontalStart = Math.min(horizontal.start.x, horizontal.end.x);
  const horizontalEnd = Math.max(horizontal.start.x, horizontal.end.x);
  const verticalStart = Math.min(vertical.start.y, vertical.end.y);
  const verticalEnd = Math.max(vertical.start.y, vertical.end.y);
  return (
    vertical.start.x > horizontalStart + EPSILON &&
    vertical.start.x < horizontalEnd - EPSILON &&
    horizontal.start.y > verticalStart + EPSILON &&
    horizontal.start.y < verticalEnd - EPSILON
  );
}

function getCongestionCost(segment: Segment, usedSegments: readonly Segment[]): number {
  return usedSegments.reduce((cost, usedSegment) => {
    const overlap = getOverlapLength(segment, usedSegment);
    if (overlap > EPSILON) return cost + OVERLAP_COST + overlap;
    return cost + (segmentsCross(segment, usedSegment) ? CROSSING_COST : 0);
  }, 0);
}

class MinQueue {
  readonly #entries: QueueEntry[] = [];

  push(entry: QueueEntry): void {
    this.#entries.push(entry);
    let index = this.#entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.#entries[parent]!.cost <= entry.cost) break;
      this.#entries[index] = this.#entries[parent]!;
      index = parent;
    }
    this.#entries[index] = entry;
  }

  pop(): QueueEntry | undefined {
    const first = this.#entries.at(0);
    const last = this.#entries.pop();
    if (!first || !last || this.#entries.length === 0) return first;
    let index = 0;
    this.#entries[0] = last;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.#entries.length) break;
      const child =
        right < this.#entries.length && this.#entries[right]!.cost < this.#entries[left]!.cost ? right : left;
      if (this.#entries[child]!.cost >= this.#entries[index]!.cost) break;
      [this.#entries[index], this.#entries[child]] = [this.#entries[child]!, this.#entries[index]!];
      index = child;
    }
    return first;
  }
}

function getStateKey(pointIndex: number, axis: Axis): string {
  return `${pointIndex}:${axis}`;
}

function parseStateKey(key: string): Readonly<{ pointIndex: number; axis: Axis }> {
  const separator = key.lastIndexOf(":");
  return {
    pointIndex: Number(key.slice(0, separator)),
    axis: key.slice(separator + 1) as Axis,
  };
}

function findRoute(
  start: DiagramLayoutPoint,
  end: DiagramLayoutPoint,
  startAxis: Axis,
  endAxis: Axis,
  obstacles: readonly Rectangle[],
  usedSegments: readonly Segment[],
  options: ResolvedRoutingOptions,
): readonly DiagramLayoutPoint[] {
  const graph = buildRoutingGraph(start, end, obstacles, options);
  const queue = new MinQueue();
  const costs = new Map<string, number>();
  const previous = new Map<string, string>();
  const startKey = getStateKey(graph.startIndex, startAxis);
  costs.set(startKey, 0);
  queue.push({ key: startKey, cost: 0 });

  while (true) {
    const current = queue.pop();
    if (!current) break;
    if (current.cost !== costs.get(current.key)) continue;
    const state = parseStateKey(current.key);

    for (const connection of graph.connections.get(state.pointIndex) ?? []) {
      const nextKey = getStateKey(connection.target, connection.segment.axis);
      const nextCost =
        current.cost +
        getSegmentLength(connection.segment) +
        getCongestionCost(connection.segment, usedSegments) +
        (state.axis === connection.segment.axis ? 0 : BEND_COST);
      if (nextCost >= (costs.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      costs.set(nextKey, nextCost);
      previous.set(nextKey, current.key);
      queue.push({ key: nextKey, cost: nextCost });
    }
  }

  const endStates = (["horizontal", "vertical"] as const)
    .map((axis) => {
      const key = getStateKey(graph.endIndex, axis);
      const cost = costs.get(key);
      return cost === undefined ? undefined : { key, cost: cost + (axis === endAxis ? 0 : BEND_COST) };
    })
    .filter((state): state is QueueEntry => state !== undefined)
    .sort((first, second) => first.cost - second.cost);
  const best = endStates.at(0);
  if (!best) return [start, end];

  const pointIndexes: number[] = [];
  let key: string | undefined = best.key;
  while (key) {
    pointIndexes.push(parseStateKey(key).pointIndex);
    key = previous.get(key);
  }

  return pointIndexes
    .reverse()
    .map((pointIndex) => getOrThrow(graph.points[pointIndex], `Missing routed point: ${pointIndex}`));
}

function compactPoints(points: readonly DiagramLayoutPoint[]): readonly DiagramLayoutPoint[] {
  const unique = points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });

  return unique.filter((point, index) => {
    const previous = unique[index - 1];
    const next = unique.at(index + 1);
    if (!previous || !next) return true;
    return !((previous.x === point.x && point.x === next.x) || (previous.y === point.y && point.y === next.y));
  });
}

function toSegments(points: readonly DiagramLayoutPoint[]): Segment[] {
  const segments: Segment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (start && end) segments.push(toSegment(start, end));
  }
  return segments;
}

export function routeDependencyEdges(
  modules: readonly TopLevelDependencyRoutingModule[],
  edges: readonly TopLevelDependencyRoutingEdge[],
  options?: DependencyEdgeRoutingOptions,
): readonly RoutedTopLevelDependencyEdge[] {
  const resolvedOptions = resolveRoutingOptions(options);
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  const rectangleById = new Map(modules.map((module) => [module.id, toRectangle(module)]));
  const routingEdges = edges.map((edge): RoutingEdge => {
    const sourceRectangle = getOrThrow(rectangleById.get(edge.source), `Missing routing source: ${edge.source}`);
    const targetRectangle = getOrThrow(rectangleById.get(edge.target), `Missing routing target: ${edge.target}`);
    const sides = getPreferredSides(sourceRectangle, targetRectangle);
    return {
      ...edge,
      sourceRectangle,
      targetRectangle,
      sourceSide: sides.source,
      targetSide: sides.target,
    };
  });
  assignPortPoints(routingEdges);
  const usedSegments: Segment[] = [];
  const routedById = new Map<string, RoutedTopLevelDependencyEdge>();

  const orderedEdges = [...routingEdges].sort((first, second) => {
    const firstSource = getOrThrow(first.sourcePoint, `Missing source port: ${first.id}`);
    const firstTarget = getOrThrow(first.targetPoint, `Missing target port: ${first.id}`);
    const secondSource = getOrThrow(second.sourcePoint, `Missing source port: ${second.id}`);
    const secondTarget = getOrThrow(second.targetPoint, `Missing target port: ${second.id}`);
    const firstLength = Math.abs(firstSource.x - firstTarget.x) + Math.abs(firstSource.y - firstTarget.y);
    const secondLength = Math.abs(secondSource.x - secondTarget.x) + Math.abs(secondSource.y - secondTarget.y);
    return firstLength - secondLength || first.id.localeCompare(second.id);
  });

  for (const edge of orderedEdges) {
    const sourcePoint = getOrThrow(edge.sourcePoint, `Missing source port: ${edge.id}`);
    const targetPoint = getOrThrow(edge.targetPoint, `Missing target port: ${edge.id}`);
    const start = movePointOutward(sourcePoint, edge.sourceSide, resolvedOptions.clearance);
    const end = movePointOutward(targetPoint, edge.targetSide, resolvedOptions.clearance);
    const projectedEdge = { id: edge.id, source: edge.source, target: edge.target };
    const obstacleModules = resolvedOptions.getObstacles?.(projectedEdge) ?? modules;
    const obstacleById = new Map(
      [
        getOrThrow(moduleById.get(edge.source), `Missing source module: ${edge.source}`),
        getOrThrow(moduleById.get(edge.target), `Missing target module: ${edge.target}`),
        ...obstacleModules,
      ].map((module) => [module.id, module]),
    );
    const obstacles = [...obstacleById.values()]
      .map((module) => inflateRectangle(toRectangle(module), resolvedOptions.clearance))
      .filter((obstacle) => !isInsideRectangle(start, obstacle) && !isInsideRectangle(end, obstacle));
    const route = findRoute(
      start,
      end,
      getSideAxis(edge.sourceSide),
      getSideAxis(edge.targetSide),
      obstacles,
      usedSegments,
      resolvedOptions,
    );
    const points = compactPoints([sourcePoint, ...route, targetPoint]);
    usedSegments.push(...toSegments(points));
    routedById.set(edge.id, { id: edge.id, points });
  }

  return edges.map(({ id }) => getOrThrow(routedById.get(id), `Missing routed dependency edge: ${id}`));
}

export function routeTopLevelDependencyEdges(
  modules: readonly TopLevelDependencyRoutingModule[],
  edges: readonly TopLevelDependencyRoutingEdge[],
): readonly RoutedTopLevelDependencyEdge[] {
  return routeDependencyEdges(modules, edges);
}
