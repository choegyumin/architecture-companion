import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, type XYPosition } from "@xyflow/react";
import type { MouseEvent, ReactNode } from "react";

import { BaseEdgeLabel, EDGE_LABEL_Z_INDEX } from "@/shared/react-flow/base-edge-label";
import { getPolylineEdgeLabelPlacement } from "@/shared/react-flow/polyline-edge-label-placement";

type LinkActivationHandler = (event: MouseEvent<HTMLAnchorElement>, href: string) => void;

type PolylineEdgeData = Readonly<{
  points: readonly XYPosition[];
  eyebrow?: ReactNode;
  href?: string;
  onLinkActivate?: LinkActivationHandler;
}>;

export type PolylineReactFlowEdge = Edge<PolylineEdgeData, "polyline">;

function toPath(points: readonly XYPosition[]): string {
  return points.map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
}

export function PolylineEdge({ id, data, label, markerEnd, markerStart, style }: EdgeProps<PolylineReactFlowEdge>) {
  if (!data) return null;
  const first = data.points.at(0);
  const last = data.points.at(-1);
  if (!first || !last) return null;
  const labelPoint = getPolylineEdgeLabelPlacement(data.points);

  return (
    <>
      <BaseEdge id={id} markerEnd={markerEnd} markerStart={markerStart} path={toPath(data.points)} style={style} />
      {data.eyebrow != null || label != null || data.href ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute w-max rounded-md border bg-background px-2 py-1 text-center text-xs shadow-sm"
            style={{
              left: labelPoint.x,
              pointerEvents: "all",
              top: labelPoint.y,
              transform: "translate(-50%, -50%)",
              zIndex: EDGE_LABEL_Z_INDEX,
            }}
          >
            {data.eyebrow != null ? (
              <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{data.eyebrow}</p>
            ) : null}
            <BaseEdgeLabel href={data.href} onActivate={data.onLinkActivate} text={label} />
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
