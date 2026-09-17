import { type MouseEvent, type PointerEvent, useRef, useState } from "react";

type Point = Readonly<{ x: number; y: number }>;

type DragState = Readonly<{
  moved: boolean;
  point: Point;
  pointerId: number;
  start: Point;
  annotationId: string;
}>;

type UseAnnotationPinDragOptions = Readonly<{
  disabled: boolean;
  move: (annotationId: string, point: Point) => Promise<void>;
  open: (annotationId: string) => void;
  screenToCanvasPoint: (point: Point) => Point;
}>;

export function useAnnotationPinDrag({ disabled, move, open, screenToCanvasPoint }: UseAnnotationPinDragOptions) {
  const [drag, setDrag] = useState<DragState>();
  const draggedAnnotation = useRef<string | undefined>(undefined);

  function startDrag(event: PointerEvent<HTMLButtonElement>, annotationId: string, point: Point): void {
    if (event.button !== 0 || disabled) return;

    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({
      moved: false,
      point,
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      annotationId,
    });
  }

  function continueDrag(event: PointerEvent<HTMLButtonElement>, annotationId: string): void {
    if (!drag || drag.annotationId !== annotationId || drag.pointerId !== event.pointerId) return;

    const moved = drag.moved || Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) >= 4;
    if (!moved) return;

    event.preventDefault();
    setDrag({
      ...drag,
      moved: true,
      point: screenToCanvasPoint({ x: event.clientX, y: event.clientY }),
    });
  }

  function finishDrag(event: PointerEvent<HTMLButtonElement>, annotationId: string): void {
    if (!drag || drag.annotationId !== annotationId || drag.pointerId !== event.pointerId) return;

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!drag.moved) {
      setDrag(undefined);
      return;
    }

    draggedAnnotation.current = annotationId;
    globalThis.setTimeout(() => {
      if (draggedAnnotation.current === annotationId) draggedAnnotation.current = undefined;
    }, 0);
    void move(annotationId, drag.point).finally(() => {
      setDrag((current) => (current?.annotationId === annotationId ? undefined : current));
    });
  }

  function cancelDrag(event: PointerEvent<HTMLButtonElement>, annotationId: string): void {
    if (drag?.annotationId !== annotationId || drag.pointerId !== event.pointerId) return;
    setDrag(undefined);
  }

  function openAnnotation(event: MouseEvent<HTMLButtonElement>, annotationId: string): void {
    event.stopPropagation();
    if (draggedAnnotation.current === annotationId) {
      draggedAnnotation.current = undefined;
      return;
    }

    open(annotationId);
  }

  return { cancelDrag, continueDrag, drag, finishDrag, openAnnotation, startDrag };
}
