import type { Edge, Node, ReactFlowInstance } from "@xyflow/react";

import type { DiagramViewFramingOptions } from "@/features/diagram/diagram-spatial";

export const DIAGRAM_MIN_ZOOM = 0.01;

const ROOT_VIEWPORT_PADDING = 24;
export const DIAGRAM_FIT_VIEW_OPTIONS = {
  minZoom: DIAGRAM_MIN_ZOOM,
  maxZoom: 1,
  padding: `${ROOT_VIEWPORT_PADDING}px`,
} as const;

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
  await instance.fitView(DIAGRAM_FIT_VIEW_OPTIONS);

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

/**
 * Frames an arbitrary layout-coordinates rectangle, clamped to the same zoom
 * range as a whole-diagram fit. React Flow's fitBounds cannot clamp zoom, so
 * the viewport is computed directly.
 */
export async function focusBoundsFraming<NodeType extends Node, EdgeType extends Edge>(
  instance: ReactFlowInstance<NodeType, EdgeType>,
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
  viewportElement: HTMLElement,
): Promise<void> {
  if (viewportElement.clientWidth === 0 || viewportElement.clientHeight === 0) return;

  const boundsWidth = Math.max(bounds.width, 1);
  const boundsHeight = Math.max(bounds.height, 1);
  const availableWidth = viewportElement.clientWidth - ROOT_VIEWPORT_PADDING * 2;
  const availableHeight = viewportElement.clientHeight - ROOT_VIEWPORT_PADDING * 2;
  const zoom = Math.min(
    Math.max(Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight), DIAGRAM_MIN_ZOOM),
    DIAGRAM_FIT_VIEW_OPTIONS.maxZoom,
  );

  await instance.setViewport(
    {
      x: viewportElement.clientWidth / 2 - (bounds.x + boundsWidth / 2) * zoom,
      y: viewportElement.clientHeight / 2 - (bounds.y + boundsHeight / 2) * zoom,
      zoom,
    },
    { duration: 500 },
  );
}
