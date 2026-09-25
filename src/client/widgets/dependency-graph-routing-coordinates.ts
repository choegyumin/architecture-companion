import type { EdgeRoute } from "./dependency-graph-edge-routes";
import {
  CLEARANCE,
  compact,
  crossesObstacle,
  EPSILON,
  midpoint,
  MIN_GAP,
  MinHeap,
  type Point,
  type Rectangle,
  routeLength,
  type Segment,
  segments,
  TRACK_GAP,
} from "./dependency-graph-routing-geometry";
import {
  resourcePoint,
  type RoutingPlan,
  type RoutingResource,
  spend,
  type WorkBudget,
} from "./dependency-graph-routing-plan";
import type { createRoutingQuery, RoutingScene } from "./dependency-graph-routing-scene";

type Slot = Readonly<{ edgeId: string; resource: RoutingResource; preferred: number }>;
type Separation = Readonly<{ before: number; after: number; preferred: number }>;
type Connection = Readonly<{
  edgeId: string;
  index: number;
  from: Point;
  to: Point;
  entry: RoutingResource;
  exit: RoutingResource;
}>;
type ConnectionPath = Readonly<{ points: readonly Point[]; cost: number }>;

const MAX_ALIGNMENT_RETRIES = 128;
const MAX_CELL_AXIS_COORDINATES = 20;
const MAX_CELL_EXPANSIONS = 1_024;
const CROSSING_COST = 4_000;
const BEND_COST = 128;
const roundingClearance = new WeakMap<readonly Point[], number>();

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function roots(parent: readonly number[]): number[] {
  return parent.map((_, index) => {
    while (parent[index] !== index) index = parent[index]!;
    return index;
  });
}

function join(parent: number[], first: number, second: number): void {
  while (parent[first] !== first) first = parent[first]!;
  while (parent[second] !== second) second = parent[second]!;
  parent[Math.max(first, second)] = Math.min(first, second);
}

function solveSlots(
  slots: readonly Slot[],
  separations: readonly Separation[],
  parent: readonly number[],
  preferred: boolean,
  budget: WorkBudget,
): number[] | undefined {
  if (!spend(budget, slots.length + separations.length)) return;
  const root = roots(parent);
  const components = new Map<
    number,
    { min: number; max: number; sum: number; weight: number; fallbackSum: number; count: number }
  >();
  slots.forEach((slot, index) => {
    const id = root[index]!;
    const component = components.get(id) ?? {
      min: -Infinity,
      max: Infinity,
      sum: 0,
      weight: 0,
      fallbackSum: 0,
      count: 0,
    };
    component.min = Math.max(component.min, slot.resource.min);
    component.max = Math.min(component.max, slot.resource.max);
    component.fallbackSum += slot.preferred;
    component.count += 1;
    if (slot.resource.terminal) {
      component.sum += slot.preferred;
      component.weight += 1;
    }
    components.set(id, component);
  });
  const outgoing = new Map<number, Map<number, number>>();
  const indegree = new Map([...components.keys()].map((id) => [id, 0]));
  for (const separation of separations) {
    const before = root[separation.before]!;
    const after = root[separation.after]!;
    if (before === after) return;
    const gap = preferred ? separation.preferred : MIN_GAP;
    const edges = outgoing.get(before) ?? new Map<number, number>();
    if (!edges.has(after)) indegree.set(after, indegree.get(after)! + 1);
    edges.set(after, Math.max(edges.get(after) ?? 0, gap));
    outgoing.set(before, edges);
  }
  const ordered = [...components.keys()].filter((id) => indegree.get(id) === 0);
  for (let cursor = 0; cursor < ordered.length; cursor += 1) {
    const id = ordered[cursor]!;
    const component = components.get(id)!;
    if (component.min > component.max + EPSILON) return;
    for (const [next, gap] of outgoing.get(id) ?? []) {
      if (!spend(budget)) return;
      const successor = components.get(next)!;
      successor.min = Math.max(successor.min, component.min + gap);
      const count = indegree.get(next)! - 1;
      indegree.set(next, count);
      if (count === 0) ordered.push(next);
    }
  }
  if (ordered.length !== components.size) return;
  for (let cursor = ordered.length - 1; cursor >= 0; cursor -= 1) {
    const id = ordered[cursor]!;
    const component = components.get(id)!;
    for (const [next, gap] of outgoing.get(id) ?? []) {
      if (!spend(budget)) return;
      component.max = Math.min(component.max, components.get(next)!.max - gap);
    }
    if (component.min > component.max + EPSILON) return;
  }
  const values = new Map<number, number>();
  for (const id of ordered) {
    const component = components.get(id)!;
    const desired = component.weight ? component.sum / component.weight : component.fallbackSum / component.count;
    const coordinate = clamp(desired, component.min, component.max);
    values.set(id, coordinate);
    for (const [next, gap] of outgoing.get(id) ?? []) {
      if (!spend(budget)) return;
      const successor = components.get(next)!;
      successor.min = Math.max(successor.min, coordinate + gap);
    }
  }
  return root.map((id) => values.get(id)!);
}

function assignSlots(plan: RoutingPlan, budget: WorkBudget): ReadonlyMap<string, readonly number[]> | undefined {
  const slots: Slot[] = [];
  const indices = new Map<string, Map<string, number>>();
  const routes = new Map<string, number[]>();
  const separations: Separation[] = [];
  const alignments: Array<readonly number[]> = [];
  for (const [edgeId, candidate] of [...plan.selected].sort(([a], [b]) => a.localeCompare(b))) {
    const route: number[] = [];
    let run: number[] = [];
    for (const resource of candidate.resources) {
      if (!spend(budget)) return;
      const order = plan.orders.get(resource.key) ?? [];
      const rank = order.indexOf(edgeId);
      if (rank < 0 || (order.length - 1) * MIN_GAP > resource.max - resource.min + EPSILON) return;
      const gap = Math.min(TRACK_GAP, (resource.max - resource.min) / Math.max(1, order.length - 1));
      const halfSpan = ((order.length - 1) * gap) / 2;
      const middle = clamp(
        resource.preferred ?? (resource.min + resource.max) / 2,
        resource.min + halfSpan,
        resource.max - halfSpan,
      );
      const index = slots.length;
      slots.push({
        edgeId,
        resource,
        preferred: middle + (rank - (order.length - 1) / 2) * gap,
      });
      const entries = indices.get(resource.key) ?? new Map<string, number>();
      entries.set(edgeId, index);
      indices.set(resource.key, entries);
      const previous = slots[run.at(-1) ?? -1]?.resource;
      if (previous && (previous.axis !== resource.axis || previous.fixed === resource.fixed)) {
        if (run.length > 1) alignments.push(run);
        run = [];
      }
      run.push(index);
      route.push(index);
    }
    if (run.length > 1) alignments.push(run);
    routes.set(edgeId, route);
  }
  for (const [key, order] of plan.orders) {
    const entries = indices.get(key);
    if (!entries) continue;
    for (let index = 1; index < order.length; index += 1) {
      if (!spend(budget)) return;
      const before = entries.get(order[index - 1]!);
      const after = entries.get(order[index]!);
      if (before === undefined || after === undefined) continue;
      const resource = slots[before]!.resource;
      separations.push({
        before,
        after,
        preferred: Math.min(TRACK_GAP, (resource.max - resource.min) / (order.length - 1)),
      });
    }
  }
  const separate = slots.map((_, index) => index);
  const together = [...separate];
  const mergeRun = (parent: number[], run: readonly number[]) => {
    let minimum = -Infinity;
    let maximum = Infinity;
    let previous: number | undefined;
    for (const index of run) {
      const resource = slots[index]!.resource;
      const low = Math.max(minimum, resource.min);
      const high = Math.min(maximum, resource.max);
      if (low > high + EPSILON) {
        minimum = resource.min;
        maximum = resource.max;
      } else {
        if (previous !== undefined) join(parent, previous, index);
        minimum = low;
        maximum = high;
      }
      previous = index;
    }
  };
  for (const run of alignments) mergeRun(together, run);
  let values =
    solveSlots(slots, separations, together, true, budget) ?? solveSlots(slots, separations, together, false, budget);
  if (!values && !budget.exhausted) {
    let parent = separate;
    values = solveSlots(slots, separations, parent, false, budget);
    if (!values) return;
    // Only conflicting runs lose alignment; unrelated slab boundaries remain invisible.
    for (const run of alignments.slice(0, MAX_ALIGNMENT_RETRIES)) {
      if (!spend(budget, run.length)) return;
      const trial = [...parent];
      mergeRun(trial, run);
      const solved = solveSlots(slots, separations, trial, false, budget);
      if (solved) {
        parent = trial;
        values = solved;
      }
      if (budget.exhausted) return;
    }
    values = solveSlots(slots, separations, parent, true, budget) ?? values;
  }
  if (!values) return;
  return new Map([...routes].map(([id, route]) => [id, route.map((index) => values[index]!)]));
}

function within(value: number, from: number, to: number): boolean {
  return value >= Math.min(from, to) - EPSILON && value <= Math.max(from, to) + EPSILON;
}

function interaction(
  first: Segment,
  second: Segment,
): Readonly<{ valid: boolean; crossing: number; clearance: number }> {
  if (first.axis === second.axis) {
    const fixed = first.axis === "horizontal" ? "y" : "x";
    const variable = first.axis === "horizontal" ? "x" : "y";
    const distance = Math.abs(first.from[fixed] - second.from[fixed]);
    const low = Math.max(
      Math.min(first.from[variable], first.to[variable]),
      Math.min(second.from[variable], second.to[variable]),
    );
    const high = Math.min(
      Math.max(first.from[variable], first.to[variable]),
      Math.max(second.from[variable], second.to[variable]),
    );
    const clearance = Math.hypot(distance, Math.max(0, low - high));
    return {
      valid: clearance > EPSILON && (high - low <= EPSILON || distance >= MIN_GAP - EPSILON),
      crossing: 0,
      clearance,
    };
  }
  const horizontal = first.axis === "horizontal" ? first : second;
  const vertical = first.axis === "vertical" ? first : second;
  const x = vertical.from.x;
  const y = horizontal.from.y;
  const dx = Math.max(
    Math.min(horizontal.from.x, horizontal.to.x) - x,
    x - Math.max(horizontal.from.x, horizontal.to.x),
    0,
  );
  const dy = Math.max(Math.min(vertical.from.y, vertical.to.y) - y, y - Math.max(vertical.from.y, vertical.to.y), 0);
  if (dx > EPSILON || dy > EPSILON) return { valid: true, crossing: 0, clearance: Math.hypot(dx, dy) };
  const crossing =
    x > Math.min(horizontal.from.x, horizontal.to.x) + EPSILON &&
    x < Math.max(horizontal.from.x, horizontal.to.x) - EPSILON &&
    y > Math.min(vertical.from.y, vertical.to.y) + EPSILON &&
    y < Math.max(vertical.from.y, vertical.to.y) - EPSILON;
  return { valid: crossing, crossing: crossing ? 1 : 0, clearance: Infinity };
}

function normal(resource: RoutingResource, rect: Rectangle): Point {
  return resource.axis === "x"
    ? { x: 0, y: Math.abs(resource.fixed - rect.top) <= EPSILON ? 1 : -1 }
    : { x: Math.abs(resource.fixed - rect.left) <= EPSILON ? 1 : -1, y: 0 };
}

function follows(from: Point, to: Point, direction: Point): boolean {
  return direction.x
    ? Math.abs(from.y - to.y) <= EPSILON && (to.x - from.x) * direction.x > EPSILON
    : Math.abs(from.x - to.x) <= EPSILON && (to.y - from.y) * direction.y > EPSILON;
}

function connectorCost(
  points: readonly Point[],
  connection: Connection,
  rect: Rectangle,
  used: readonly Segment[],
  budget: WorkBudget,
): number | undefined {
  if (
    points.length < 2 ||
    !follows(points.at(0)!, points.at(1)!, normal(connection.entry, rect)) ||
    !follows(points.at(-1)!, points.at(-2)!, normal(connection.exit, rect))
  )
    return;
  for (const point of points) {
    if (!within(point.x, rect.left, rect.right) || !within(point.y, rect.top, rect.bottom)) return;
  }
  const own = segments(points);
  let crossings = 0;
  for (let index = 0; index < own.length; index += 1) {
    const segment = own[index]!;
    if (segment.from.x !== segment.to.x && segment.from.y !== segment.to.y) return;
    for (const prior of used) {
      if (!spend(budget)) return;
      const relation = interaction(segment, prior);
      if (!relation.valid) return;
      crossings += relation.crossing;
    }
    for (let other = 0; other < index - 1; other += 1) {
      if (!spend(budget)) return;
      const relation = interaction(segment, own[other]!);
      if (!relation.valid || relation.crossing) return;
    }
  }
  return routeLength(points) + Math.max(0, points.length - 2) * BEND_COST + crossings * CROSSING_COST;
}

function tracks(min: number, max: number, preferred: number, coordinates: readonly number[]): number[] {
  const inset = Math.min(CLEARANCE, (max - min) / 4);
  const low = min + inset;
  const high = max - inset;
  const nearEnds = coordinates.slice(0, 2).flatMap((coordinate) => [coordinate - MIN_GAP, coordinate + MIN_GAP]);
  const alternatives = [
    (low + high) / 2,
    ...coordinates.flatMap((coordinate) => [
      coordinate - TRACK_GAP,
      coordinate + TRACK_GAP,
      coordinate - MIN_GAP,
      coordinate + MIN_GAP,
    ]),
  ].sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b);
  // Keep escapes near both endpoints when the bounded cell search samples a long corridor.
  return [
    ...new Set(
      [clamp(preferred, low, high), low, high, ...nearEnds, ...alternatives].filter(
        (value) => value >= low && value <= high,
      ),
    ),
  ].slice(0, MAX_CELL_AXIS_COORDINATES - 2);
}

function searchConnector(
  connection: Connection,
  rect: Rectangle,
  xs: readonly number[],
  ys: readonly number[],
  used: readonly Segment[],
  budget: WorkBudget,
): ConnectionPath | undefined {
  type State = {
    point: Point;
    direction: "horizontal" | "vertical" | undefined;
    cost: number;
    priority: number;
    previous?: State;
  };
  const start = connection.from;
  const end = connection.to;
  const distance = (point: Point) => Math.abs(point.x - end.x) + Math.abs(point.y - end.y);
  const heap = new MinHeap<State>();
  heap.push({ point: start, direction: undefined, cost: 0, priority: distance(start) });
  const best = new Map<string, number>();
  for (let iteration = 0; iteration < MAX_CELL_EXPANSIONS; iteration += 1) {
    if (!spend(budget)) return;
    const state = heap.pop();
    if (!state) return;
    const key = `${state.point.x}:${state.point.y}:${state.direction}`;
    if (state.cost > (best.get(key) ?? Infinity)) continue;
    if (state.point.x === end.x && state.point.y === end.y) {
      const points: Point[] = [];
      for (let current: State | undefined = state; current; current = current.previous) points.push(current.point);
      points.reverse();
      const result = compact(points);
      const cost = connectorCost(result, connection, rect, used, budget);
      if (cost !== undefined) return { points: result, cost };
      continue;
    }
    for (const direction of ["horizontal", "vertical"] as const) {
      for (const coordinate of direction === "horizontal" ? xs : ys) {
        if (!spend(budget)) return;
        const next =
          direction === "horizontal" ? { x: coordinate, y: state.point.y } : { x: state.point.x, y: coordinate };
        if (next.x === state.point.x && next.y === state.point.y) continue;
        if (!state.previous && !follows(start, next, normal(connection.entry, rect))) continue;
        const atEnd = next.x === end.x && next.y === end.y;
        if (atEnd && !follows(end, state.point, normal(connection.exit, rect))) continue;
        if (
          !atEnd &&
          (next.x <= rect.left + EPSILON ||
            next.x >= rect.right - EPSILON ||
            next.y <= rect.top + EPSILON ||
            next.y >= rect.bottom - EPSILON)
        )
          continue;
        const segment: Segment = { from: state.point, to: next, axis: direction };
        let crossings = 0;
        let valid = true;
        for (const prior of used) {
          if (!spend(budget)) return;
          const relation = interaction(segment, prior);
          if (!relation.valid) {
            valid = false;
            break;
          }
          crossings += relation.crossing;
        }
        if (!valid) continue;
        const cost =
          state.cost +
          Math.abs(next.x - state.point.x) +
          Math.abs(next.y - state.point.y) +
          (state.direction && state.direction !== direction ? BEND_COST : 0) +
          crossings * CROSSING_COST;
        const nextKey = `${next.x}:${next.y}:${direction}`;
        if (cost >= (best.get(nextKey) ?? Infinity)) continue;
        best.set(nextKey, cost);
        heap.push({ point: next, direction, cost, priority: cost + distance(next), previous: state });
      }
    }
  }
}

function connectCell(
  connection: Connection,
  rect: Rectangle,
  rank: number,
  count: number,
  used: readonly Segment[],
  budget: WorkBudget,
): ConnectionPath | undefined {
  const { from, to } = connection;
  const xs = tracks(rect.left, rect.right, rect.left + ((rect.right - rect.left) * (rank + 1)) / (count + 1), [
    from.x,
    to.x,
    ...used.flatMap(({ from, to }) => [from.x, to.x]),
  ]);
  const ys = tracks(rect.top, rect.bottom, rect.top + ((rect.bottom - rect.top) * (rank + 1)) / (count + 1), [
    from.y,
    to.y,
    ...used.flatMap(({ from, to }) => [from.y, to.y]),
  ]);
  let best: ConnectionPath | undefined;
  const consider = (points: readonly Point[]) => {
    if (!spend(budget)) return;
    const result = compact(points);
    const cost = connectorCost(result, connection, rect, used, budget);
    if (cost !== undefined && (!best || cost < best.cost)) best = { points: result, cost };
  };
  if (from.x === to.x || from.y === to.y) consider([from, to]);
  consider([from, { x: from.x, y: to.y }, to]);
  consider([from, { x: to.x, y: from.y }, to]);
  if (best && best.points.length <= 3 && best.cost < CROSSING_COST) return best;
  if (connection.entry.axis === connection.exit.axis) {
    for (const coordinate of connection.entry.axis === "y" ? xs : ys) {
      if (budget.exhausted) break;
      consider(
        connection.entry.axis === "y"
          ? [from, { x: coordinate, y: from.y }, { x: coordinate, y: to.y }, to]
          : [from, { x: from.x, y: coordinate }, { x: to.x, y: coordinate }, to],
      );
    }
  } else {
    for (const x of xs.slice(0, 8)) {
      for (const y of ys.slice(0, 8)) {
        if (budget.exhausted) break;
        consider(
          connection.entry.axis === "y"
            ? [from, { x, y: from.y }, { x, y }, { x: to.x, y }, to]
            : [from, { x: from.x, y }, { x, y }, { x, y: to.y }, to],
        );
      }
    }
  }
  if (best || budget.exhausted) return best;
  return searchConnector(
    connection,
    rect,
    [...new Set([from.x, to.x, ...xs])],
    [...new Set([from.y, to.y, ...ys])],
    used,
    budget,
  );
}

function boundaryPosition(point: Point, rect: Rectangle): number {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (Math.abs(point.y - rect.top) <= EPSILON) return point.x - rect.left;
  if (Math.abs(point.x - rect.right) <= EPSILON) return width + point.y - rect.top;
  if (Math.abs(point.y - rect.bottom) <= EPSILON) return width + height + rect.right - point.x;
  return width * 2 + height + rect.bottom - point.y;
}

function hullIntrudes(points: readonly Point[], rect: Rectangle): boolean {
  const corners: Point[] = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
  const axes: Point[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]!;
    const length = Math.hypot(next.x - point.x, next.y - point.y);
    if (length > EPSILON) axes.push({ x: (point.y - next.y) / length, y: (next.x - point.x) / length });
  });
  for (const axis of axes) {
    const project = (point: Point) => point.x * axis.x + point.y * axis.y;
    const a = points.map(project);
    const b = corners.map(project);
    if (Math.max(...a) <= Math.min(...b) + EPSILON || Math.max(...b) <= Math.min(...a) + EPSILON) return false;
  }
  return true;
}

export function renderRoutingPath(points: readonly Point[], obstacles: readonly Rectangle[]): EdgeRoute | undefined {
  if (points.length < 2 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return;
  const route = compact(points);
  if (route.length < 2) return;
  for (const segment of segments(route)) {
    if (segment.from.x !== segment.to.x && segment.from.y !== segment.to.y) return;
    if (obstacles.some((obstacle) => crossesObstacle(segment.from, segment.to, obstacle))) return;
  }
  const tip = route.at(-1)!;
  const previous = route.at(-2)!;
  const dx = Math.sign(tip.x - previous.x);
  const dy = Math.sign(tip.y - previous.y);
  const arrow: Rectangle = dx
    ? {
        left: Math.min(tip.x, tip.x - dx * 20),
        right: Math.max(tip.x, tip.x - dx * 20),
        top: tip.y - 10,
        bottom: tip.y + 10,
      }
    : {
        left: tip.x - 10,
        right: tip.x + 10,
        top: Math.min(tip.y, tip.y - dy * 20),
        bottom: Math.max(tip.y, tip.y - dy * 20),
      };
  if (
    obstacles.some(
      (obstacle) =>
        Math.min(arrow.right, obstacle.right) > Math.max(arrow.left, obstacle.left) + EPSILON &&
        Math.min(arrow.bottom, obstacle.bottom) > Math.max(arrow.top, obstacle.top) + EPSILON,
    )
  )
    return;
  const commands = [`M ${route.at(0)!.x} ${route.at(0)!.y}`];
  for (let index = 1; index < route.length - 1; index += 1) {
    const before = route[index - 1]!;
    const corner = route[index]!;
    const after = route.at(index + 1)!;
    const incoming = Math.abs(corner.x - before.x) + Math.abs(corner.y - before.y);
    const outgoing = Math.abs(after.x - corner.x) + Math.abs(after.y - corner.y);
    let radius = Math.min(96, incoming / 2, outgoing / 2, roundingClearance.get(points) ?? Infinity);
    if ((before.x === corner.x && corner.x === after.x) || (before.y === corner.y && corner.y === after.y)) radius = 0;
    let first = corner;
    let last = corner;
    for (let attempt = 0; attempt < 5 && radius > EPSILON; attempt += 1) {
      first = {
        x: corner.x + ((before.x - corner.x) * radius) / incoming,
        y: corner.y + ((before.y - corner.y) * radius) / incoming,
      };
      last = {
        x: corner.x + ((after.x - corner.x) * radius) / outgoing,
        y: corner.y + ((after.y - corner.y) * radius) / outgoing,
      };
      if (!obstacles.some((obstacle) => hullIntrudes([first, corner, last], obstacle))) break;
      radius = attempt === 4 ? 0 : radius / 2;
    }
    if (radius > EPSILON) commands.push(`L ${first.x} ${first.y} Q ${corner.x} ${corner.y} ${last.x} ${last.y}`);
    else commands.push(`L ${corner.x} ${corner.y}`);
  }
  commands.push(`L ${tip.x} ${tip.y}`);
  return { path: commands.join(" "), labelPosition: midpoint(route) };
}

export function coordinateRoutingPlan(
  scene: RoutingScene,
  plan: RoutingPlan,
  queries: ReadonlyMap<string, ReturnType<typeof createRoutingQuery>>,
  budget: WorkBudget,
): { paths: ReadonlyMap<string, readonly Point[]>; cost: number } {
  const paths = new Map<string, readonly Point[]>();
  const coordinates = assignSlots(plan, budget);
  if (!coordinates) return { paths, cost: 0 };
  const cells = new Map<number, Connection[]>();
  const connections = new Map<string, Map<number, readonly Point[]>>();
  for (const [edgeId, candidate] of plan.selected) {
    const values = coordinates.get(edgeId)!;
    candidate.cells.forEach((cell, index) => {
      const entries = cells.get(cell) ?? [];
      const entry = candidate.resources[index]!;
      const exit = candidate.resources.at(index + 1)!;
      entries.push({
        edgeId,
        index,
        from: resourcePoint(entry, values[index]!),
        to: resourcePoint(exit, values.at(index + 1)!),
        entry,
        exit,
      });
      cells.set(cell, entries);
    });
  }
  for (const [cell, entries] of [...cells].sort(([a], [b]) => a - b)) {
    if (!spend(budget, entries.length)) break;
    const rect = scene.cells[cell]!.rect;
    const perimeter = 2 * (rect.right - rect.left + rect.bottom - rect.top);
    const span = (connection: Connection) => {
      const distance = Math.abs(boundaryPosition(connection.from, rect) - boundaryPosition(connection.to, rect));
      return Math.min(distance, perimeter - distance);
    };
    const straight = ({ from, to }: Connection) => from.x === to.x || from.y === to.y;
    entries.sort(
      (a, b) => Number(straight(b)) - Number(straight(a)) || span(a) - span(b) || a.edgeId.localeCompare(b.edgeId),
    );
    const used: Segment[] = [];
    for (let rank = 0; rank < entries.length; rank += 1) {
      const connection = entries[rank]!;
      const result = connectCell(connection, rect, rank, entries.length, used, budget);
      if (!result) continue;
      const route = connections.get(connection.edgeId) ?? new Map<number, readonly Point[]>();
      route.set(connection.index, result.points);
      connections.set(connection.edgeId, route);
      used.push(...segments(result.points));
    }
  }
  let cost = 0;
  const accepted: Array<{ points: readonly Point[]; segments: readonly Segment[]; clearance: number }> = [];
  for (const [edgeId, candidate] of [...plan.selected].sort(([a], [b]) => a.localeCompare(b))) {
    if (!spend(budget)) break;
    const pieces = connections.get(edgeId);
    const query = queries.get(edgeId);
    if (!pieces || pieces.size !== candidate.cells.length || !query) continue;
    const points = compact(candidate.cells.flatMap((_, index) => [...pieces.get(index)!]));
    const own = segments(points);
    let valid = points.length > 1;
    for (const segment of own) {
      for (const obstacle of query.obstacles) {
        if (!spend(budget) || crossesObstacle(segment.from, segment.to, obstacle)) {
          valid = false;
          break;
        }
      }
      if (!valid) break;
    }
    if (!valid) continue;
    let crossings = 0;
    let clearance = Infinity;
    const neighboring: Array<readonly [number, number]> = [];
    for (let index = 0; index < accepted.length && valid; index += 1) {
      let pairClearance = Infinity;
      for (const segment of own) {
        for (const prior of accepted[index]!.segments) {
          if (!spend(budget)) {
            valid = false;
            break;
          }
          const relation = interaction(segment, prior);
          if (!relation.valid) {
            valid = false;
            break;
          }
          crossings += relation.crossing;
          pairClearance = Math.min(pairClearance, relation.clearance);
        }
        if (!valid) break;
      }
      clearance = Math.min(clearance, pairClearance);
      neighboring.push([index, pairClearance]);
    }
    if (!valid || !renderRoutingPath(points, query.obstacles)) continue;
    for (const [index, distance] of neighboring) {
      const prior = accepted[index]!;
      prior.clearance = Math.min(prior.clearance, distance);
      roundingClearance.set(prior.points, prior.clearance / 4);
    }
    roundingClearance.set(points, clearance / 4);
    accepted.push({ points, segments: own, clearance });
    paths.set(edgeId, points);
    cost += routeLength(points) + Math.max(0, points.length - 2) * BEND_COST + crossings * CROSSING_COST;
  }
  return { paths, cost };
}
