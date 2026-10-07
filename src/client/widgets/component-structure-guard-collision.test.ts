import {
  estimateGuardLabelSize,
  type GuardLabelGroup,
  resolveGuardLabelOffsets,
} from "@/client/widgets/component-structure-guard-collision";
import { pointAlongPolyline } from "@/shared/react-flow/polyline-edge-label-placement";

const group = (overrides: Partial<GuardLabelGroup> & Pick<GuardLabelGroup, "edgeId" | "points">): GuardLabelGroup => ({
  from: "start",
  offset: 64,
  fallback: { x: 0, y: 0 },
  size: { width: 40, height: 26 },
  ...overrides,
});

const horizontal = (from: number, to: number, y = 0) => [
  { x: from, y },
  { x: to, y },
];

describe("estimateGuardLabelSize", () => {
  it("sizes short condition text as one line", () => {
    expect(estimateGuardLabelSize("draft")).toEqual({ width: 6 * 5 + 16 + 18, height: 10 + 16 });
  });

  it("wraps condition text past the button's max width into more lines", () => {
    const size = estimateGuardLabelSize("a".repeat(60));
    expect(size.width).toBe(288);
    expect(size.height).toBe(10 + 2 * 16);
  });
});

describe("resolveGuardLabelOffsets", () => {
  it("keeps base offsets when nothing collides", () => {
    const offsets = resolveGuardLabelOffsets(
      [group({ edgeId: "a", points: horizontal(0, 300) }), group({ edgeId: "b", points: horizontal(0, 300, 200) })],
      [],
    );

    expect(offsets.get("a\0start")).toBe(64);
    expect(offsets.get("b\0start")).toBe(64);
  });

  it("pushes the lower label of a colliding pair away from its endpoint", () => {
    const offsets = resolveGuardLabelOffsets(
      [group({ edgeId: "a", points: horizontal(0, 300) }), group({ edgeId: "b", points: horizontal(0, 300, 20) })],
      [],
    );

    expect(offsets.get("a\0start")).toBe(64);
    expect(offsets.get("b\0start")).toBe(112);
  });

  it("breaks equal-height collisions by pushing the later edge id", () => {
    const offsets = resolveGuardLabelOffsets(
      [group({ edgeId: "a", points: horizontal(0, 300) }), group({ edgeId: "b", points: horizontal(20, 320) })],
      [],
    );

    // The boxes overlap horizontally by exactly their shared span minus the
    // 20px stagger, so clearing that measured overlap suffices.
    expect(offsets.get("a\0start")).toBe(64);
    expect(offsets.get("b\0start")).toBe(64 + 28);
  });

  it("pushes a label off a node card until it clears", () => {
    const offsets = resolveGuardLabelOffsets(
      [group({ edgeId: "a", points: horizontal(0, 300) })],
      [{ x: 70, y: -20, width: 40, height: 40 }],
    );

    expect(offsets.get("a\0start")).toBe(134);
  });

  it("leaves both groups of one edge in place when they overlap", () => {
    const offsets = resolveGuardLabelOffsets(
      [
        group({ edgeId: "a", from: "start", points: horizontal(0, 120) }),
        group({ edgeId: "a", from: "end", points: horizontal(0, 120) }),
      ],
      [],
    );

    expect(offsets.get("a\0start")).toBe(64);
    expect(offsets.get("a\0end")).toBe(64);
  });

  it("leaves an immovable label at its base offset instead of inflating it", () => {
    const offsets = resolveGuardLabelOffsets(
      [group({ edgeId: "a", points: [{ x: 0, y: 0 }], fallback: { x: 0, y: 0 } })],
      [{ x: -50, y: -50, width: 100, height: 100 }],
    );

    expect(offsets.get("a\0start")).toBe(64);
  });

  it("pulls a mixed pair back to its own reference ends, arm above arrival", () => {
    // An arm label hanging down from a decision meets an arrival label
    // climbing up to it; the arm pulls up toward its decision, the arrival
    // pulls down toward its destination, and they part.
    const arm = group({
      edgeId: "arm",
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 300 },
      ],
    });
    const arrival = group({
      edgeId: "arrival",
      from: "end",
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 140 },
      ],
    });
    const offsets = resolveGuardLabelOffsets([arm, arrival], []);

    expect(offsets.get("arm\0start")).toBeLessThan(64);
    expect(offsets.get("arrival\0end")).toBeLessThan(64);
    const armAnchor = pointAlongPolyline(arm.points, offsets.get("arm\0start")!, "start");
    const arrivalAnchor = pointAlongPolyline(arrival.points, offsets.get("arrival\0end")!, "end");
    // The arm label's box grows downward and the arrival's upward, so clear
    // separation means the arm's bottom sits above the arrival's top.
    expect(armAnchor.y + arm.size.height).toBeLessThanOrEqual(arrivalAnchor.y - arrival.size.height);
  });

  it("shifts the whole pull to the arm when the arrival is pinned to its node", () => {
    const arm = group({
      edgeId: "arm",
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 300 },
      ],
    });
    const arrival = group({
      edgeId: "arrival",
      from: "end",
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 140 },
      ],
    });
    // A node sits right below the arrival label's pull path, so pulling the
    // arrival down would land on it.
    const offsets = resolveGuardLabelOffsets([arm, arrival], [{ x: -30, y: 100, width: 60, height: 40 }]);

    const arrivalAnchor = pointAlongPolyline(arrival.points, offsets.get("arrival\0end")!, "end");
    // An end-anchored box ends COLLISION_MARGIN (4) below its anchor.
    const arrivalBottom = arrivalAnchor.y + 4;
    expect(arrivalBottom).toBeLessThanOrEqual(100);
    expect(offsets.get("arm\0start")).toBeLessThan(64);
    const armAnchor = pointAlongPolyline(arm.points, offsets.get("arm\0start")!, "start");
    expect(armAnchor.y + arm.size.height).toBeLessThanOrEqual(arrivalAnchor.y - arrival.size.height);
  });

  it("separates near-parallel arms of one decision by the measured overlap", () => {
    // Three arms leave the same decision at staggered ports and converge on
    // one target, so their labels share an anchor region: the middle and
    // lower arms start 24px apart vertically while the boxes are 30px tall.
    // Pushing by the overlap depth unstacks them within the round cap
    // instead of moving both labels in lockstep forever.
    const arms = {
      deleted: [
        { x: 68, y: 0 },
        { x: 18.2, y: 264.5 },
      ],
      changed: [
        { x: 20, y: 0 },
        { x: 6.2, y: 264.5 },
      ],
      otherwise: [
        { x: 44, y: 24 },
        { x: 13, y: 264.5 },
      ],
    } as const;
    const offsets = resolveGuardLabelOffsets(
      Object.entries(arms).map(([edgeId, points]) => group({ edgeId, points })),
      [],
    );

    const anchorY = (edgeId: keyof typeof arms) =>
      pointAlongPolyline(arms[edgeId], offsets.get(`${edgeId}\0start`) ?? 64, "start").y;
    // The top arm keeps its base offset; each pair of anchor boxes clears
    // the other's height plus the collision margin.
    expect(offsets.get("deleted\0start")).toBe(64);
    expect(Math.abs(anchorY("deleted") - anchorY("changed"))).toBeGreaterThanOrEqual(30);
    expect(Math.abs(anchorY("deleted") - anchorY("otherwise"))).toBeGreaterThanOrEqual(30);
    expect(Math.abs(anchorY("changed") - anchorY("otherwise"))).toBeGreaterThanOrEqual(30);
  });
});
