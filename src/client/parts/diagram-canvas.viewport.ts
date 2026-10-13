import { type Edge, getViewportForBounds, type Node, type ReactFlowInstance, type Rect } from "@xyflow/react";

import type { DiagramViewFramingOptions } from "@/features/diagram/diagram-spatial";

export const DIAGRAM_MIN_ZOOM = 0.01;
const ROOT_VIEWPORT_PADDING = 24;

export type DiagramCameraFrame =
  Readonly<{ mode: "nodes"; nodeIds: readonly string[] }> | Readonly<{ mode: "bounds"; bounds: Rect }>;

export async function focusBoundsFraming<NodeType extends Node, EdgeType extends Edge>(
  instance: ReactFlowInstance<NodeType, EdgeType>,
  bounds: Rect,
  viewportElement: HTMLElement,
  reserveRight = 0,
  duration = 500,
): Promise<void> {
  if (viewportElement.clientWidth <= 0 || viewportElement.clientHeight <= 0 || bounds.width <= 0 || bounds.height <= 0)
    return;
  const width = Math.max(1, viewportElement.clientWidth - reserveRight);
  const height = viewportElement.clientHeight;
  const viewport = getViewportForBounds(bounds, width, height, DIAGRAM_MIN_ZOOM, 1, `${ROOT_VIEWPORT_PADDING}px`);
  await instance.setViewport(viewport, { duration });
}

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
  reserveRight = 0,
): Promise<void> {
  const width = Math.max(1, viewportElement.clientWidth - reserveRight);
  const diagramBounds = instance.getNodesBounds(instance.getNodes());
  if (reserveRight > 0) await focusBoundsFraming(instance, diagramBounds, viewportElement, reserveRight, 0);
  else await instance.fitView(DIAGRAM_FIT_VIEW_OPTIONS);

  const viewport = instance.getViewport();
  const diagramStartX = diagramBounds.x * viewport.zoom + viewport.x;
  const diagramEndX = (diagramBounds.x + diagramBounds.width) * viewport.zoom + viewport.x;
  const diagramStartY = diagramBounds.y * viewport.zoom + viewport.y;
  const diagramEndY = (diagramBounds.y + diagramBounds.height) * viewport.zoom + viewport.y;

  if (options.mode === "fit") {
    const offsetX = getOverflowingAxisOffset(diagramStartX, diagramEndX, width);
    const offsetY = getOverflowingAxisOffset(diagramStartY, diagramEndY, viewportElement.clientHeight);
    if (offsetX === 0 && offsetY === 0) return;

    await instance.setViewport({ x: viewport.x + offsetX, y: viewport.y + offsetY, zoom: viewport.zoom });
    return;
  }

  if (!instance.getNode(options.nodeId)) return;
  const diagramOverflows =
    diagramBounds.width * viewport.zoom > width || diagramBounds.height * viewport.zoom > viewportElement.clientHeight;
  if (!diagramOverflows) return;

  const rootBounds = instance.getNodesBounds([options.nodeId]);
  const offsetX = getAxisOffset(
    options.x,
    rootBounds.x * viewport.zoom + viewport.x,
    (rootBounds.x + rootBounds.width) * viewport.zoom + viewport.x,
    width,
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
