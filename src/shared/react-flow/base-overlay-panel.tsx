import { Panel, useReactFlow, useStore } from "@xyflow/react";
import type { ReactNode } from "react";

type Point = Readonly<{ x: number; y: number }>;
type Size = Readonly<{ height: number; width: number }>;

export type BaseOverlayPanelRenderProps = Readonly<{
  bounds: Size;
  canvasToScreenPoint: (point: Point) => Point;
  screenToCanvasPoint: (point: Point) => Point;
}>;

type BaseOverlayPanelProps = Readonly<{
  children: (props: BaseOverlayPanelRenderProps) => ReactNode;
}>;

export function BaseOverlayPanel({ children }: BaseOverlayPanelProps) {
  const height = useStore((state) => state.height);
  const transform = useStore((state) => state.transform);
  const width = useStore((state) => state.width);
  const { screenToFlowPosition } = useReactFlow();
  const [translateX, translateY, zoom] = transform;

  return (
    <Panel className="nodrag nopan nowheel pointer-events-none m-0! size-full overflow-hidden" position="top-left">
      {children({
        bounds: { height, width },
        canvasToScreenPoint: ({ x, y }) => ({
          x: x * zoom + translateX,
          y: y * zoom + translateY,
        }),
        screenToCanvasPoint: screenToFlowPosition,
      })}
    </Panel>
  );
}
