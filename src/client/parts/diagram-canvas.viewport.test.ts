import type { ReactFlowInstance, Viewport } from "@xyflow/react";

import { focusBoundsFraming } from "@/client/parts/diagram-canvas.viewport";

function createViewport(width: number, height: number): HTMLElement {
  return { clientWidth: width, clientHeight: height } as HTMLElement;
}

function createInstance() {
  const setViewport = vi.fn((_: Viewport, __?: { duration: number }) => Promise.resolve(true));
  return { instance: { setViewport } as unknown as ReactFlowInstance, setViewport };
}

describe("focusBoundsFraming", () => {
  it("centers the bounds and clamps the zoom to the fit-view maximum", async () => {
    const { instance, setViewport } = createInstance();

    await focusBoundsFraming(instance, { x: 0, y: 0, width: 100, height: 50 }, createViewport(1000, 800));

    expect(setViewport).toHaveBeenCalledWith({ x: 450, y: 375, zoom: 1 }, { duration: 500 });
  });

  it("zooms out for bounds larger than the viewport", async () => {
    const { instance, setViewport } = createInstance();

    await focusBoundsFraming(instance, { x: 0, y: 0, width: 5000, height: 3000 }, createViewport(1000, 800));

    const [viewport] = setViewport.mock.calls.at(0) ?? [];
    if (!viewport) throw new Error("Expected the framing to set a viewport.");
    // The narrower axis wins: (1000 - 48) / 5000.
    expect(viewport.zoom).toBeCloseTo(0.1904, 3);
    expect(viewport.x).toBeCloseTo(500 - 2500 * viewport.zoom, 3);
    expect(viewport.y).toBeCloseTo(400 - 1500 * viewport.zoom, 3);
  });

  it("does nothing without a sized viewport element", async () => {
    const { instance, setViewport } = createInstance();

    await focusBoundsFraming(instance, { x: 0, y: 0, width: 100, height: 50 }, createViewport(0, 0));

    expect(setViewport).not.toHaveBeenCalled();
  });
});
