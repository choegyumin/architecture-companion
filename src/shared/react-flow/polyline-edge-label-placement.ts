type Point = Readonly<{ x: number; y: number }>;

export function polylineArcLength(points: readonly Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points.at(index - 1);
    const end = points.at(index);
    if (!start || !end) continue;
    length += Math.hypot(end.x - start.x, end.y - start.y);
  }
  return length;
}

// Point at a given arc length along the polyline, walking from either end.
// Distances past the far end clamp to its endpoint.
export function pointAlongPolyline(points: readonly Point[], distance: number, from: "start" | "end"): Point {
  if (points.length < 2) {
    const point = points.at(0);
    if (!point) throw new Error("Sampling a polyline requires at least one point.");
    return point;
  }
  const chain = from === "start" ? points : [...points].reverse();
  let remaining = Math.max(distance, 0);
  for (let index = 1; index < chain.length; index += 1) {
    const start = chain.at(index - 1)!;
    const end = chain.at(index)!;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (remaining <= length) {
      const traveled = length === 0 ? 0 : remaining / length;
      return { x: start.x + (end.x - start.x) * traveled, y: start.y + (end.y - start.y) * traveled };
    }
    remaining -= length;
  }
  return chain.at(-1)!;
}

export function getPolylineEdgeLabelPlacement(points: readonly Point[]): Point {
  let longest: { start: Point; end: Point; length: number } | null = null;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (!start || !end) continue;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (longest === null || length > longest.length) longest = { start, end, length };
  }
  if (!longest) throw new Error("A polyline edge label requires at least two points.");

  return {
    x: (longest.start.x + longest.end.x) / 2,
    y: (longest.start.y + longest.end.y) / 2,
  };
}
