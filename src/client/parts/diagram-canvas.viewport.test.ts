import type { ReactFlowInstance } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";

import { fitViewFraming, focusBoundsFraming } from "@/client/parts/diagram-canvas.viewport";

function createReactFlowInstance(
  overrides: Readonly<{
    diagramBounds?: Readonly<{ height: number; width: number; x: number; y: number }>;
    rootBounds?: Readonly<{ height: number; width: number; x: number; y: number }>;
    viewport?: Readonly<{ x: number; y: number; zoom: number }>;
  }> = {},
) {
  const fitView = vi.fn(async () => true);
  const setViewport = vi.fn(async () => true);
  const diagramBounds = overrides.diagramBounds ?? { height: 100, width: 100, x: 0, y: 0 };
  const rootBounds = overrides.rootBounds ?? { height: 100, width: 100, x: 0, y: 0 };
  const viewport = overrides.viewport ?? { x: 250, y: 150, zoom: 1 };
  const instance = {
    fitView,
    getNode: vi.fn(() => ({ id: "root" })),
    getNodes: vi.fn(() => [{ id: "root" }]),
    getNodesBounds: vi.fn((nodes: readonly unknown[]) =>
      typeof nodes.at(0) === "string" ? rootBounds : diagramBounds,
    ),
    getViewport: vi.fn(() => viewport),
    setViewport,
  } as unknown as ReactFlowInstance;

  return { fitView, instance, setViewport };
}

const viewportElement = { clientHeight: 400, clientWidth: 600 } as HTMLElement;

describe("camera reservation", () => {
  const wideViewport = { clientWidth: 1000, clientHeight: 600 } as HTMLElement;
  it("centers node or bounds framing in the usable area left of the explanation", async () => {
    const { instance, setViewport } = createReactFlowInstance();
    await focusBoundsFraming(instance, { x: 0, y: 0, width: 100, height: 100 }, wideViewport, 360);
    expect(setViewport).toHaveBeenCalledWith({ x: 270, y: 250, zoom: 1 }, { duration: 500 });
  });

  it("reserves the same strip for initial and manual fit", async () => {
    const { instance, setViewport, fitView } = createReactFlowInstance();
    await fitViewFraming(instance, { mode: "fit" }, wideViewport, 360);
    expect(setViewport).toHaveBeenCalledWith({ x: 270, y: 250, zoom: 1 }, { duration: 0 });
    expect(fitView).not.toHaveBeenCalled();
  });

  it("does not move an unmeasured or hidden viewport", async () => {
    const { instance, setViewport } = createReactFlowInstance();
    await focusBoundsFraming(
      instance,
      { x: 0, y: 0, width: 100, height: 100 },
      { clientWidth: 0, clientHeight: 0 } as HTMLElement,
      360,
    );
    await focusBoundsFraming(instance, { x: 0, y: 0, width: 0, height: 0 }, wideViewport, 360);
    expect(setViewport).not.toHaveBeenCalled();
  });

  it("releases the strip when no explanation is displayed", async () => {
    const { instance, setViewport } = createReactFlowInstance();
    await focusBoundsFraming(instance, { x: 0, y: 0, width: 100, height: 100 }, wideViewport);
    expect(setViewport).toHaveBeenCalledWith({ x: 450, y: 250, zoom: 1 }, { duration: 500 });
  });
});

describe("fitting the view to the layout", () => {
  it("keeps the fitted viewport from the fit policy", async () => {
    const { fitView, instance, setViewport } = createReactFlowInstance();

    await fitViewFraming(instance, { mode: "fit" }, viewportElement);

    expect(fitView).toHaveBeenCalledWith({ minZoom: 0.01, maxZoom: 1, padding: "24px" });
    expect(setViewport).not.toHaveBeenCalled();
  });

  it("starts an overflowing fit axis at the viewport padding", async () => {
    const { instance, setViewport } = createReactFlowInstance({
      diagramBounds: { height: 400, width: 1200, x: 100, y: 200 },
      viewport: { x: -50, y: 0, zoom: 0.5 },
    });

    await fitViewFraming(instance, { mode: "fit" }, viewportElement);

    expect(setViewport).toHaveBeenCalledWith({ x: -26, y: 0, zoom: 0.5 });
  });

  it("starts both overflowing fit axes at the viewport padding", async () => {
    const { instance, setViewport } = createReactFlowInstance({
      diagramBounds: { height: 1000, width: 1200, x: 0, y: 0 },
      viewport: { x: 0, y: -50, zoom: 0.5 },
    });

    await fitViewFraming(instance, { mode: "fit" }, viewportElement);

    expect(setViewport).toHaveBeenCalledWith({ x: 24, y: 24, zoom: 0.5 });
  });

  it("keeps the policy node visible even when the fitted diagram still overflows", async () => {
    const { fitView, instance, setViewport } = createReactFlowInstance({
      diagramBounds: { height: 500, width: 1200, x: 0, y: 0 },
      rootBounds: { height: 100, width: 100, x: 900, y: 100 },
    });

    await fitViewFraming(instance, { mode: "node", nodeId: "root", x: "clamp", y: "center" }, viewportElement);

    expect(fitView).toHaveBeenCalledOnce();
    expect(setViewport).toHaveBeenCalledWith({ x: -424, y: 50, zoom: 1 });
  });
});
