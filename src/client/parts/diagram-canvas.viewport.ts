import type { Edge, Node, ReactFlowInstance } from "@xyflow/react";

import type { DiagramViewFramingOptions } from "@/features/diagram/diagram-spatial";

export const DIAGRAM_MIN_ZOOM = 0.01;

const ROOT_VIEWPORT_PADDING = 24;
/**
 * The spotlight panel overlays the canvas's top-right corner: a fixed 20rem
 * width plus its margin to the canvas edge and to the framed content. While
 * a spotlight is open, every camera move treats this strip as unusable so
 * framed content keeps clear of the panel regardless of captions.
 */
export const SPOTLIGHT_VIEWPORT_RESERVE = 360;
export const DIAGRAM_FIT_VIEW_OPTIONS = {
  minZoom: DIAGRAM_MIN_ZOOM,
  maxZoom: 1,
  padding: `${ROOT_VIEWPORT_PADDING}px`,
} as const;

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
  rightReserve = 0,
): Promise<void> {
  await instance.fitView(DIAGRAM_FIT_VIEW_OPTIONS);

  const viewport = instance.getViewport();
  const diagramBounds = instance.getNodesBounds(instance.getNodes());
  const diagramStartX = diagramBounds.x * viewport.zoom + viewport.x;
  const diagramEndX = (diagramBounds.x + diagramBounds.width) * viewport.zoom + viewport.x;
  const diagramStartY = diagramBounds.y * viewport.zoom + viewport.y;
  const diagramEndY = (diagramBounds.y + diagramBounds.height) * viewport.zoom + viewport.y;
  const usableWidth = viewportElement.clientWidth - rightReserve;

  if (options.mode === "fit") {
    // An overflowing axis pins its start edge to the padding; an axis that
    // fits keeps fitView's centering, shifted onto the usable width.
    const overflowingX = diagramEndX - diagramStartX > usableWidth - ROOT_VIEWPORT_PADDING * 2;
    const overflowingY = diagramEndY - diagramStartY > viewportElement.clientHeight - ROOT_VIEWPORT_PADDING * 2;
    const offsetX = overflowingX ? ROOT_VIEWPORT_PADDING - diagramStartX : rightReserve / 2;
    const offsetY = overflowingY ? ROOT_VIEWPORT_PADDING - diagramStartY : 0;
    if (offsetX === 0 && offsetY === 0) return;

    await instance.setViewport({ x: viewport.x + offsetX, y: viewport.y + offsetY, zoom: viewport.zoom });
    return;
  }

  if (!instance.getNode(options.nodeId)) return;
  const diagramOverflows =
    diagramBounds.width * viewport.zoom > usableWidth ||
    diagramBounds.height * viewport.zoom > viewportElement.clientHeight;
  if (!diagramOverflows) return;

  const rootBounds = instance.getNodesBounds([options.nodeId]);
  const offsetX = getAxisOffset(
    options.x,
    rootBounds.x * viewport.zoom + viewport.x,
    (rootBounds.x + rootBounds.width) * viewport.zoom + viewport.x,
    usableWidth,
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
  rightReserve = 0,
): Promise<void> {
  if (viewportElement.clientWidth === 0 || viewportElement.clientHeight === 0) return;

  const boundsWidth = Math.max(bounds.width, 1);
  const boundsHeight = Math.max(bounds.height, 1);
  const usableWidth = viewportElement.clientWidth - rightReserve;
  const availableWidth = usableWidth - ROOT_VIEWPORT_PADDING * 2;
  const availableHeight = viewportElement.clientHeight - ROOT_VIEWPORT_PADDING * 2;
  const zoom = Math.min(
    Math.max(Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight), DIAGRAM_MIN_ZOOM),
    DIAGRAM_FIT_VIEW_OPTIONS.maxZoom,
  );

  await instance.setViewport(
    {
      x: usableWidth / 2 - (bounds.x + boundsWidth / 2) * zoom,
      y: viewportElement.clientHeight / 2 - (bounds.y + boundsHeight / 2) * zoom,
      zoom,
    },
    { duration: 500 },
  );
}
