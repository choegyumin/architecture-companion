import type { DiagramLayout } from "@/features/diagram/diagram-spatial";

import {
  type Bounds,
  EPSILON,
  portRange,
  type Projection,
  type Rectangle,
  rectangle,
  type Side,
} from "./dependency-graph-routing-geometry";

export type RoutingObstacle = Readonly<{
  id: string;
  kind: "group" | "node" | "virtual";
  rect: Rectangle;
  parentId?: string;
  members?: readonly string[];
}>;
export type RoutingCell = Readonly<{
  id: number;
  rect: Rectangle;
  blockers: readonly string[];
  portals: readonly number[];
}>;
export type RoutingPortal = Readonly<{
  id: number;
  a: number;
  b: number;
  axis: "x" | "y";
  fixed: number;
  min: number;
  max: number;
}>;
export type RoutingScene = Readonly<{
  bounds: ReadonlyMap<string, Bounds>;
  obstacles: readonly RoutingObstacle[];
  cells: readonly RoutingCell[];
  portals: readonly RoutingPortal[];
  parents: ReadonlyMap<string, string | undefined>;
  kinds: ReadonlyMap<string, "group" | "node">;
}>;
export type RoutingTerminal = Readonly<{
  key: string;
  elementId: string;
  side: Side;
  cell: number;
  axis: "x" | "y";
  fixed: number;
  min: number;
  max: number;
  inward: boolean;
}>;

const MAX_OBSTACLES = 2_000;
const MAX_SLABS = 4_000;
const MAX_CELLS = 20_000;
const MAX_PORTALS = 60_000;
const MAX_SCENE_WORK = 2_000_000;

function valid(rect: Rectangle): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.right) &&
    Number.isFinite(rect.bottom) &&
    rect.left < rect.right &&
    rect.top < rect.bottom
  );
}

function virtualObstacles(
  layout: DiagramLayout,
  bounds: ReadonlyMap<string, Bounds>,
  existing: ReadonlySet<string>,
): RoutingObstacle[] | undefined {
  const children = new Map<string | undefined, string[]>();
  for (const node of layout.nodes) {
    const members = children.get(node.parentId) ?? [];
    members.push(node.id);
    children.set(node.parentId, members);
  }
  const identifiers = new Set(existing);
  const result: RoutingObstacle[] = [];
  for (const [parentId, members] of children) {
    members.sort();
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const member of members) {
      const placement = bounds.get(member);
      if (!placement) return undefined;
      const rect = rectangle(placement);
      if (!valid(rect)) return undefined;
      left = Math.min(left, rect.left);
      top = Math.min(top, rect.top);
      right = Math.max(right, rect.right);
      bottom = Math.max(bottom, rect.bottom);
    }
    const stem = `virtual:${JSON.stringify([parentId ?? null, members])}`;
    let id = stem;
    for (let suffix = 1; identifiers.has(id); suffix += 1) id = `${stem}:${suffix}`;
    identifiers.add(id);
    result.push({ id, kind: "virtual", rect: { left, top, right, bottom }, parentId, members });
  }
  return result;
}

export function buildRoutingScene(
  layout: DiagramLayout,
  bounds: ReadonlyMap<string, Bounds>,
): RoutingScene | undefined {
  const parents = new Map<string, string | undefined>();
  const kinds = new Map<string, "group" | "node">();
  const obstacles: RoutingObstacle[] = [];
  for (const group of layout.groups) {
    const placement = bounds.get(group.id);
    if (!placement) return undefined;
    const rect = rectangle(placement);
    if (!valid(rect)) return undefined;
    obstacles.push({ id: group.id, kind: "group", rect, parentId: group.parentId });
    parents.set(group.id, group.parentId);
    kinds.set(group.id, "group");
  }
  for (const node of layout.nodes) {
    const placement = bounds.get(node.id);
    if (!placement) return undefined;
    const rect = rectangle(placement);
    if (!valid(rect)) return undefined;
    obstacles.push({ id: node.id, kind: "node", rect, parentId: node.parentId });
    parents.set(node.id, node.parentId);
    kinds.set(node.id, "node");
  }
  const virtual = virtualObstacles(layout, bounds, new Set(obstacles.map(({ id }) => id)));
  if (!virtual) return undefined;
  obstacles.push(...virtual);
  if (obstacles.length === 0 || obstacles.length > MAX_OBSTACLES) return undefined;
  obstacles.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const left = Math.min(...obstacles.map(({ rect }) => rect.left));
  const top = Math.min(...obstacles.map(({ rect }) => rect.top));
  const right = Math.max(...obstacles.map(({ rect }) => rect.right));
  const bottom = Math.max(...obstacles.map(({ rect }) => rect.bottom));
  const margin = Math.max(512, Math.max(right - left, bottom - top) / 8);
  const world = { left: left - margin, top: top - margin, right: right + margin, bottom: bottom + margin };
  if (!valid(world)) return undefined;
  const xs = [...new Set([world.left, world.right, ...obstacles.flatMap(({ rect }) => [rect.left, rect.right])])].sort(
    (a, b) => a - b,
  );
  if (xs.length - 1 > MAX_SLABS) return undefined;

  const cells: Array<{
    id: number;
    rect: Rectangle;
    blockers: readonly string[];
    portals: number[];
  }> = [];
  const portals: RoutingPortal[] = [];
  let work = obstacles.length + xs.length;
  let previousSlab: number[] = [];
  const connect = (a: number, b: number, axis: "x" | "y", fixed: number, min: number, max: number): boolean => {
    if (max - min <= EPSILON) return true;
    if (portals.length >= MAX_PORTALS || ++work > MAX_SCENE_WORK) return false;
    const id = portals.length;
    portals.push({ id, a, b, axis, fixed, min, max });
    cells[a]!.portals.push(id);
    cells[b]!.portals.push(id);
    return true;
  };

  for (let slab = 0; slab < xs.length - 1; slab += 1) {
    const x0 = xs.at(slab)!;
    const x1 = xs.at(slab + 1)!;
    work += obstacles.length;
    if (work > MAX_SCENE_WORK) return undefined;
    const active = obstacles.filter(({ rect }) => rect.left < x1 && rect.right > x0);
    const events = new Map<number, { enter: string[]; leave: string[] }>();
    const eventAt = (y: number) => {
      let event = events.get(y);
      if (!event) {
        event = { enter: [], leave: [] };
        events.set(y, event);
      }
      return event;
    };
    for (const obstacle of active) {
      eventAt(obstacle.rect.top).enter.push(obstacle.id);
      eventAt(obstacle.rect.bottom).leave.push(obstacle.id);
    }
    const ys = [...new Set([world.top, world.bottom, ...events.keys()])].sort((a, b) => a - b);
    work += active.length * 2 + ys.length;
    if (work > MAX_SCENE_WORK || cells.length + ys.length - 1 > MAX_CELLS) return undefined;
    const mask = new Set<string>();
    const currentSlab: number[] = [];
    for (let row = 0; row < ys.length - 1; row += 1) {
      const y0 = ys.at(row)!;
      const y1 = ys.at(row + 1)!;
      const event = events.get(y0);
      for (const id of event?.leave ?? []) mask.delete(id);
      for (const id of event?.enter ?? []) mask.add(id);
      work += mask.size + 1;
      if (work > MAX_SCENE_WORK || cells.length >= MAX_CELLS) return undefined;
      const id = cells.length;
      cells.push({
        id,
        rect: { left: x0, right: x1, top: y0, bottom: y1 },
        blockers: [...mask].sort(),
        portals: [],
      });
      currentSlab.push(id);
      if (row > 0 && !connect(id - 1, id, "x", y0, x0, x1)) return undefined;
    }

    // Two sorted interval lists suffice; no Cartesian product of global x/y boundaries.
    let prior = 0;
    let current = 0;
    while (prior < previousSlab.length && current < currentSlab.length) {
      const a = cells[previousSlab[prior]!]!;
      const b = cells[currentSlab[current]!]!;
      const min = Math.max(a.rect.top, b.rect.top);
      const max = Math.min(a.rect.bottom, b.rect.bottom);
      if (!connect(a.id, b.id, "y", x0, min, max)) return undefined;
      if (++work > MAX_SCENE_WORK) return undefined;
      if (a.rect.bottom < b.rect.bottom) prior += 1;
      else if (b.rect.bottom < a.rect.bottom) current += 1;
      else {
        prior += 1;
        current += 1;
      }
    }
    previousSlab = currentSlab;
  }
  return { bounds: new Map(bounds), obstacles, cells, portals, parents, kinds };
}

function descendantOf(scene: RoutingScene, elementId: string, groupId: string): boolean {
  for (let parent = scene.parents.get(elementId); parent; parent = scene.parents.get(parent)) {
    if (parent === groupId) return true;
  }
  return false;
}

function terminals(
  scene: RoutingScene,
  elementId: string,
  inward: boolean,
  blocked: ReadonlySet<number>,
): RoutingTerminal[] {
  const placement = scene.bounds.get(elementId);
  if (!placement) return [];
  const rect = rectangle(placement);
  const result: RoutingTerminal[] = [];
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const axis = side === "top" || side === "bottom" ? "x" : "y";
    const fixed =
      side === "top" ? rect.top : side === "bottom" ? rect.bottom : side === "left" ? rect.left : rect.right;
    const [minimum, maximum] = portRange(rect, side);
    const face: RoutingTerminal[] = [];
    for (const cell of scene.cells) {
      if (blocked.has(cell.id)) continue;
      const span = cell.rect;
      const touching =
        side === "top"
          ? Math.abs((inward ? span.top : span.bottom) - fixed) <= EPSILON &&
            (inward ? span.bottom > fixed : span.top < fixed)
          : side === "bottom"
            ? Math.abs((inward ? span.bottom : span.top) - fixed) <= EPSILON &&
              (inward ? span.top < fixed : span.bottom > fixed)
            : side === "left"
              ? Math.abs((inward ? span.left : span.right) - fixed) <= EPSILON &&
                (inward ? span.right > fixed : span.left < fixed)
              : Math.abs((inward ? span.right : span.left) - fixed) <= EPSILON &&
                (inward ? span.left < fixed : span.right > fixed);
      if (!touching) continue;
      let min = Math.max(minimum, axis === "x" ? span.left : span.top);
      let max = Math.min(maximum, axis === "x" ? span.right : span.bottom);
      if (max - min <= EPSILON) continue;
      const inset = Math.min(8, (max - min) / 4);
      min += inset;
      max -= inset;
      face.push({
        key: JSON.stringify([elementId, side, cell.id]),
        elementId,
        side,
        cell: cell.id,
        axis,
        fixed,
        min,
        max,
        inward,
      });
    }
    const midpoint = (minimum + maximum) / 2;
    face.sort(
      (a, b) => Math.abs((a.min + a.max) / 2 - midpoint) - Math.abs((b.min + b.max) / 2 - midpoint) || a.cell - b.cell,
    );
    result.push(...face);
  }
  return result;
}

export function createRoutingQuery(
  scene: RoutingScene,
  projection: Projection,
): Readonly<{
  blocked: ReadonlySet<number>;
  obstacles: readonly Rectangle[];
  sources: readonly RoutingTerminal[];
  targets: readonly RoutingTerminal[];
}> {
  const exempt = new Set<string>();
  for (const id of [projection.sourceId, projection.targetId]) {
    for (let parent = scene.parents.get(id); parent; parent = scene.parents.get(parent)) exempt.add(parent);
  }
  const inwardSource =
    scene.kinds.get(projection.sourceId) === "group" && descendantOf(scene, projection.targetId, projection.sourceId);
  const inwardTarget =
    scene.kinds.get(projection.targetId) === "group" && descendantOf(scene, projection.sourceId, projection.targetId);
  if (inwardSource) exempt.add(projection.sourceId);
  if (inwardTarget) exempt.add(projection.targetId);
  for (const obstacle of scene.obstacles) {
    if (
      obstacle.kind === "virtual" &&
      obstacle.members?.some((id) => id === projection.sourceId || id === projection.targetId)
    ) {
      exempt.add(obstacle.id);
    }
  }
  const blocked = new Set<number>();
  for (const cell of scene.cells) {
    if (cell.blockers.some((id) => !exempt.has(id))) blocked.add(cell.id);
  }
  return {
    blocked,
    obstacles: scene.obstacles.filter(({ id }) => !exempt.has(id)).map(({ rect }) => rect),
    sources: terminals(scene, projection.sourceId, inwardSource, blocked),
    targets: terminals(scene, projection.targetId, inwardTarget, blocked),
  };
}
