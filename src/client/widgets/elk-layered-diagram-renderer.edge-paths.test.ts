import { toPolylinePath, toSplinePath } from "@/client/widgets/elk-layered-diagram-renderer.edge-paths";

describe("toPolylinePath", () => {
  it("joins every point with line segments", () => {
    expect(
      toPolylinePath([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 0 },
      ]),
    ).toBe("M 0 0 L 10 10 L 20 0");
  });
});

describe("toSplinePath", () => {
  it("keeps a two-point edge as a straight segment", () => {
    expect(
      toSplinePath([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toBe("M 0 0 L 10 10");
  });

  it("draws an elbow route as bezier segments that still pass through every point", () => {
    expect(
      toSplinePath([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ]),
    ).toBe("M 0 0 C 16.7 0.0 83.3 -16.7 100.0 0.0 C 116.7 16.7 100.0 83.3 100.0 100.0");
  });

  it("keeps collinear points on their shared line", () => {
    const path = toSplinePath([
      { x: 0, y: 50 },
      { x: 50, y: 50 },
      { x: 100, y: 50 },
    ]);

    expect(path).toBe("M 0 50 C 8.3 50.0 33.3 50.0 50.0 50.0 C 66.7 50.0 91.7 50.0 100.0 50.0");
  });

  it("rejects paths with fewer than two points", () => {
    expect(() => toSplinePath([{ x: 0, y: 0 }])).toThrow("A spline edge path requires at least two points.");
  });
});
