import { platform } from "@base-ui/utils/platform";
import { type ReactNode, useEffectEvent, useLayoutEffect, useRef } from "react";

import type { AnnotationAnchor, AnnotationTarget } from "@/features/annotation/annotation-document";
import { FIELD_SELECTORS } from "@/shared/universal/element-selectors";

import type { AnnotationCanvasController } from "./annotation-layer";

type Point = AnnotationAnchor["point"];
type Gesture = {
  start: Point;
  target?: AnnotationTarget;
  cancelled: boolean;
};

type AnnotationInteractionBoundaryProps = Readonly<{
  ariaLabel: string;
  children: ReactNode;
  controller: AnnotationCanvasController;
  enabled: boolean;
  resolveTarget: (element: Element) => AnnotationTarget | undefined;
  screenToCanvasPoint: (point: Point) => Point;
}>;

// Hit testing has already chosen the underlying control when capture runs.
// Keeping native hover means the idle overlay cannot take that hit instead.
function suppressDiagramInput(event: Event): void {
  event.preventDefault();
  // oxlint-disable-next-line repo/no-restricted-syntax -- Native hit testing has already targeted the underlying Diagram while the overlay passes hover through. That dispatch cannot be retargeted; subscriber filters cannot prevent third-party controls, portals, and native defaults from starting an action. The Comment boundary consumes it before activating pointer capture.
  event.stopPropagation();
}

export function AnnotationInteractionBoundary({
  ariaLabel,
  children,
  controller,
  enabled,
  resolveTarget,
  screenToCanvasPoint,
}: AnnotationInteractionBoundaryProps) {
  const surface = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const getTarget = useEffectEvent(resolveTarget);
  const isEnabled = useEffectEvent(() => enabled);
  const begin = useEffectEvent((point: Point, target?: AnnotationTarget) => {
    if (!controller.isCommentMode) return;
    controller.begin({
      ...controller.surface,
      point: screenToCanvasPoint(point),
      ...(target ? { target } : {}),
    });
  });

  useLayoutEffect(() => {
    if (!surface.current || !overlay.current) return;
    const root = surface.current;
    const layer = overlay.current;

    const gestures = new Map<number, Gesture>();

    function ownerOf(element: Element): Element | undefined {
      if (root.contains(element)) return element;
      // Base UI popups live outside the Diagram DOM. Resolve them through
      // their trigger rather than treating every portal in the app as ours.
      for (const trigger of root.querySelectorAll("[aria-controls], [aria-owns]")) {
        const ids = `${trigger.getAttribute("aria-controls") ?? ""} ${trigger.getAttribute("aria-owns") ?? ""}`;
        if (ids.split(/\s+/).some((id) => id && document.getElementById(id)?.contains(element))) return trigger;
      }
      return undefined;
    }

    function finish(pointerId: number): void {
      gestures.delete(pointerId);
      if (gestures.size === 0) layer.style.pointerEvents = "none";
    }

    function cancel(): void {
      for (const pointerId of gestures.keys()) {
        if (layer.hasPointerCapture(pointerId)) layer.releasePointerCapture(pointerId);
      }
      gestures.clear();
      layer.style.pointerEvents = "none";
    }

    function capture(event: Event): void {
      // Finish a captured gesture even if Alt is released before pointerup.
      // Releasing early would send the remaining gesture back to the control.
      if (!isEnabled() && gestures.size === 0) return;
      const element = event.target instanceof Element ? event.target : undefined;
      if (!element) return;
      const owner = ownerOf(element);
      const commentUI = element.closest("[data-comment-ui]");

      if (event instanceof KeyboardEvent) {
        // Document shortcuts belong to the Diagram even when focus is in
        // the workspace or the composer. Leave Annotation editing intact.
        const searchModifier = platform.os.mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
        const searchShortcut = searchModifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k";
        const walkthroughShortcut =
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
          !element.closest(FIELD_SELECTORS) &&
          !commentUI;
        if (searchShortcut || walkthroughShortcut) event.preventDefault();
        if (!owner || commentUI || event.key === "Tab" || ["Alt", "Control", "Meta", "Shift"].includes(event.key))
          return;
        suppressDiagramInput(event);
        return;
      }

      if (!owner || commentUI) return;
      suppressDiagramInput(event);

      if (event.type === "pointerdown" && event instanceof PointerEvent) {
        if (gestures.size > 0) {
          for (const gesture of gestures.values()) gesture.cancelled = true;
        }
        gestures.set(event.pointerId, {
          start: { x: event.clientX, y: event.clientY },
          target: getTarget(owner),
          cancelled: gestures.size > 0 || !event.isPrimary || event.button !== 0,
        });
        layer.style.pointerEvents = "auto";
        layer.setPointerCapture(event.pointerId);
      } else if (event.type === "pointermove" && event instanceof PointerEvent) {
        const gesture = gestures.get(event.pointerId);
        if (gesture && Math.hypot(event.clientX - gesture.start.x, event.clientY - gesture.start.y) >= 4) {
          gesture.cancelled = true;
        }
      } else if (event.type === "pointerup" && event instanceof PointerEvent) {
        const gesture = gestures.get(event.pointerId);
        finish(event.pointerId);
        if (
          gesture &&
          !gesture.cancelled &&
          Math.hypot(event.clientX - gesture.start.x, event.clientY - gesture.start.y) < 4
        ) {
          const bounds = root.getBoundingClientRect();
          if (
            event.clientX >= bounds.left &&
            event.clientX <= bounds.right &&
            event.clientY >= bounds.top &&
            event.clientY <= bounds.bottom
          ) {
            begin({ x: event.clientX, y: event.clientY }, gesture.target);
          }
        }
      } else if (
        (event.type === "pointercancel" || event.type === "lostpointercapture") &&
        event instanceof PointerEvent
      ) {
        finish(event.pointerId);
      } else if (event.type === "click" && event instanceof MouseEvent && event.detail === 0 && element !== layer) {
        // Keyboard/assistive activation has no pointerdown or screen point.
        const bounds = element.getBoundingClientRect();
        begin({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }, getTarget(owner));
      }
    }

    // Hover is never intercepted. Pointer movement is consumed only while
    // captured, so the existing Diagram hover handlers and CSS keep working.
    function move(event: PointerEvent): void {
      if (gestures.has(event.pointerId)) capture(event);
    }

    const events = [
      "pointerdown",
      "pointerup",
      "pointercancel",
      "lostpointercapture",
      "mousedown",
      "mouseup",
      "click",
      "dblclick",
      "auxclick",
      "contextmenu",
      "touchstart",
      "touchmove",
      "touchend",
      "wheel",
      "gesturestart",
      "gesturechange",
      "gestureend",
      "keydown",
      "keyup",
      "beforeinput",
      "paste",
      "cut",
      "submit",
      "dragstart",
    ];
    const options = { capture: true, passive: false };
    for (const type of events) window.addEventListener(type, capture, options);
    window.addEventListener("pointermove", move, options);
    window.addEventListener("blur", cancel);
    return () => {
      for (const type of events) window.removeEventListener(type, capture, options);
      window.removeEventListener("pointermove", move, options);
      window.removeEventListener("blur", cancel);
      cancel();
    };
  }, []);

  return (
    <div
      aria-label={ariaLabel}
      className="relative h-full min-h-0 overflow-hidden bg-background"
      ref={surface}
      role="region"
      style={{ touchAction: enabled ? "none" : undefined }}
    >
      {children}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-50 cursor-crosshair" ref={overlay} />
    </div>
  );
}
