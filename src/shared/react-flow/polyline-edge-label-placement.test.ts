import {
  getPolylineEdgeLabelPlacement,
  pointAlongPolyline,
  polylineArcLength,
} from "@/shared/react-flow/polyline-edge-label-placement";

describe("polyline edge label placement", () => {
  it("places the label at the midpoint of the longest segment", () => {
    expect(
      getPolylineEdgeLabelPlacement([
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 50 },
      ]),
    ).toEqual({ x: 100, y: 0 });
  });

  it("uses the midpoint of the longest segment when it is vertical", () => {
    expect(
      getPolylineEdgeLabelPlacement([
        { x: 0, y: 0 },
        { x: 0, y: 200 },
        { x: 60, y: 200 },
      ]),
    ).toEqual({ x: 0, y: 100 });
  });

  it("uses the first segment's midpoint when the first segment is the trunk", () => {
    expect(
      getPolylineEdgeLabelPlacement([
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 60 },
      ]),
    ).toEqual({ x: 150, y: 0 });
  });

  it("uses the midpoint of both points for a two-point edge", () => {
    expect(
      getPolylineEdgeLabelPlacement([
        { x: 0, y: 0 },
        { x: 60, y: 20 },
      ]),
    ).toEqual({ x: 30, y: 10 });
  });
});

describe("polyline arc sampling", () => {
  const elbow = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it("sums every segment into the arc length", () => {
    expect(polylineArcLength(elbow)).toBe(200);
    expect(polylineArcLength([{ x: 5, y: 5 }])).toBe(0);
  });

  it("walks segments from the start and interpolates inside a segment", () => {
    expect(pointAlongPolyline(elbow, 50, "start")).toEqual({ x: 50, y: 0 });
    expect(pointAlongPolyline(elbow, 150, "start")).toEqual({ x: 100, y: 50 });
  });

  it("walks segments from the end", () => {
    expect(pointAlongPolyline(elbow, 50, "end")).toEqual({ x: 100, y: 50 });
    expect(pointAlongPolyline(elbow, 150, "end")).toEqual({ x: 50, y: 0 });
  });

  it("clamps distances past either end to the far endpoint", () => {
    expect(pointAlongPolyline(elbow, 500, "start")).toEqual({ x: 100, y: 100 });
    expect(pointAlongPolyline(elbow, 500, "end")).toEqual({ x: 0, y: 0 });
  });

  it("returns the only point of a degenerate polyline", () => {
    expect(pointAlongPolyline([{ x: 7, y: 9 }], 40, "start")).toEqual({ x: 7, y: 9 });
  });
});
