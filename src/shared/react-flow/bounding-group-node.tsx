import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";

// A loose-node bounding group: a dashed, inert outline marking where an
// implicit grouping sits — visually a group, but not one the reader can act on.
export type BoundingGroupReactFlowNode = Node<Record<string, never>, "bounding-group">;

export function BoundingGroupNode(_: NodeProps<BoundingGroupReactFlowNode>) {
  return (
    <article aria-hidden="true" className="pointer-events-none size-full rounded-xl border-2 border-dashed">
      <Handle isConnectable={false} position={Position.Left} style={{ opacity: 0 }} type="target" />
      <Handle isConnectable={false} position={Position.Right} style={{ opacity: 0 }} type="source" />
    </article>
  );
}
