import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";

import { cn } from "@/shared/react/class-name";

type DiamondNodeData = Readonly<{
  label?: string;
  accessibleLabel?: string;
  ports?: readonly string[];
  active?: boolean;
  accessibleDescription?: string;
}>;

export type DiamondReactFlowNode = Node<DiamondNodeData, "diamond">;

export function DiamondNode({ data, isConnectable }: NodeProps<DiamondReactFlowNode>) {
  const labeled = data.label != null;
  const active = data.active ?? labeled;
  return (
    <div
      aria-description={data.accessibleDescription}
      aria-label={data.accessibleLabel ?? data.label}
      className={cn("relative", labeled && "grid size-full min-h-28 min-w-40 place-items-center px-10 py-6")}
      role="img"
    >
      <Handle isConnectable={isConnectable} position={Position.Left} style={{ opacity: 0 }} type="target" />
      <svg
        aria-hidden="true"
        className={labeled ? "absolute inset-0 size-full" : "block"}
        height={48}
        preserveAspectRatio="none"
        viewBox="0 0 48 48"
        width={48}
      >
        <polygon
          className={cn(
            "fill-background stroke-2",
            active ? "stroke-diagram-edge" : "stroke-muted-foreground/50",
            !active && "opacity-50",
          )}
          points="24,2 46,24 24,46 2,24"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {labeled ? <span className="relative text-center text-xs wrap-break-word">{data.label}</span> : null}
      {data.ports ? (
        data.ports.map((port) => (
          <Handle
            id={port}
            isConnectable={isConnectable}
            key={port}
            position={Position.Right}
            style={{ opacity: 0 }}
            type="source"
          />
        ))
      ) : (
        <Handle isConnectable={isConnectable} position={Position.Right} style={{ opacity: 0 }} type="source" />
      )}
    </div>
  );
}
