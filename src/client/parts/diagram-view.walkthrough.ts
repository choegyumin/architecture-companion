import type { DiagramCameraFrame } from "@/client/parts/diagram-canvas.viewport";
import type { DiagramReactFlowRenderModel } from "@/client/parts/diagram-view.react-flow";
import type { AnnotationTarget } from "@/features/annotation/annotation-document";
import type { DiagramLayout } from "@/features/diagram/diagram-spatial";
import { cn } from "@/shared/react/class-name";

/** Applies a step to the renderer's current projection, without changing its interactions. */
export function applyWalkthrough(
  model: DiagramReactFlowRenderModel,
  elements: readonly AnnotationTarget[],
  layout: DiagramLayout,
): Readonly<{ model: DiagramReactFlowRenderModel; frame?: DiagramCameraFrame }> {
  if (elements.length === 0) return { model };
  const emphasizedNodes = new Set<string>();
  const storedEdges = new Set<string>();
  const frameNodes = new Set<string>();
  for (const element of elements) {
    if (element.type === "node" || element.type === "group") {
      emphasizedNodes.add(element.id);
      frameNodes.add(element.id);
    } else if (element.type === "edge") storedEdges.add(element.id);
    else if (element.type === "edge-set") {
      for (const id of element.edgeIds) storedEdges.add(id);
      frameNodes.add(element.sourceId);
      frameNodes.add(element.targetId);
    }
  }
  const emphasizedEdges = new Set<string>();
  for (const edge of model.edges) {
    const target = model.edgeTargets?.get(edge.id);
    const origins =
      model.graphEdgeIds?.get(edge.id) ??
      (target?.type === "edge-set" ? target.edgeIds : target?.type === "edge" ? [target.id] : [edge.id]);
    if (!origins.some((id) => storedEdges.has(id))) continue;
    emphasizedEdges.add(edge.id);
    frameNodes.add(edge.source);
    frameNodes.add(edge.target);
  }
  const nodes = model.nodes.map((node) => {
    if (node.type === "bounding-group" && node.data.label == null) return node;
    const emphasis = emphasizedNodes.has(node.id);
    return {
      ...node,
      className: cn(node.className, emphasis ? "is-walkthrough-emphasis" : "is-walkthrough-dim"),
      style: { ...node.style, opacity: emphasis ? 1 : 0.25 },
      ...(emphasis ? { zIndex: 5 } : {}),
    };
  });
  const edges = model.edges.map((edge) => {
    if (!emphasizedEdges.has(edge.id)) return { ...edge, style: { ...edge.style, opacity: 0.25 } };
    const color = "var(--primary)";
    return {
      ...edge,
      style: { ...edge.style, stroke: color, strokeWidth: 3, opacity: 1 },
      ...(edge.markerStart != null && typeof edge.markerStart !== "string"
        ? { markerStart: { ...edge.markerStart, color } }
        : {}),
      ...(edge.markerEnd != null && typeof edge.markerEnd !== "string"
        ? { markerEnd: { ...edge.markerEnd, color } }
        : {}),
    };
  });
  const visibleFrameIds = [...frameNodes].filter((id) => model.nodes.some((node) => node.id === id));
  const updatedModel = { ...model, nodes, edges };
  if (!model.nodes.some((node) => node.type === "lifeline")) {
    return {
      model: updatedModel,
      ...(visibleFrameIds.length ? { frame: { mode: "nodes", nodeIds: visibleFrameIds } as const } : {}),
    };
  }

  // Sequence lifelines span the entire diagram. Frame selected message geometry
  // and ordinary shapes instead, so a single message does not fit every step.
  const points = layout.edges.filter((edge) => emphasizedEdges.has(edge.id)).flatMap((edge) => edge.points);
  const placements = [...layout.groups, ...layout.nodes];
  for (const id of visibleFrameIds) {
    if (model.nodes.find((node) => node.id === id)?.type === "lifeline") continue;
    const placement = placements.find((node) => node.id === id);
    if (!placement) continue;
    let { x, y } = placement.position;
    let parentId = placement.parentId;
    while (parentId) {
      const parent = placements.find((node) => node.id === parentId);
      if (!parent) break;
      x += parent.position.x;
      y += parent.position.y;
      parentId = parent.parentId;
    }
    points.push({ x, y }, { x: x + placement.size.width, y: y + placement.size.height });
  }
  if (points.length === 0) return { model: updatedModel };
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  const width = Math.max(1, Math.max(...points.map((point) => point.x)) - x);
  const height = Math.max(48, Math.max(...points.map((point) => point.y)) - y);
  return { model: updatedModel, frame: { mode: "bounds", bounds: { x, y, width, height } } };
}
