import { getPolylineEdgeLabelPlacement } from "@/shared/react-flow/polyline-edge-label-placement";

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
