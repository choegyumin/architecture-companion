import {
  estimateGuardLabelSize,
  type GuardLabelGroup,
  resolveGuardLabelOffsets,
} from "@/client/widgets/component-structure-guard-collision";

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

    expect(offsets.get("a\0start")).toBe(64);
    expect(offsets.get("b\0start")).toBe(112);
  });

  it("pushes a label off a node card until it clears", () => {
    const offsets = resolveGuardLabelOffsets(
      [group({ edgeId: "a", points: horizontal(0, 300) })],
      [{ x: 70, y: -20, width: 40, height: 40 }],
    );

    expect(offsets.get("a\0start")).toBe(160);
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

  it("gives up after the round cap and accepts the residual overlap", () => {
    const offsets = resolveGuardLabelOffsets(
      [group({ edgeId: "a", points: [{ x: 0, y: 0 }], fallback: { x: 0, y: 0 } })],
      [{ x: -50, y: -50, width: 100, height: 100 }],
    );

    expect(offsets.get("a\0start")).toBe(64 + 4 * 48);
  });
});
