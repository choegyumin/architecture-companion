import { pointAlongPolyline } from "@/shared/react-flow/polyline-edge-label-placement";

type Point = Readonly<{ x: number; y: number }>;

// Guard pills render at text-xs in a single row. Sizes are estimated from
// label lengths instead of measured so placement stays a pure layout-time
// decision; the margin absorbs the estimation error.
const PILL_CHAR_WIDTH = 6;
const PILL_BOX_PADDING = 18;
const PILL_HEIGHT = 26;
const PILL_GAP = 4;
const COLLISION_MARGIN = 4;
const PUSH_STEP = 48;
const RESOLVE_ROUNDS = 4;

export type GuardLabelSize = Readonly<{ width: number; height: number }>;

export function estimateGuardLabelSize(pills: readonly { label: string }[]): GuardLabelSize {
  const width =
    pills.reduce((total, pill) => total + PILL_BOX_PADDING + PILL_CHAR_WIDTH * pill.label.length, 0) +
    PILL_GAP * Math.max(pills.length - 1, 0);
  return { width, height: PILL_HEIGHT };
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
