import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, type XYPosition } from "@xyflow/react";
import type { MouseEvent, ReactNode } from "react";

import { BaseEdgeLabel, EDGE_LABEL_Z_INDEX } from "@/shared/react-flow/base-edge-label";
import { getPolylineEdgeLabelPlacement } from "@/shared/react-flow/polyline-edge-label-placement";

type LinkActivationHandler = (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
type LabelActivationHandler = (event: MouseEvent<HTMLButtonElement>) => void;

type PolylineEdgeData = Readonly<{
  points: readonly XYPosition[];
  cornerRadius?: number;
  eyebrow?: ReactNode;
  href?: string;
  labelAriaLabel?: string;
  onLabelActivate?: LabelActivationHandler;
  onLinkActivate?: LinkActivationHandler;
}>;

export type PolylineReactFlowEdge = Edge<PolylineEdgeData, "polyline">;

function moveToward(start: XYPosition, end: XYPosition, distance: number): XYPosition {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length === 0) return start;
  const ratio = distance / length;
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  };
}

function toPath(points: readonly XYPosition[], cornerRadius = 0): string {
  const first = points.at(0);
  if (!first) return "";
  if (cornerRadius <= 0 || points.length < 3) {
    return points.map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
  }

  const commands = [`M ${first.x} ${first.y}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points.at(index + 1);
    if (!previous || !corner || !next) continue;
    const radius = Math.min(
      cornerRadius,
      Math.hypot(corner.x - previous.x, corner.y - previous.y) / 2,
      Math.hypot(next.x - corner.x, next.y - corner.y) / 2,
    );
    const entry = moveToward(corner, previous, radius);
    const exit = moveToward(corner, next, radius);
    commands.push(`L ${entry.x} ${entry.y}`, `Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`);
  }
  const last = points.at(-1);
  if (last) commands.push(`L ${last.x} ${last.y}`);
  return commands.join(" ");
}

export function PolylineEdge({ id, data, label, markerEnd, markerStart, style }: EdgeProps<PolylineReactFlowEdge>) {
  if (!data) return null;
  const first = data.points.at(0);
  const last = data.points.at(-1);
  if (!first || !last) return null;
  const labelPoint = getPolylineEdgeLabelPlacement(data.points);
  const hasInteractiveLabel = data.onLabelActivate && label != null && data.eyebrow == null && !data.href;

  return (
    <>
      <BaseEdge
        id={id}
        markerEnd={markerEnd}
        markerStart={markerStart}
        path={toPath(data.points, data.cornerRadius)}
        style={style}
      />
      {data.eyebrow != null || label != null || data.href ? (
        <EdgeLabelRenderer>
          <div
            className={`nodrag nopan absolute w-max rounded-md border bg-background text-center text-xs shadow-sm ${
              hasInteractiveLabel ? "p-0" : "px-2 py-1"
            }`}
            style={{
              left: labelPoint.x,
              pointerEvents: "all",
              top: labelPoint.y,
              transform: "translate(-50%, -50%)",
              zIndex: EDGE_LABEL_Z_INDEX,
            }}
          >
            {data.eyebrow != null ? (
              <p className="text-[10px] font-semibold tracking-wide text-muted-foreground">{data.eyebrow}</p>
            ) : null}
            {hasInteractiveLabel ? (
              <button
                aria-label={data.labelAriaLabel}
                className="cursor-pointer rounded-md px-2 py-1 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={data.onLabelActivate}
                type="button"
              >
                {label}
              </button>
            ) : (
              <BaseEdgeLabel href={data.href} onActivate={data.onLinkActivate} text={label} />
            )}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
