import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import z from "zod";

import type { DiagramGraph, DiagramGroup } from "@/features/diagram/diagram-graph";
import type {
  DiagramLayout,
  DiagramLayoutEdge,
  DiagramLayoutGroup,
  DiagramLayoutNode,
  DiagramLayoutPoint,
  DiagramNodeSizes,
  DiagramViewFramingOptions,
} from "@/features/diagram/diagram-spatial";
import { getOrThrow } from "@/shared/universal/get-or-throw";

export const elkLayeredDiagramLayoutConfigSchema = z
  .object({
    id: z.literal("elk-layered"),
    options: z
      .object({
        direction: z.enum(["UP", "DOWN", "LEFT", "RIGHT"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ElkLayeredDiagramLayoutConfig = z.infer<typeof elkLayeredDiagramLayoutConfigSchema>;

const ROOT_ID = "architecture-companion-layout-root";
const GROUP_PADDING = { top: 96, right: 32, bottom: 32, left: 32 } as const;
// ELK returns 0x0 for children-less groups, and a 0x0 node permanently stalls React Flow's queued fitView.
// Reserve the header chrome plus one default card width (288) so empty groups render and siblings keep clear.
const EMPTY_GROUP_SIZE = {
  width: 288 + GROUP_PADDING.left + GROUP_PADDING.right,
  height: GROUP_PADDING.top + GROUP_PADDING.bottom,
} as const;

type ElkLayeredDiagramLayoutDirection = NonNullable<NonNullable<ElkLayeredDiagramLayoutConfig["options"]>["direction"]>;

function toPadding({ top, right, bottom, left }: typeof GROUP_PADDING): string {
  return `[top=${top},right=${right},bottom=${bottom},left=${left}]`;
}

function toElkGroup(
  group: DiagramGroup,
  diagram: DiagramGraph,
  nodeSizes: DiagramNodeSizes,
  direction: ElkLayeredDiagramLayoutDirection,
): ElkNode {
  const children = [
    ...diagram.groups
      .filter(({ parentId }) => parentId === group.id)
      .map((child) => toElkGroup(child, diagram, nodeSizes, direction)),
    ...diagram.nodes
      .filter(({ groupId }) => groupId === group.id)
      .map((node) => ({
        id: node.id,
        ...getOrThrow(nodeSizes[node.id], `Missing measured node size: ${node.id}`),
      })),
  ];
  return {
    id: group.id,
    ...(children.length === 0 ? EMPTY_GROUP_SIZE : {}),
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.padding": toPadding(GROUP_PADDING),
      "elk.spacing.nodeNode": "48",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
    },
    children,
  };
}

function toElkInput(
  diagram: DiagramGraph,
  nodeSizes: DiagramNodeSizes,
  direction: ElkLayeredDiagramLayoutDirection,
): ElkNode {
  return {
    id: ROOT_ID,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      // The default BRANDES_KOEPF aligns the deepest vertical spine to keep it straight,
      // which roots trees at a side edge. LINEAR_SEGMENTS balances layers instead.
      "elk.layered.nodePlacement.strategy": "LINEAR_SEGMENTS",
      "elk.spacing.nodeNode": "64",
      "elk.layered.spacing.nodeNodeBetweenLayers": "112",
    },
    children: [
      ...diagram.groups
        .filter(({ parentId }) => !parentId)
        .map((group) => toElkGroup(group, diagram, nodeSizes, direction)),
      ...diagram.nodes
        .filter(({ groupId }) => !groupId)
        .map((node) => ({
          id: node.id,
          ...getOrThrow(nodeSizes[node.id], `Missing measured node size: ${node.id}`),
        })),
    ],
    edges: diagram.edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  };
}

type CollectedElements = Readonly<{
  nodes: readonly DiagramLayoutNode[];
  groups: readonly DiagramLayoutGroup[];
  groupOrigins: Readonly<Record<string, DiagramLayoutPoint>>;
}>;

function collectElements(
  parent: ElkNode,
  groupIds: ReadonlySet<string>,
  parentId: string | undefined,
  parentOrigin: DiagramLayoutPoint,
): CollectedElements {
  return (parent.children ?? []).reduce<CollectedElements>(
    (collected, child) => {
      const position = { x: child.x ?? 0, y: child.y ?? 0 };
      const element = {
        id: child.id,
        ...(parentId ? { parentId } : {}),
        position,
        size: { width: child.width ?? 0, height: child.height ?? 0 },
      };

      if (!groupIds.has(child.id)) {
        return { ...collected, nodes: [...collected.nodes, element] };
      }

      const absoluteOrigin = { x: parentOrigin.x + position.x, y: parentOrigin.y + position.y };
      const descendants = collectElements(child, groupIds, child.id, absoluteOrigin);

      return {
        nodes: [...collected.nodes, ...descendants.nodes],
        groups: [...collected.groups, element, ...descendants.groups],
        groupOrigins: {
          ...collected.groupOrigins,
          [child.id]: absoluteOrigin,
          ...descendants.groupOrigins,
        },
      };
    },
    { nodes: [], groups: [], groupOrigins: {} },
  );
}

type CollectedElkEdge = Readonly<{ edge: ElkExtendedEdge; containerId: string }>;

function collectElkEdges(parent: ElkNode): readonly CollectedElkEdge[] {
  return [
    ...(parent.edges ?? []).map((edge) => ({ edge, containerId: edge.container ?? parent.id })),
    ...(parent.children ?? []).flatMap(collectElkEdges),
  ];
}

function toDiagramLayoutEdge(
  { edge, containerId }: CollectedElkEdge,
  groupOrigins: CollectedElements["groupOrigins"],
): DiagramLayoutEdge {
  const section = edge.sections?.at(0);
  if (!section) throw new Error(`ELK result is missing an edge path: ${edge.id}`);

  const offset = containerId === ROOT_ID ? { x: 0, y: 0 } : groupOrigins[containerId];
  if (!offset) throw new Error(`ELK result references an unknown edge container: ${containerId}`);

  const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(({ x, y }) => ({
    x: x + offset.x,
    y: y + offset.y,
  }));

  return { id: edge.id, points };
}

function toViewportPolicy(
  diagram: DiagramGraph,
  direction: ElkLayeredDiagramLayoutDirection,
): DiagramViewFramingOptions {
  const targetIds = new Set(diagram.edges.map(({ target }) => target));
  const roots = diagram.nodes.filter(({ id }) => !targetIds.has(id));
  const root = roots.length === 1 ? roots.at(0) : undefined;
  if (!root) return { mode: "fit" };

  const isVertical = direction === "UP" || direction === "DOWN";
  return {
    mode: "node",
    nodeId: root.id,
    x: isVertical ? "center" : "clamp",
    y: isVertical ? "clamp" : "center",
  };
}

export async function layoutElkLayeredDiagram(
  diagram: DiagramGraph,
  nodeSizes: DiagramNodeSizes,
  options?: ElkLayeredDiagramLayoutConfig["options"],
): Promise<DiagramLayout> {
  const direction = options?.direction ?? "DOWN";
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  const output = await new ELK().layout(toElkInput(diagram, nodeSizes, direction));
  const groupIds = new Set(diagram.groups.map(({ id }) => id));
  const elements = collectElements(output, groupIds, undefined, { x: 0, y: 0 });
  const outputNodeIds = new Set(elements.nodes.map(({ id }) => id));
  const outputGroupIds = new Set(elements.groups.map(({ id }) => id));

  diagram.nodes.forEach(({ id }) => {
    if (!outputNodeIds.has(id)) throw new Error(`ELK result is missing a node: ${id}`);
  });
  diagram.groups.forEach(({ id }) => {
    if (!outputGroupIds.has(id)) throw new Error(`ELK result is missing a group: ${id}`);
  });

  return {
    nodes: elements.nodes,
    groups: elements.groups,
    edges: collectElkEdges(output).map((edge) => toDiagramLayoutEdge(edge, elements.groupOrigins)),
    initialView: toViewportPolicy(diagram, direction),
  };
}
