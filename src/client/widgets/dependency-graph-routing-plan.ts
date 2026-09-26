import {
  center,
  EPSILON,
  MIN_GAP,
  MinHeap,
  type Point,
  PORTAL_MARGIN,
  type Projection,
  rectangle,
  TRACK_GAP,
  TRACK_WIDTH,
} from "@/client/widgets/dependency-graph-routing-geometry";
import type { RoutingScene, RoutingTerminal } from "@/client/widgets/dependency-graph-routing-scene";
import { createRoutingQuery } from "@/client/widgets/dependency-graph-routing-scene";

export type WorkBudget = { remaining: number; exhausted: boolean };
export function spend(budget: WorkBudget, amount = 1): boolean {
  if (budget.remaining < amount) {
    budget.exhausted = true;
    return false;
  }
  budget.remaining -= amount;
  return true;
}

export type RoutingResource = Readonly<{
  key: string;
  axis: "x" | "y";
  fixed: number;
  min: number;
  max: number;
  preferred?: number;
  terminal?: RoutingTerminal;
}>;
export type RouteCandidate = Readonly<{
  edge: Projection;
  resources: readonly RoutingResource[];
  cells: readonly number[];
  length: number;
  cost: number;
}>;
export type RoutingRequest = Readonly<{
  edge: Projection;
  query: ReturnType<typeof createRoutingQuery>;
  candidates: readonly RouteCandidate[];
}>;
export type RoutingPlan = Readonly<{
  selected: ReadonlyMap<string, RouteCandidate>;
  orders: ReadonlyMap<string, readonly string[]>;
  cost: number;
}>;

export function resourcePoint(resource: RoutingResource, coordinate: number): Point {
  return resource.axis === "x" ? { x: coordinate, y: resource.fixed } : { x: resource.fixed, y: coordinate };
}

function terminalResource(terminal: RoutingTerminal): RoutingResource {
  return { ...terminal, key: `t:${terminal.key}`, terminal };
}

const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

type SearchState = {
  cell: number;
  resource: RoutingResource;
  point: Point;
  length: number;
  cost: number;
  priority: number;
  previous?: SearchState;
};

function search(
  scene: RoutingScene,
  edge: Projection,
  query: RoutingRequest["query"],
  budget: WorkBudget,
  penalties: ReadonlyMap<string, number>,
): RouteCandidate | undefined {
  if (!query.sources.length || !query.targets.length) return;
  const targets = new Map<number, RoutingResource[]>();
  for (const target of query.targets) {
    const entries = targets.get(target.cell) ?? [];
    entries.push(terminalResource(target));
    targets.set(target.cell, entries);
  }
  const sourceBounds = scene.bounds.get(edge.sourceId)!;
  const targetBounds = scene.bounds.get(edge.targetId)!;
  const sourceRect = rectangle(sourceBounds);
  const targetRect = rectangle(targetBounds);
  const project = (point: Point, resource: RoutingResource) =>
    resourcePoint(resource, Math.max(resource.min, Math.min(resource.max, point[resource.axis])));
  const targetResources = query.targets.map(terminalResource);
  const estimate = (point: Point) =>
    targetResources.reduce((best, target) => Math.min(best, distance(point, project(point, target))), Infinity);
  const terminalCost = (terminal: RoutingTerminal, source: boolean) => {
    const sideCost = source
      ? terminal.side === "bottom"
        ? 0
        : terminal.side === "top"
          ? 256
          : 64
      : terminal.side === "bottom"
        ? 256
        : 0;
    const along = center(source ? sourceRect : targetRect)[terminal.axis];
    return (
      sideCost +
      Math.abs((terminal.min + terminal.max) / 2 - along) * 0.15 +
      (penalties.get(JSON.stringify([terminal.elementId, terminal.side])) ?? 0)
    );
  };
  const heap = new MinHeap<SearchState>();
  const labels = new Map<string, SearchState[]>();
  for (const terminal of query.sources) {
    const resource = terminalResource(terminal);
    const point = project(center(targetRect), resource);
    const cost = terminalCost(terminal, true);
    heap.push({ cell: terminal.cell, resource, point, length: 0, cost, priority: cost + estimate(point) });
  }
  let final: SearchState | undefined;
  let end: RoutingResource | undefined;
  let best = Infinity;
  while (true) {
    const current = heap.pop();
    if (!current || current.priority >= best) break;
    if (!spend(budget)) break;
    const key = `${current.cell}:${current.resource.key}`;
    if (!current.resource.terminal && !labels.get(key)?.includes(current)) continue;
    const from = current.point;
    for (const target of targets.get(current.cell) ?? []) {
      const length = distance(from, project(from, target));
      const cost =
        current.cost +
        length +
        (current.resource.axis === target.axis ? 0 : 128) +
        terminalCost(target.terminal!, false);
      if (cost < best) {
        best = cost;
        final = current;
        end = target;
      }
    }
    for (const id of scene.cells[current.cell]!.portals) {
      if (!spend(budget)) break;
      const portal = scene.portals[id]!;
      const nextCell = portal.a === current.cell ? portal.b : portal.a;
      if (query.blocked.has(nextCell) || nextCell === current.previous?.cell) continue;
      const inset = Math.min(PORTAL_MARGIN, (portal.max - portal.min) / 4);
      const resource: RoutingResource = {
        key: `p:${id}`,
        axis: portal.axis,
        fixed: portal.fixed,
        min: portal.min + inset,
        max: portal.max - inset,
      };
      if (resource.key === current.resource.key) continue;
      const point = project(from, resource);
      const length = current.length + distance(from, point);
      const cost =
        current.cost +
        distance(from, point) +
        (current.resource.axis === resource.axis ? 0 : 128) +
        (penalties.get(resource.key) ?? 0);
      const nextKey = `${nextCell}:${resource.key}`;
      const existing = labels.get(nextKey) ?? [];
      if (existing.some((state) => state.cost + distance(state.point, point) <= cost && state.length <= length))
        continue;
      const retained = existing.filter(
        (state) => !(cost + distance(point, state.point) <= state.cost && length <= state.length),
      );
      const next = {
        cell: nextCell,
        resource,
        point,
        length,
        cost,
        priority: cost + estimate(point),
        previous: current,
      };
      retained.push(next);
      retained.sort(
        (a, b) => a.priority - b.priority || a.length - b.length || a.point.x - b.point.x || a.point.y - b.point.y,
      );
      labels.set(nextKey, retained.slice(0, 4));
      if (retained.indexOf(next) < 4) heap.push(next);
    }
  }
  if (!final || !end) return;
  const states: SearchState[] = [];
  for (let state: SearchState | undefined = final; state; state = state.previous) states.push(state);
  states.reverse();
  const cells = states.map(({ cell }) => cell);
  if (new Set(cells).size !== cells.length) return;
  return {
    edge,
    cells,
    resources: [
      ...states.map(({ resource, point }) => ({ ...resource, preferred: point[resource.axis] })),
      { ...end, preferred: project(final.point, end)[end.axis] },
    ],
    length: final.length + distance(final.point, project(final.point, end)),
    cost: best,
  };
}

export function collectRoutingRequests(
  scene: RoutingScene,
  edges: readonly Projection[],
  budget: WorkBudget,
): RoutingRequest[] {
  const requests = edges.map((edge) => {
    const query = createRoutingQuery(scene, edge);
    const first = search(scene, edge, query, budget, new Map());
    return { edge, query, candidates: first ? [first] : [] };
  });
  // Every relationship gets its independent candidate before alternatives consume work.
  for (const request of requests) {
    const penalties = new Map<string, number>();
    const seen = new Set(request.candidates.map((candidate) => candidate.resources.map(({ key }) => key).join("|")));
    for (let alternative = 0; alternative < 2 && !budget.exhausted; alternative += 1) {
      for (const resource of request.candidates.at(-1)?.resources ?? []) {
        const key = resource.terminal
          ? JSON.stringify([resource.terminal.elementId, resource.terminal.side])
          : resource.key;
        penalties.set(key, (penalties.get(key) ?? 0) + (resource.terminal ? 1_024 : 256));
      }
      const candidate = search(scene, request.edge, request.query, budget, penalties);
      if (!candidate) break;
      const key = candidate.resources.map(({ key }) => key).join("|");
      if (seen.has(key)) break;
      seen.add(key);
      request.candidates.push(candidate);
    }
  }
  return requests;
}

export function slotCoordinate(resource: RoutingResource, index: number, count: number): number {
  // Bundles pack at TRACK_GAP inside a centered TRACK_WIDTH band; compression only
  // when the band itself cannot fit every track.
  const band = Math.min(TRACK_WIDTH, resource.max - resource.min);
  const gap = Math.min(TRACK_GAP, band / Math.max(1, count - 1));
  return (resource.min + resource.max) / 2 + (index - (count - 1) / 2) * gap;
}

// Cost per pixel between an ordered slot's estimated coordinate and its preferred
// one: large enough to decide rank ties, below a crossing (4,000).
const PREFERENCE_COST = 4;

// Where a slot roughly lands given its order neighbours: separations pin it
// within a gap of the neighbours' own preferred coordinates, so a rank on the
// wrong side of a neighbour estimates that neighbour's coordinate, not its own.
// Without this term ranks tie whenever crossings tie and the insertion sequence
// alone decides who sits where on a shared line.
function preferenceCost(
  resource: RoutingResource,
  rank: number,
  order: readonly string[],
  selected: ReadonlyMap<string, RouteCandidate>,
): number {
  const gap = Math.min(TRACK_GAP, Math.min(TRACK_WIDTH, resource.max - resource.min) / Math.max(1, order.length));
  const anchor = resource.preferred ?? (resource.min + resource.max) / 2;
  const neighbour = (id: string) =>
    selected.get(id)?.resources.find((entry) => entry.key === resource.key)?.preferred ??
    (resource.min + resource.max) / 2;
  const lower = rank > 0 ? neighbour(order[rank - 1]!) + gap : -Infinity;
  const upper = rank < order.length ? neighbour(order[rank]!) - gap : Infinity;
  return Math.abs(Math.max(lower, Math.min(upper, anchor)) - anchor) * PREFERENCE_COST;
}

function boundaryPosition(scene: RoutingScene, cell: number, point: Point): number {
  const { left, right, top, bottom } = scene.cells[cell]!.rect;
  const width = right - left;
  const height = bottom - top;
  if (Math.abs(point.y - top) <= EPSILON) return point.x - left;
  if (Math.abs(point.x - right) <= EPSILON) return width + point.y - top;
  if (Math.abs(point.y - bottom) <= EPSILON) return width + height + right - point.x;
  return width * 2 + height + bottom - point.y;
}

function alternating(a: number, b: number, c: number, d: number): boolean {
  const inside = (point: number) => point > Math.min(a, b) + EPSILON && point < Math.max(a, b) - EPSILON;
  return inside(c) !== inside(d);
}

type CellConnection = Readonly<{ edgeId: string; from: RoutingResource; to: RoutingResource }>;
function cellConnections(plan: RoutingPlan): Map<number, CellConnection[]> {
  const result = new Map<number, CellConnection[]>();
  for (const candidate of plan.selected.values()) {
    candidate.cells.forEach((cell, index) => {
      const entries = result.get(cell) ?? [];
      entries.push({
        edgeId: candidate.edge.id,
        from: candidate.resources[index]!,
        to: candidate.resources.at(index + 1)!,
      });
      result.set(cell, entries);
    });
  }
  return result;
}

function insertion(
  scene: RoutingScene,
  plan: RoutingPlan,
  candidate: RouteCandidate,
  demand: ReadonlyMap<string, number>,
  budget: WorkBudget,
): Readonly<{ ranks: readonly number[]; cost: number }> | undefined {
  const connections = cellConnections(plan);
  type Rank = { rank: number; cost: number; previous?: Rank };
  let states: Rank[] = [];
  for (let index = 0; index < candidate.resources.length; index += 1) {
    const resource = candidate.resources[index]!;
    const order = plan.orders.get(resource.key) ?? [];
    if (order.length * MIN_GAP > resource.max - resource.min + EPSILON) return;
    const pressure = Math.max(
      0,
      (order.length + (demand.get(resource.key) ?? 0) + 1) * TRACK_GAP - (resource.max - resource.min),
    );
    const next: Rank[] = [];
    for (let rank = 0; rank <= order.length; rank += 1) {
      if (!spend(budget)) return;
      if (index === 0) {
        states.push({ rank, cost: pressure + preferenceCost(resource, rank, order, plan.selected) });
        continue;
      }
      const previousResource = candidate.resources.at(index - 1)!;
      const previousOrder = plan.orders.get(previousResource.key) ?? [];
      const cell = candidate.cells.at(index - 1)!;
      let best: Rank | undefined;
      for (const prior of states) {
        if (!spend(budget)) return;
        const a = boundaryPosition(
          scene,
          cell,
          resourcePoint(previousResource, slotCoordinate(previousResource, prior.rank, previousOrder.length + 1)),
        );
        const b = boundaryPosition(
          scene,
          cell,
          resourcePoint(resource, slotCoordinate(resource, rank, order.length + 1)),
        );
        let crossings = 0;
        for (const connection of connections.get(cell) ?? []) {
          if (!spend(budget)) return;
          const position = (entry: RoutingResource) => {
            const entries = plan.orders.get(entry.key) ?? [];
            let at = entries.indexOf(connection.edgeId);
            let count = entries.length;
            const inserted =
              entry.key === resource.key ? rank : entry.key === previousResource.key ? prior.rank : undefined;
            if (inserted !== undefined) {
              if (at >= inserted) at += 1;
              count += 1;
            }
            return boundaryPosition(scene, cell, resourcePoint(entry, slotCoordinate(entry, at, count)));
          };
          if (alternating(a, b, position(connection.from), position(connection.to))) crossings += 1;
        }
        const cost = prior.cost + crossings * 4_000 + pressure + preferenceCost(resource, rank, order, plan.selected);
        if (!best || cost < best.cost) best = { rank, cost, previous: prior };
      }
      if (best) next.push(best);
    }
    if (index > 0) states = next;
    if (!states.length) return;
  }
  const final = states.reduce((best, state) => (state.cost < best.cost ? state : best));
  const ranks: number[] = [];
  for (let state: Rank | undefined = final; state; state = state.previous) ranks.push(state.rank);
  ranks.reverse();
  return { ranks, cost: final.cost + candidate.cost };
}

export function selectRoutingPlan(
  scene: RoutingScene,
  requests: readonly RoutingRequest[],
  budget: WorkBudget,
  extended = false,
  preferred: ReadonlyMap<string, RouteCandidate> = new Map(),
): RoutingPlan {
  const demand = new Map<string, number>();
  for (const request of requests) {
    for (const key of new Set(request.candidates.at(0)?.resources.map(({ key }) => key) ?? [])) {
      demand.set(key, (demand.get(key) ?? 0) + 1);
    }
  }
  let plan: RoutingPlan = { selected: new Map(), orders: new Map(), cost: 0 };
  const available = new Map(
    requests.map((request) => {
      const baseline = request.candidates.at(0)?.length ?? 0;
      const maximum = baseline + Math.max(extended ? 1_024 : 256, baseline * (extended ? 1 : 0.25));
      return [
        request.edge.id,
        request.candidates.filter((candidate) => candidate.length <= maximum + EPSILON),
      ] as const;
    }),
  );
  const ordered = [...requests].sort(
    (a, b) =>
      available.get(a.edge.id)!.length - available.get(b.edge.id)!.length ||
      a.edge.id.localeCompare(b.edge.id) ||
      (a.edge.id < b.edge.id ? -1 : Number(a.edge.id > b.edge.id)),
  );
  for (const request of ordered) {
    let best: { candidate: RouteCandidate; result: NonNullable<ReturnType<typeof insertion>> } | undefined;
    const baseline = request.candidates.at(0);
    if (!baseline) continue;
    for (const resource of baseline.resources)
      demand.set(resource.key, Math.max(0, (demand.get(resource.key) ?? 0) - 1));
    const eligible = available.get(request.edge.id)!;
    const candidates = preferred.has(request.edge.id) ? [preferred.get(request.edge.id)!] : eligible;
    for (const candidate of candidates) {
      if (!eligible.includes(candidate)) continue;
      const result = insertion(scene, plan, candidate, demand, budget);
      if (result && (!best || result.cost < best.result.cost)) best = { candidate, result };
    }
    if (!best) continue;
    const selected = new Map(plan.selected);
    const orders = new Map(plan.orders);
    selected.set(request.edge.id, best.candidate);
    best.candidate.resources.forEach((resource, index) => {
      const order = [...(orders.get(resource.key) ?? [])];
      order.splice(best.result.ranks[index]!, 0, request.edge.id);
      orders.set(resource.key, order);
    });
    plan = { selected, orders, cost: plan.cost + best.result.cost };
  }
  return plan;
}

export function independentPlan(candidate: RouteCandidate): RoutingPlan {
  return {
    selected: new Map([[candidate.edge.id, candidate]]),
    orders: new Map(candidate.resources.map(({ key }) => [key, [candidate.edge.id]])),
    cost: candidate.cost,
  };
}
