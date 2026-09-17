import {
  getAnnotationComposerPlacement,
  getAnnotationComposerPoint,
} from "@/client/parts/annotation-layer.composer-placement";

describe("annotation composer placement", () => {
  it("opens the composer toward the available overlay space", () => {
    const bounds = { height: 400, width: 600 };

    expect(getAnnotationComposerPlacement({ x: 100, y: 80 }, bounds)).toBe("bottom-right");
    expect(getAnnotationComposerPlacement({ x: 520, y: 80 }, bounds)).toBe("bottom-left");
    expect(getAnnotationComposerPlacement({ x: 100, y: 320 }, bounds)).toBe("top-right");
    expect(getAnnotationComposerPlacement({ x: 520, y: 320 }, bounds)).toBe("top-left");
  });

  it("computes the composer position from the placement direction, offset, and size", () => {
    const bounds = { height: 400, width: 600 };
    const size = { height: 120, width: 288 };

    expect(getAnnotationComposerPoint({ x: 100, y: 80 }, "bottom-right", size, bounds)).toEqual({ x: 118, y: 98 });
    expect(getAnnotationComposerPoint({ x: 520, y: 320 }, "top-left", size, bounds)).toEqual({ x: 214, y: 182 });
  });

  it("keeps the composer inside the overlay margin", () => {
    expect(
      getAnnotationComposerPoint(
        { x: 590, y: 390 },
        "bottom-right",
        { height: 120, width: 288 },
        { height: 400, width: 600 },
      ),
    ).toEqual({ x: 304, y: 272 });
  });
});
