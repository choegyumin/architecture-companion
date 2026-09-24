import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import type { ReactNode } from "react";

import { cn } from "@/shared/react/class-name";

type LabeledGroupNodeData = Readonly<{
  label: ReactNode;
  description?: ReactNode;
  activatable?: boolean;
}>;

export type LabeledGroupReactFlowNode = Node<LabeledGroupNodeData, "labeled-group">;

export function LabeledGroupNode({ data, isConnectable }: NodeProps<LabeledGroupReactFlowNode>) {
  return (
    <article
      aria-label={typeof data.label === "string" ? `Group: ${data.label}` : "Group"}
      className={cn(
        "size-full rounded-xl border bg-muted/30 shadow-sm",
        data.activatable && "cursor-pointer hover:border-primary/60",
      )}
    >
      <Handle isConnectable={isConnectable} position={Position.Left} style={{ opacity: 0 }} type="target" />
      <header className="p-4">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Group</p>
        <h3 className="mt-1 font-heading text-sm font-semibold">{data.label}</h3>
        {data.description != null ? <p className="mt-1 text-xs text-muted-foreground">{data.description}</p> : null}
      </header>
      <Handle isConnectable={isConnectable} position={Position.Right} style={{ opacity: 0 }} type="source" />
    </article>
  );
}
