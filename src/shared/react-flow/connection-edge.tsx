import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, type XYPosition } from "@xyflow/react";
import type { MouseEvent, ReactNode } from "react";

import { cn } from "@/shared/react/class-name";
import { BaseEdgeLabel, EDGE_LABEL_Z_INDEX } from "@/shared/react-flow/base-edge-label";

type LinkActivationHandler = (event: MouseEvent<HTMLAnchorElement>, href: string) => void;

type ConnectionEdgeLabelAnchor = Readonly<{
  /** Which edge of the label meets the anchor; labels grow away from it. */
  anchorSide?: "top" | "bottom";
  control: ReactNode;
  position: XYPosition;
}>;

// The anchor pins the label's top edge (growing downstream), its bottom edge
// (growing back toward the start), or its center.
const ANCHOR_TRANSFORM = {
  bottom: "translate(-50%, -100%)",
  center: "translate(-50%, -50%)",
  top: "translate(-50%, 0)",
} as const;

type ConnectionEdgeData = Readonly<{
  path: string;
  labelPosition: XYPosition;
  labelTransform?: string;
  labelClassName?: string;
  eyebrow?: ReactNode;
  href?: string;
  onLinkActivate?: LinkActivationHandler;
  labelAction?: Readonly<{ ariaLabel: string; onActivate: () => void }>;
  labelControls?: readonly ConnectionEdgeLabelAnchor[];
}>;

export type ConnectionReactFlowEdge = Edge<ConnectionEdgeData, "connection">;

export function ConnectionEdge({ id, data, label, markerEnd, markerStart, style }: EdgeProps<ConnectionReactFlowEdge>) {
  if (!data?.path) return null;

  const labelStyle = {
    left: data.labelPosition.x,
    opacity: style?.opacity,
    pointerEvents: "all" as const,
    top: data.labelPosition.y,
    transform: data.labelTransform ?? "translate(-50%, -50%)",
    zIndex: EDGE_LABEL_Z_INDEX,
  };
  const eyebrow =
    data.eyebrow != null ? (
      <span className="block text-[10px] font-semibold tracking-wide text-muted-foreground">{data.eyebrow}</span>
    ) : null;

  const labelControls = data.labelControls ?? [];
  const anchoredControls = labelControls.map(({ anchorSide, control, position }) => (
    <div
      className="nodrag nopan absolute flex w-max flex-col gap-2"
      key={`${position.x},${position.y}`}
      style={{
        ...labelStyle,
        left: position.x,
        opacity: 1,
        top: position.y,
        transform: ANCHOR_TRANSFORM[anchorSide ?? "center"],
      }}
    >
      {control}
    </div>
  ));

  return (
    <>
      <BaseEdge id={id} markerEnd={markerEnd} markerStart={markerStart} path={data.path} style={style} />
      {data.eyebrow != null || label != null || data.href || anchoredControls.length > 0 ? (
        <EdgeLabelRenderer>
          {anchoredControls.length > 0 ? (
            anchoredControls
          ) : data.labelAction ? (
            <BaseEdgeLabel
              ariaLabel={data.labelAction.ariaLabel}
              className={cn("absolute w-max text-center", data.labelClassName)}
              onSelect={data.labelAction.onActivate}
              style={labelStyle}
              text={
                <>
                  {eyebrow}
                  {label}
                </>
              }
            />
          ) : (
            <div
              className={cn(
                "nodrag nopan absolute w-max rounded-md border bg-background px-2 py-1 text-center text-xs shadow-sm",
                data.labelClassName,
              )}
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
