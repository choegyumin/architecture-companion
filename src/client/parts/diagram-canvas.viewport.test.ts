import type { ReactFlowInstance } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";

import { fitViewFraming } from "@/client/parts/diagram-canvas.viewport";

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

describe("fitting the view to the layout", () => {
  it("keeps the fitted viewport from the fit policy", async () => {
    const { fitView, instance, setViewport } = createReactFlowInstance();

    await fitViewFraming(instance, { mode: "fit" }, viewportElement);

    expect(fitView).toHaveBeenCalledWith({ maxZoom: 1, minZoom: 0.01, padding: "24px" });
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
