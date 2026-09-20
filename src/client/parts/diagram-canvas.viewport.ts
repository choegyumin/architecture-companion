import type { Edge, Node, ReactFlowInstance } from "@xyflow/react";

import type { DiagramViewFramingOptions } from "@/features/diagram/diagram-spatial";

export const DIAGRAM_MIN_ZOOM = 0.01;

const ROOT_VIEWPORT_PADDING = 24;
const FIT_VIEW_OPTIONS = { minZoom: DIAGRAM_MIN_ZOOM, maxZoom: 1, padding: `${ROOT_VIEWPORT_PADDING}px` } as const;

function getOverflowingAxisOffset(start: number, end: number, viewportSize: number): number {
  const availableSize = viewportSize - ROOT_VIEWPORT_PADDING * 2;
  return end - start > availableSize ? ROOT_VIEWPORT_PADDING - start : 0;
}

function getAxisOffset(policy: "center" | "clamp", start: number, end: number, viewportSize: number): number {
  if (policy === "center") return viewportSize / 2 - (start + end) / 2;
  if (start < ROOT_VIEWPORT_PADDING) return ROOT_VIEWPORT_PADDING - start;
  if (end > viewportSize - ROOT_VIEWPORT_PADDING) return viewportSize - ROOT_VIEWPORT_PADDING - end;
  return 0;
}

export async function fitViewFraming<NodeType extends Node, EdgeType extends Edge>(
  instance: ReactFlowInstance<NodeType, EdgeType>,
  options: DiagramViewFramingOptions,
  viewportElement: HTMLElement,
): Promise<void> {
  await instance.fitView(FIT_VIEW_OPTIONS);

  const viewport = instance.getViewport();
  const diagramBounds = instance.getNodesBounds(instance.getNodes());
  const diagramStartX = diagramBounds.x * viewport.zoom + viewport.x;
  const diagramEndX = (diagramBounds.x + diagramBounds.width) * viewport.zoom + viewport.x;
  const diagramStartY = diagramBounds.y * viewport.zoom + viewport.y;
  const diagramEndY = (diagramBounds.y + diagramBounds.height) * viewport.zoom + viewport.y;

  if (options.mode === "fit") {
    const offsetX = getOverflowingAxisOffset(diagramStartX, diagramEndX, viewportElement.clientWidth);
    const offsetY = getOverflowingAxisOffset(diagramStartY, diagramEndY, viewportElement.clientHeight);
    if (offsetX === 0 && offsetY === 0) return;

    await instance.setViewport({ x: viewport.x + offsetX, y: viewport.y + offsetY, zoom: viewport.zoom });
    return;
  }

  if (!instance.getNode(options.nodeId)) return;
  const diagramOverflows =
    diagramBounds.width * viewport.zoom > viewportElement.clientWidth ||
    diagramBounds.height * viewport.zoom > viewportElement.clientHeight;
  if (!diagramOverflows) return;

  const rootBounds = instance.getNodesBounds([options.nodeId]);
  const offsetX = getAxisOffset(
    options.x,
    rootBounds.x * viewport.zoom + viewport.x,
    (rootBounds.x + rootBounds.width) * viewport.zoom + viewport.x,
    viewportElement.clientWidth,
  );
  const offsetY = getAxisOffset(
    options.y,
    rootBounds.y * viewport.zoom + viewport.y,
    (rootBounds.y + rootBounds.height) * viewport.zoom + viewport.y,
    viewportElement.clientHeight,
  );

  if (offsetX === 0 && offsetY === 0) return;

  await instance.setViewport({
    x: viewport.x + offsetX,
    y: viewport.y + offsetY,
    zoom: viewport.zoom,
  });
}
