import { pointAlongPolyline, polylineArcLength } from "@/shared/react-flow/polyline-edge-label-placement";

type Point = Readonly<{ x: number; y: number }>;

// Guard edge labels render at text-xs in a max-w-72 button that wraps at a
// fixed width and carries a leading state icon. Sizes are estimated from the
// condition text instead of measured so placement stays a pure layout-time
// decision; the collision margin absorbs the estimation error.
const CHAR_WIDTH = 6;
const ICON_WIDTH = 16;
const BUTTON_CHROME = 18;
const MAX_BUTTON_WIDTH = 288;
const LINE_HEIGHT = 16;
const BUTTON_CHROME_HEIGHT = 10;
const COLLISION_MARGIN = 4;
// Labels pick from discrete slots along their own edge; 4px stays finer
// than the label heights involved while keeping the choice deterministic.
const SLOT_STEP = 4;
const MIN_OFFSET = 8;
// Costs: label overlaps count as their overlap area, node overlaps weigh
// far more (labels must not sit on cards), a mixed pair whose arm label
// ends up below its arrival label breaks the reading order, and the tiny
// drift term prefers the base offset among equally clear slots.
const OBSTACLE_WEIGHT = 100;
const ORDER_WEIGHT = 10;
const DRIFT_WEIGHT = 0.001;
const MAX_PASSES = 8;

export type GuardLabelSize = Readonly<{ width: number; height: number }>;

export function estimateGuardLabelSize(text: string): GuardLabelSize {
  const widest = CHAR_WIDTH * text.length + ICON_WIDTH + BUTTON_CHROME;
  const lines = Math.max(1, Math.ceil(widest / MAX_BUTTON_WIDTH));
  return {
    width: Math.min(MAX_BUTTON_WIDTH, Math.max(widest, ICON_WIDTH + BUTTON_CHROME)),
    height: BUTTON_CHROME_HEIGHT + lines * LINE_HEIGHT,
  };
}

/** One guard edge label anchored `offset` arc length from its edge's `from` end. */
export type GuardLabelGroup = Readonly<{
  edgeId: string;
  from: "start" | "end";
  offset: number;
  points: readonly Point[];
  fallback: Point;
  size: GuardLabelSize;
}>;

export type GuardLabelObstacle = Readonly<{ x: number; y: number; width: number; height: number }>;

type Box = Readonly<{ left: number; top: number; right: number; bottom: number }>;

const groupKey = (group: GuardLabelGroup): string => `${group.edgeId}\0${group.from}`;

const anchorOf = (group: GuardLabelGroup, offset: number): Point =>
  group.points.length < 2 ? group.fallback : pointAlongPolyline(group.points, offset, group.from);

const boxOf = (group: GuardLabelGroup, offset: number): Box => {
  const anchor = anchorOf(group, offset);
  const halfWidth = group.size.width / 2 + COLLISION_MARGIN;
  const height = group.size.height + COLLISION_MARGIN;
  return {
    left: anchor.x - halfWidth,
    right: anchor.x + halfWidth,
    // Start-anchored labels grow downstream from their anchor while
    // end-anchored labels climb back up the edge, so each box extends one
    // way only.
    top: group.from === "start" ? anchor.y - COLLISION_MARGIN : anchor.y - height,
    bottom: group.from === "start" ? anchor.y + height : anchor.y + COLLISION_MARGIN,
  };
};

const toBox = (obstacle: GuardLabelObstacle): Box => ({
  left: obstacle.x,
  top: obstacle.y,
  right: obstacle.x + obstacle.width,
  bottom: obstacle.y + obstacle.height,
});

const overlapAxis = (aFirst: number, aLast: number, bFirst: number, bLast: number): number =>
  Math.min(aLast, bLast) - Math.max(aFirst, bFirst);

// Offsets a label may take: discrete slots across its whole edge, always
// including its base offset. Degenerate polylines offer only the base.
const slotsOf = (group: GuardLabelGroup): readonly number[] => {
  if (group.points.length < 2) return [group.offset];
  const far = Math.max(group.offset, polylineArcLength(group.points));
  const slots: number[] = [];
  for (let offset = MIN_OFFSET; offset <= far; offset += SLOT_STEP) slots.push(offset);
  if (!slots.includes(group.offset)) slots.push(group.offset);
  return slots;
};

type Placement = Readonly<{ group: GuardLabelGroup; offset: number; anchor: Point; box: Box }>;

const place = (group: GuardLabelGroup, offset: number): Placement => ({
  group,
  offset,
  anchor: anchorOf(group, offset),
  box: boxOf(group, offset),
});

// What one label's placement costs against a fixed world: its overlap area
// with another label (weighted by the mixed-pair order rule), or with a
// node.
const pairCost = (self: Placement, other: Placement): number => {
  const overlapX = overlapAxis(self.box.left, self.box.right, other.box.left, other.box.right);
  const overlapY = overlapAxis(self.box.top, self.box.bottom, other.box.top, other.box.bottom);
  const area = overlapX > 0 && overlapY > 0 ? overlapX * overlapY : 0;
  // A mixed pair defends its reading order only while it reads as one
  // column: same x band and a vertical gap smaller than the pair's own box
  // heights. Crossing within that band costs extra whether or not the boxes
  // still overlap — the order is a placement rule, not an overlap relief,
  // and a pure-intersection gate would let the arm slip tangent-below the
  // arrival for free. Farther apart the labels read independently and pay
  // nothing; the charge formerly applied at any distance, so labels fled
  // far down their edges to escape pairs hundreds of px away.
  if (self.group.from === other.group.from || overlapX <= 0) return area;
  const band = self.box.bottom - self.box.top + (other.box.bottom - other.box.top);
  if (overlapY <= -band) return area;
  const arm = self.group.from === "start" ? self : other;
  const arrival = arm === self ? other : self;
  const inverted = arm.anchor.y - arrival.anchor.y;
  return inverted > 0 ? area + inverted * ORDER_WEIGHT : area;
};

const obstacleCost = (self: Placement, obstacle: Box): number => {
  const overlapX = overlapAxis(self.box.left, self.box.right, obstacle.left, obstacle.right);
  const overlapY = overlapAxis(self.box.top, self.box.bottom, obstacle.top, obstacle.bottom);
  return overlapX > 0 && overlapY > 0 ? overlapX * overlapY * OBSTACLE_WEIGHT : 0;
};

/**
 * Places every guard edge label in one global decision. Each label picks
 * from discrete slots along its own edge; a greedy pass repeatedly moves the
 * label with the worst conflict to its cheapest slot (all other labels
 * fixed) until nothing improves. Node boxes never yield, and labels that
 * still overlap at the end are accepted. Returns the chosen offset per
 * group key `${edgeId}\0${from}`.
 */
export function resolveGuardLabelOffsets(
  groups: readonly GuardLabelGroup[],
  obstacles: readonly GuardLabelObstacle[],
): ReadonlyMap<string, number> {
  const placements = groups.map((group) => place(group, group.offset));
  const obstacleBoxes = obstacles.map(toBox);
  const costAgainstWorld = (self: Placement, others: readonly Placement[]): number => {
    let cost = 0;
    for (const other of others) {
      if (other.group.edgeId === self.group.edgeId && other.group.from === self.group.from) continue;
      cost += pairCost(self, other);
    }
    for (const obstacle of obstacleBoxes) cost += obstacleCost(self, obstacle);
    // Prefer the base offset among equally clear slots.
    return cost + Math.abs(self.offset - self.group.offset) * DRIFT_WEIGHT;
  };
  const index = new Map(placements.map((placement) => [groupKey(placement.group), placement]));
  const slotsByGroup = new Map(groups.map((group) => [groupKey(group), slotsOf(group)]));

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const ordered = [...placements].sort((a, b) => {
      const conflictOf = (placement: Placement) =>
        costAgainstWorld(placement, placements) - Math.abs(placement.offset - placement.group.offset) * DRIFT_WEIGHT;
      const difference = conflictOf(b) - conflictOf(a);
      return difference !== 0 ? difference : groupKey(a.group).localeCompare(groupKey(b.group));
    });
    let improved = false;
    for (const current of ordered) {
      const key = groupKey(current.group);
      const slots = slotsByGroup.get(key)!;
      let best = current;
      let bestCost = costAgainstWorld(current, placements);
      for (const offset of slots) {
        if (offset === current.offset) continue;
        const candidate = place(current.group, offset);
        const cost = costAgainstWorld(candidate, placements);
        if (cost < bestCost) {
          best = candidate;
          bestCost = cost;
        }
      }
      if (best !== current) {
        index.set(key, best);
        placements.splice(placements.indexOf(current), 1, best);
        improved = true;
      }
    }
    if (!improved) break;
  }
  return new Map([...index].map(([key, placement]) => [key, placement.offset]));
}
