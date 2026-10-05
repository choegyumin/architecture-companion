import { pointAlongPolyline } from "@/shared/react-flow/polyline-edge-label-placement";

type Point = Readonly<{ x: number; y: number }>;

// Guard pills render at text-xs in a single row with a leading state icon,
// and one AND clause of several pills shares a tinted box. Sizes are
// estimated from label lengths instead of measured so placement stays a pure
// layout-time decision; the margin absorbs the estimation error.
const PILL_CHAR_WIDTH = 6;
// Horizontal padding and border, plus the state icon and its gap.
const PILL_BOX_PADDING = 34;
const PILL_HEIGHT = 26;
const PILL_GAP = 4;
// The clause box (px-1 py-0.5 plus its 1px border) and the gap between
// clauses (gap-1.5).
const CLAUSE_BOX_PADDING = 10;
const CLAUSE_BOX_VERTICAL = 6;
const CLAUSE_GAP = 6;
const COLLISION_MARGIN = 4;
const PUSH_STEP = 48;
const RESOLVE_ROUNDS = 4;

export type GuardLabelSize = Readonly<{ width: number; height: number }>;

export function estimateGuardLabelSize(clauses: readonly (readonly { label: string }[])[]): GuardLabelSize {
  let width = 0;
  let height = PILL_HEIGHT;
  for (const [index, clause] of clauses.entries()) {
    const pills =
      clause.reduce((total, pill) => total + PILL_BOX_PADDING + PILL_CHAR_WIDTH * pill.label.length, 0) +
      PILL_GAP * Math.max(clause.length - 1, 0);
    width += (clause.length > 1 ? CLAUSE_BOX_PADDING : 0) + pills + (index > 0 ? CLAUSE_GAP : 0);
    if (clause.length > 1) height = PILL_HEIGHT + CLAUSE_BOX_VERTICAL;
  }
  return { width, height };
}

/** One guard label group anchored `offset` arc length from its edge's `from` end. */
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
  const halfHeight = group.size.height / 2 + COLLISION_MARGIN;
  return {
    left: anchor.x - halfWidth,
    top: anchor.y - halfHeight,
    right: anchor.x + halfWidth,
    bottom: anchor.y + halfHeight,
  };
};

const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const toBox = (obstacle: GuardLabelObstacle): Box => ({
  left: obstacle.x,
  top: obstacle.y,
  right: obstacle.x + obstacle.width,
  bottom: obstacle.y + obstacle.height,
});

/**
 * Separates colliding guard labels by pushing the lower label of each pair
 * further from its edge endpoint. Node boxes never yield, and two groups on
 * one edge cannot separate by pushing along it, so those pairs stay put.
 * Residual overlaps after RESOLVE_ROUNDS rounds are accepted. Returns the
 * resolved offset per group key `${edgeId}\0${from}`.
 */
export function resolveGuardLabelOffsets(
  groups: readonly GuardLabelGroup[],
  obstacles: readonly GuardLabelObstacle[],
): ReadonlyMap<string, number> {
  const offsets = new Map(groups.map((group) => [groupKey(group), group.offset]));
  for (let round = 0; round < RESOLVE_ROUNDS; round += 1) {
    const placed = groups.map((group) => {
      const offset = offsets.get(groupKey(group)) ?? group.offset;
      return { group, offset, anchor: anchorOf(group, offset), box: boxOf(group, offset) };
    });
    const movers = new Set<string>();
    for (let index = 0; index < placed.length; index += 1) {
      const current = placed.at(index)!;
      for (let other = index + 1; other < placed.length; other += 1) {
        const candidate = placed.at(other)!;
        if (candidate.group.edgeId === current.group.edgeId || !overlaps(current.box, candidate.box)) continue;
        // The label that renders lower yields; equal heights break by edge id.
        const lower =
          candidate.anchor.y > current.anchor.y
            ? candidate
            : current.anchor.y > candidate.anchor.y
              ? current
              : candidate.group.edgeId > current.group.edgeId
                ? candidate
                : current;
        movers.add(groupKey(lower.group));
      }
      for (const obstacle of obstacles) {
        if (overlaps(current.box, toBox(obstacle))) movers.add(groupKey(current.group));
      }
    }
    if (movers.size === 0) break;
    for (const key of movers) offsets.set(key, (offsets.get(key) ?? 0) + PUSH_STEP);
  }
  return offsets;
}
