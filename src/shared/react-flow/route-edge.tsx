import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, type XYPosition } from "@xyflow/react";
import type { MouseEvent, ReactNode } from "react";

import { BaseEdgeLabel, EDGE_LABEL_Z_INDEX } from "@/shared/react-flow/base-edge-label";

type LinkActivationHandler = (event: MouseEvent<HTMLAnchorElement>, href: string) => void;

type RouteEdgeData = Readonly<{
  path: string;
  labelPosition: XYPosition;
  eyebrow?: ReactNode;
  href?: string;
  onLinkActivate?: LinkActivationHandler;
  labelAction?: Readonly<{ ariaLabel: string; onActivate: () => void }>;
}>;

export type RouteReactFlowEdge = Edge<RouteEdgeData, "route">;

export function RouteEdge({ id, data, label, markerEnd, markerStart, style }: EdgeProps<RouteReactFlowEdge>) {
  if (!data?.path) return null;

  const labelStyle = {
    left: data.labelPosition.x,
    pointerEvents: "all" as const,
    top: data.labelPosition.y,
    transform: "translate(-50%, -50%)",
    zIndex: EDGE_LABEL_Z_INDEX,
  };
  const eyebrow =
    data.eyebrow != null ? (
      <span className="block text-[10px] font-semibold tracking-wide text-muted-foreground">{data.eyebrow}</span>
    ) : null;

  return (
    <>
      <BaseEdge id={id} markerEnd={markerEnd} markerStart={markerStart} path={data.path} style={style} />
      {data.eyebrow != null || label != null || data.href ? (
        <EdgeLabelRenderer>
          {data.labelAction ? (
            <button
              aria-label={data.labelAction.ariaLabel}
              className="nodrag nopan absolute w-max cursor-pointer rounded-md border bg-background px-2 py-1 text-center text-xs shadow-sm hover:border-primary/60"
              onClick={(event) => {
                event.stopPropagation();
                data.labelAction?.onActivate();
              }}
              style={labelStyle}
              type="button"
            >
              {eyebrow}
            </button>
          ) : (
            <div
              className="nodrag nopan absolute w-max rounded-md border bg-background px-2 py-1 text-center text-xs shadow-sm"
              style={labelStyle}
            >
              {eyebrow}
              <BaseEdgeLabel href={data.href} onActivate={data.onLinkActivate} text={label} />
            </div>
          )}
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
