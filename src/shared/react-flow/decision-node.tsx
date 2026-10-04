import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";

import { cn } from "@/shared/react/class-name";

type DecisionNodeData = Readonly<{
  controlLabel: string;
  ports: readonly string[];
  active?: boolean;
  accessibleDescription?: string;
}>;

export type DecisionReactFlowNode = Node<DecisionNodeData, "decision">;

// UML decision node: an empty diamond routing one branch control. The control
// itself is never written on the diamond — its guards ride the outgoing edge
// labels — so the label stays screen-reader and tooltip only. Port handles
// share the diamond's tip because the drawn paths come from the layout, not
// from the handles; the ids alone bind edges to their branch case.
export function DecisionNode({ data, isConnectable }: NodeProps<DecisionReactFlowNode>) {
  return (
    <div aria-description={data.accessibleDescription} aria-label={data.controlLabel} className="relative" role="img">
      <Handle isConnectable={isConnectable} position={Position.Left} style={{ opacity: 0 }} type="target" />
      <svg aria-hidden="true" className="block" height={48} width={48}>
        <polygon
          className={cn(
            "fill-background stroke-2",
            data.active ? "stroke-primary" : "stroke-muted-foreground/50",
            !data.active && "opacity-60",
          )}
          points="24,2 46,24 24,46 2,24"
        />
      </svg>
      {data.ports.map((port) => (
        <Handle
          id={port}
          isConnectable={isConnectable}
          key={port}
          position={Position.Right}
          style={{ opacity: 0 }}
          type="source"
        />
      ))}
    </div>
  );
}
