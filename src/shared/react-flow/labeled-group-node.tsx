import { type Node, type NodeProps } from "@xyflow/react";
import type { ReactNode } from "react";

type LabeledGroupNodeData = Readonly<{
  label: ReactNode;
  description?: ReactNode;
}>;

export type LabeledGroupReactFlowNode = Node<LabeledGroupNodeData, "labeled-group">;

export function LabeledGroupNode({ data }: NodeProps<LabeledGroupReactFlowNode>) {
  return (
    <article
      aria-label={typeof data.label === "string" ? `Group: ${data.label}` : "Group"}
      className="size-full rounded-xl border bg-muted/30 shadow-sm"
    >
      <header className="p-4">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Group</p>
        <h3 className="mt-1 font-heading text-sm font-semibold">{data.label}</h3>
        {data.description != null ? <p className="mt-1 text-xs text-muted-foreground">{data.description}</p> : null}
      </header>
    </article>
  );
}
