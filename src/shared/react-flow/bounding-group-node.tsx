import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import type { ReactNode } from "react";

import { cn } from "@/shared/react/class-name";

type BoundingGroupNodeData = Readonly<{
  label?: string;
  hideTitle?: boolean;
  description?: ReactNode;
  activatable?: boolean;
}>;

export type BoundingGroupReactFlowNode = Node<BoundingGroupNodeData, "bounding-group">;

export function BoundingGroupNode({ data, isConnectable }: NodeProps<BoundingGroupReactFlowNode>) {
  const inert = data.label == null;
  return (
    <article
      aria-hidden={inert || undefined}
      aria-label={data.label != null ? `Group: ${data.label}` : undefined}
      className={cn(
        "size-full rounded-xl border-2 border-dashed",
        inert && "pointer-events-none",
        data.activatable && "cursor-pointer hover:border-primary/60",
      )}
    >
      <Handle isConnectable={!inert && isConnectable} position={Position.Left} style={{ opacity: 0 }} type="target" />
      {!inert && (!data.hideTitle || data.description != null) ? (
        <header className="p-4">
          {!data.hideTitle ? <h3 className="font-heading text-sm font-semibold">{data.label}</h3> : null}
          {data.description != null ? <p className="mt-1 text-xs text-muted-foreground">{data.description}</p> : null}
        </header>
      ) : null}
      <Handle isConnectable={!inert && isConnectable} position={Position.Right} style={{ opacity: 0 }} type="source" />
    </article>
  );
}
