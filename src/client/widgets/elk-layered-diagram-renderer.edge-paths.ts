import type { DiagramLayoutPoint } from "@/features/diagram/diagram-spatial";

export function toPolylinePath(points: readonly DiagramLayoutPoint[]): string {
  return points.map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
}

// Converts a routed polyline into a Catmull-Rom spline drawn as SVG cubic
// bezier segments: the curve passes through every point while the segment
// tangents stay continuous, which smooths layered elbow routes into arcs.
export function toSplinePath(points: readonly DiagramLayoutPoint[]): string {
  const start = points.at(0);
  const second = points.at(1);
  if (!start || !second) throw new Error("A spline edge path requires at least two points.");
  if (points.length === 2) return `M ${start.x} ${start.y} L ${second.x} ${second.y}`;

  let path = `M ${start.x} ${start.y}`;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const previous = points.at(Math.max(index - 1, 0));
    const current = points.at(index);
    const next = points.at(index + 1);
    const after = points.at(index + 2) ?? points.at(index + 1);
    if (!previous || !current || !next || !after) continue;

    const firstControl = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6,
    };
    const secondControl = {
      x: next.x - (after.x - current.x) / 6,
      y: next.y - (after.y - current.y) / 6,
    };
    path += ` C ${firstControl.x.toFixed(1)} ${firstControl.y.toFixed(1)} ${secondControl.x.toFixed(1)} ${secondControl.y.toFixed(1)} ${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
  }
  return path;
}

// Draws a border-to-border segment as a natural cubic bezier: handles stick to
// the segment's dominant axis, so edges leave and enter cards along the flow
// direction and sway smoothly instead of following the routed polyline. Edges
// that kept more points (unresolvable, message) fall back to spline smoothing.
export function toBezierPath(points: readonly DiagramLayoutPoint[]): string {
  const start = points.at(0);
  const end = points.at(1);
  if (!start || !end) throw new Error("A bezier edge path requires at least two points.");
  if (points.length > 2) return toSplinePath(points);

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const sign = horizontal ? Math.sign(dx) || 1 : Math.sign(dy) || 1;
  const handle = Math.min(96, Math.max(32, Math.hypot(dx, dy) * 0.45));
  const firstControl = horizontal
    ? { x: start.x + sign * handle, y: start.y }
    : { x: start.x, y: start.y + sign * handle };
  const secondControl = horizontal ? { x: end.x - sign * handle, y: end.y } : { x: end.x, y: end.y - sign * handle };
  return `M ${start.x} ${start.y} C ${firstControl.x.toFixed(1)} ${firstControl.y.toFixed(1)} ${secondControl.x.toFixed(1)} ${secondControl.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}
