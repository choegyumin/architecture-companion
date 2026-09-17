import z from "zod";

import type {
  DiagramGraph,
  FragmentDiagramNode,
  LifelineDiagramNode,
  MessageDiagramEdge,
} from "@/features/diagram/diagram-graph";
import type {
  DiagramLayout,
  DiagramLayoutNode,
  DiagramLayoutPoint,
  DiagramNodeSizes,
} from "@/features/diagram/diagram-spatial";
import { getOrThrow } from "@/shared/universal/get-or-throw";

export const sequenceDiagramLayoutConfigSchema = z.object({ id: z.literal("sequence") }).strict();
export type SequenceDiagramLayoutConfig = z.infer<typeof sequenceDiagramLayoutConfigSchema>;

const ROW_HEIGHT = 72;
const SELF_MESSAGE_LOOP_HEIGHT = 28;
const LIFELINE_GAP = 128;
const HORIZONTAL_MARGIN = 48;
const FRAGMENT_HORIZONTAL_MARGIN = 24;
const FRAGMENT_GUARD_MESSAGE_GAP = 32;
const FRAGMENT_TOP_MARGIN = ROW_HEIGHT / 2 + FRAGMENT_GUARD_MESSAGE_GAP;
const FRAGMENT_BOTTOM_MARGIN = 24;

function getPoint(x: number, y: number): DiagramLayoutPoint {
  return { x, y };
}

function getMessageIndex(messages: readonly MessageDiagramEdge[]): ReadonlyMap<string, number> {
  return new Map(messages.map((edge, index) => [edge.id, index]));
}

export function layoutSequenceDiagram(diagram: DiagramGraph, nodeSizes: DiagramNodeSizes): Promise<DiagramLayout> {
  const lifelines = diagram.nodes.filter((node): node is LifelineDiagramNode => node.type === "lifeline");
  const fragments = diagram.nodes.filter((node): node is FragmentDiagramNode => node.type === "fragment");
  const messages = diagram.edges.filter((edge): edge is MessageDiagramEdge => edge.type === "message");
  if (lifelines.length === 0) throw new Error("Sequence layout requires at least one lifeline.");
  if (diagram.groups.length > 0) throw new Error("Sequence layout does not support diagram groups.");

  const messageIndexes = getMessageIndex(messages);
  const fragmentBranchStartIndexes = [
    ...new Set(
      fragments.flatMap((fragment) =>
        fragment.branches.flatMap(({ startMessageId }) => {
          const index = messageIndexes.get(startMessageId);
          return index === undefined ? [] : [index];
        }),
      ),
    ),
  ].toSorted((left, right) => left - right);
  const selfMessageIndexes = messages.flatMap((message, index) => (message.source === message.target ? [index] : []));
  const lifelineX = new Map<string, number>();
  let cursor = HORIZONTAL_MARGIN;
  lifelines.forEach((lifeline) => {
    lifelineX.set(lifeline.id, cursor);
    cursor += getOrThrow(nodeSizes[lifeline.id], `Missing measured node size: ${lifeline.id}`).width + LIFELINE_GAP;
  });
  const headerHeight = Math.max(
    ...lifelines.map(
      (lifeline) => getOrThrow(nodeSizes[lifeline.id], `Missing measured node size: ${lifeline.id}`).height,
    ),
  );
  const messageY = (index: number) =>
    headerHeight +
    ROW_HEIGHT * (index + 1) +
    SELF_MESSAGE_LOOP_HEIGHT * selfMessageIndexes.filter((selfMessageIndex) => selfMessageIndex < index).length +
    FRAGMENT_GUARD_MESSAGE_GAP * fragmentBranchStartIndexes.filter((startIndex) => startIndex <= index).length;
  const totalHeight = messageY(messages.length) + ROW_HEIGHT;

  const nodes: DiagramLayoutNode[] = lifelines.map((lifeline) => {
    const x = lifelineX.get(lifeline.id);
    if (x === undefined) throw new Error(`Sequence layout is missing lifeline position: ${lifeline.id}`);
    const handles: Array<{ id: string; side: "left" | "right"; y: number }> = [];

    messages.forEach((message) => {
      const index = messageIndexes.get(message.id);
      if (index === undefined) return;
      const y = messageY(index);
      if (message.source === lifeline.id) handles.push({ id: `${message.id}:source`, side: "right", y });
      if (message.target === lifeline.id) {
        const selfMessage = message.source === message.target;
        handles.push({
          id: `${message.id}:target`,
          side: "left",
          y: y + (selfMessage ? SELF_MESSAGE_LOOP_HEIGHT : 0),
        });
      }
    });

    const activations = lifeline.activations.flatMap((activation) => {
      const startIndex = messageIndexes.get(activation.startsAt.messageId);
      const endIndex = messageIndexes.get(activation.endsAt.messageId);
      if (startIndex === undefined || endIndex === undefined) return [];
      const start = messageY(Math.min(startIndex, endIndex));
      const end = messageY(Math.max(startIndex, endIndex)) + 24;
      return [{ id: activation.id, y: start, height: Math.max(16, end - start) }];
    });
    const size = getOrThrow(nodeSizes[lifeline.id], `Missing measured node size: ${lifeline.id}`);

    return {
      id: lifeline.id,
      position: { x, y: 0 },
      size: { width: size.width, height: totalHeight },
      data: { handles, activations },
    };
  });

  const edges = messages.map((message) => {
    const index = messageIndexes.get(message.id);
    if (index === undefined) throw new Error(`Sequence layout is missing message position: ${message.id}`);
    const sourceX = lifelineX.get(message.source);
    const targetX = lifelineX.get(message.target);
    if (sourceX === undefined || targetX === undefined) {
      throw new Error(`Sequence message references an unknown lifeline: ${message.id}`);
    }
    const sourceNode = lifelines.find(({ id }) => id === message.source);
    const targetNode = lifelines.find(({ id }) => id === message.target);
    if (!sourceNode || !targetNode) throw new Error(`Sequence message references an unknown lifeline: ${message.id}`);
    const sourceY = messageY(index);
    const targetY = message.source === message.target ? sourceY + SELF_MESSAGE_LOOP_HEIGHT : sourceY;
    const sourceSize = getOrThrow(nodeSizes[sourceNode.id], `Missing measured node size: ${sourceNode.id}`);
    const targetSize = getOrThrow(nodeSizes[targetNode.id], `Missing measured node size: ${targetNode.id}`);
    const sourcePoint = getPoint(sourceX + sourceSize.width / 2, sourceY);
    const targetPoint = getPoint(targetX + targetSize.width / 2, targetY);
    const selfMessageX = sourcePoint.x + sourceSize.width / 2 + LIFELINE_GAP / 2;
    const points =
      message.source === message.target
        ? [sourcePoint, getPoint(selfMessageX, sourceY), getPoint(selfMessageX, targetY), targetPoint]
        : [sourcePoint, targetPoint];

    return {
      id: message.id,
      points,
    };
  });

  fragments.forEach((fragment) => {
    const ranges = fragment.branches.flatMap((branch) => {
      const startIndex = messageIndexes.get(branch.startMessageId);
      const endIndex = messageIndexes.get(branch.endMessageId);
      if (startIndex === undefined || endIndex === undefined) return [];
      return [
        {
          branch,
          startIndex,
          endIndex,
          start: messageY(startIndex) - FRAGMENT_TOP_MARGIN,
          end: messageY(endIndex) + FRAGMENT_BOTTOM_MARGIN,
        },
      ];
    });
    if (ranges.length === 0) throw new Error(`Sequence fragment has no resolvable message range: ${fragment.id}`);
    const messageIds = new Set(
      ranges.flatMap(({ startIndex, endIndex }) => messages.slice(startIndex, endIndex + 1).map(({ id }) => id)),
    );
    const points = edges.flatMap((edge) => (messageIds.has(edge.id) ? edge.points : []));
    const top = Math.min(...ranges.map(({ start }) => start));
    const bottom = Math.max(...ranges.map(({ end }) => end));
    const left = Math.min(...points.map(({ x }) => x));
    const right = Math.max(...points.map(({ x }) => x));
    nodes.push({
      id: fragment.id,
      position: { x: left - FRAGMENT_HORIZONTAL_MARGIN, y: top },
      size: { width: right - left + FRAGMENT_HORIZONTAL_MARGIN * 2, height: bottom - top },
      data: {
        branches: ranges.map(({ branch, start, end }) => ({ id: branch.id, y: start - top, height: end - start })),
      },
    });
  });

  return Promise.resolve({ nodes, groups: [], edges, initialView: { mode: "fit" } });
}
