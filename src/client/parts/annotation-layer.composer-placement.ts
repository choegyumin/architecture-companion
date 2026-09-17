export type AnnotationComposerPlacement = "bottom-left" | "bottom-right" | "top-left" | "top-right";

type Point = Readonly<{ x: number; y: number }>;
type Size = Readonly<{ height: number; width: number }>;

const COMPOSER_GAP = 18;
const COMPOSER_INSET = 8;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function getAnnotationComposerPlacement(point: Point, bounds: Size): AnnotationComposerPlacement {
  const horizontal = point.x <= bounds.width / 2 ? "right" : "left";
  const vertical = point.y <= bounds.height / 2 ? "bottom" : "top";

  return `${vertical}-${horizontal}`;
}

export function getAnnotationComposerPoint(
  point: Point,
  placement: AnnotationComposerPlacement,
  size: Size,
  bounds: Size,
): Point {
  const preferred = {
    x: placement.endsWith("right") ? point.x + COMPOSER_GAP : point.x - COMPOSER_GAP - size.width,
    y: placement.startsWith("bottom") ? point.y + COMPOSER_GAP : point.y - COMPOSER_GAP - size.height,
  };

  return {
    x: clamp(preferred.x, COMPOSER_INSET, bounds.width - size.width - COMPOSER_INSET),
    y: clamp(preferred.y, COMPOSER_INSET, bounds.height - size.height - COMPOSER_INSET),
  };
}
