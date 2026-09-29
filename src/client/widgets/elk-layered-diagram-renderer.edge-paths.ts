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
