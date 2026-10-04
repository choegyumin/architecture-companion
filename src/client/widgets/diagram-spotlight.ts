import type { DiagramReactFlowEdge, DiagramReactFlowNode } from "@/client/parts/diagram-canvas";
import type { DiagramReactFlowRenderModel } from "@/client/widgets/diagram-renderer.react-flow";
import type { AnnotationTarget } from "@/features/annotation/annotation-document";
import type { ArtifactSpotlight } from "@/features/spotlight/spotlight";

export const SPOTLIGHT_EMPHASIZED_CLASS_NAME = "diagram-spotlight-emphasized";
export const SPOTLIGHT_DIMMED_CLASS_NAME = "diagram-spotlight-dimmed";
const SPOTLIGHT_STROKE = "var(--primary)";
const SPOTLIGHT_DIMMED_OPACITY = 0.25;

export type SpotlightRenderResult = Readonly<{
  model: DiagramReactFlowRenderModel;
  framedNodeIds: readonly string[];
}>;

function elementKey(target: AnnotationTarget): string {
  return JSON.stringify(target);
}

function joinClassName(...names: Array<string | undefined>): string | undefined {
  const joined = names.filter((name): name is string => typeof name === "string" && name.length > 0).join(" ");
  return joined.length > 0 ? joined : undefined;
}

/**
 * Applies an agent spotlight to a built render model. Spotlighted nodes and
 * edges are emphasized while the remaining diagram is dimmed, and the node ids
 * to frame in the viewport are returned. A spotlight whose elements no longer
 * exist in the rendered artifact leaves the model unchanged.
 */
export function applySpotlight(
  model: DiagramReactFlowRenderModel,
  spotlight: ArtifactSpotlight,
): SpotlightRenderResult {
  const elements = spotlight.diagram.elements;
  if (elements.length === 0) return { model, framedNodeIds: [] };

  // Aggregate render edges display several graph edges as one path; map every
  // underlying graph edge id to the render edge that shows it.
  const renderEdgeIdsByGraphEdgeId = new Map<string, Set<string>>();
  for (const [renderEdgeId, target] of model.edgeTargets ?? []) {
    if (target.type !== "edge-set") continue;
    for (const edgeId of target.edgeIds) {
      const renderEdgeIds = renderEdgeIdsByGraphEdgeId.get(edgeId) ?? new Set<string>();
      renderEdgeIds.add(renderEdgeId);
      renderEdgeIdsByGraphEdgeId.set(edgeId, renderEdgeIds);
    }
  }

  const elementKeys = new Set(elements.map(elementKey));
  const addressedGraphIds = new Set<string>();
  const emphasizedRenderEdgeIds = new Set<string>();
  const framedNodeIds = new Set<string>();

  for (const element of elements) {
    if (element.type === "node" || element.type === "group") {
      addressedGraphIds.add(element.id);
      framedNodeIds.add(element.id);
      continue;
    }

    const graphEdgeIds =
      element.type === "edge" ? [element.id] : element.type === "edge-set" ? [...element.edgeIds] : [];
    for (const edgeId of graphEdgeIds) {
      addressedGraphIds.add(edgeId);
      for (const renderEdgeId of renderEdgeIdsByGraphEdgeId.get(edgeId) ?? [])
        emphasizedRenderEdgeIds.add(renderEdgeId);
    }
    if (element.type === "edge-set") {
      framedNodeIds.add(element.sourceId);
      framedNodeIds.add(element.targetId);
    }
  }

  for (const edge of model.edges) {
    if (edge.id !== null && addressedGraphIds.has(edge.id)) emphasizedRenderEdgeIds.add(edge.id);
    const target = model.edgeTargets?.get(edge.id);
    if (target && elementKeys.has(elementKey(target))) emphasizedRenderEdgeIds.add(edge.id);
    if (!emphasizedRenderEdgeIds.has(edge.id)) continue;

    // Frame the endpoints of emphasized edges as well, so edge-only
    // spotlights still pan and zoom to the relevant area.
    framedNodeIds.add(edge.source);
    framedNodeIds.add(edge.target);
  }

  const emphasizedNodeIds = new Set(
    model.nodes.filter((node) => node.type !== "bounding-group" && addressedGraphIds.has(node.id)).map(({ id }) => id),
  );
  const hasEmphasis = emphasizedNodeIds.size > 0 || emphasizedRenderEdgeIds.size > 0;
  if (!hasEmphasis) return { model, framedNodeIds: [] };

  const nodes = model.nodes.map<DiagramReactFlowNode>((node) => {
    if (node.type === "bounding-group") return node;
    if (emphasizedNodeIds.has(node.id)) {
      // React Flow writes an inline z-index on every node wrapper, so raising
      // emphasized nodes above dimmed ones must happen here, not in CSS.
      return {
        ...node,
        className: joinClassName(node.className, SPOTLIGHT_EMPHASIZED_CLASS_NAME),
        zIndex: 5,
      };
    }
    return { ...node, className: joinClassName(node.className, SPOTLIGHT_DIMMED_CLASS_NAME) };
  });

  const edges = model.edges.map<DiagramReactFlowEdge>((edge) => {
    if (emphasizedRenderEdgeIds.has(edge.id)) {
      return {
        ...edge,
        className: joinClassName(edge.className, SPOTLIGHT_EMPHASIZED_CLASS_NAME),
        markerEnd:
          typeof edge.markerEnd === "object" && edge.markerEnd !== null
            ? { ...edge.markerEnd, color: SPOTLIGHT_STROKE }
            : edge.markerEnd,
        style: { ...edge.style, stroke: SPOTLIGHT_STROKE, strokeWidth: 3 },
      };
    }
    return {
      ...edge,
      className: joinClassName(edge.className, SPOTLIGHT_DIMMED_CLASS_NAME),
      style: { ...edge.style, opacity: SPOTLIGHT_DIMMED_OPACITY },
    };
  });

  return { model: { ...model, nodes, edges }, framedNodeIds: [...framedNodeIds] };
}
