import { type Node, type NodeProps } from "@xyflow/react";

// A loose-node bounding group: a dashed, inert outline marking where an
// implicit grouping sits — visually a group, but not one the reader can act on.
export type BoundingGroupReactFlowNode = Node<Record<string, never>, "bounding-group">;

export function BoundingGroupNode(_: NodeProps<BoundingGroupReactFlowNode>) {
  return <article aria-hidden="true" className="pointer-events-none size-full rounded-xl border-2 border-dashed" />;
}
