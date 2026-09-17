import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";
import type { MouseEvent } from "react";

import { BaseEdgeLabel, EDGE_LABEL_Z_INDEX } from "@/shared/react-flow/base-edge-label";
import { getMessageEdgeLabelPlacement } from "@/shared/react-flow/message-edge-label-placement";

type Point = Readonly<{ x: number; y: number }>;
type LinkActivationHandler = (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
type MessageEdgeData = Readonly<{
  edge: Readonly<{
    source: string;
    target: string;
    kind?: string;
    label?: string;
    href?: string;
    messageType: "sync" | "async" | "return";
  }>;
  points: readonly Point[];
  onLinkActivate?: LinkActivationHandler;
}>;

export type MessageReactFlowEdge = import("@xyflow/react").Edge<MessageEdgeData, "message">;

function toPath(points: readonly Point[]): string {
  return points.map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
}

export function MessageEdge({ id, data, markerEnd, style }: EdgeProps<MessageReactFlowEdge>) {
  if (!data) return null;
  const first = data.points.at(0);
  const last = data.points.at(-1);
  if (!first || !last) return null;
  const labelPlacement = getMessageEdgeLabelPlacement(data.points, data.edge.source === data.edge.target);

  return (
    <>
      <BaseEdge id={id} markerEnd={markerEnd} path={toPath(data.points)} style={style} />
      {data.edge.label || data.edge.href ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute w-max rounded-md bg-background px-2 py-1 text-xs"
            style={{
              left: labelPlacement.x,
              pointerEvents: "all",
              top: labelPlacement.y,
              zIndex: EDGE_LABEL_Z_INDEX,
              transform: labelPlacement.transform,
            }}
          >
            <BaseEdgeLabel href={data.edge.href} onActivate={data.onLinkActivate} text={data.edge.label} />
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
