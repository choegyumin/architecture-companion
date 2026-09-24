import {
  buildDiagramReactFlowNodes,
  createDiagramLinkActivationHandler,
  type DiagramReactFlowRenderModel,
  toMessageReactFlowEdge,
} from "@/client/widgets/diagram-renderer.react-flow";
import type { Diagram } from "@/features/diagram/diagram";
import type { DiagramLayout } from "@/features/diagram/diagram-spatial";
import type { MessageReactFlowEdge } from "@/shared/react-flow/message-edge";

export function buildSequenceDiagramReactFlowRenderModel(
  diagram: Diagram,
  layout: DiagramLayout,
  onOpenSource: (href: string) => void,
): DiagramReactFlowRenderModel {
  const nodes = buildDiagramReactFlowNodes(diagram, layout, onOpenSource);
  const onLinkActivate = createDiagramLinkActivationHandler(onOpenSource);
  const edges = layout.edges.map<MessageReactFlowEdge>((placement) => {
    const edge = diagram.graph.edges.find(({ id }) => id === placement.id);
    if (!edge) throw new Error(`Layout result references an unknown diagram edge: ${placement.id}`);
    if (edge.type !== "message") throw new Error(`Sequence layout references a non-message edge: ${edge.id}`);
    return toMessageReactFlowEdge(edge, placement.points, onLinkActivate);
  });

  return { nodes, edges };
}
