type Point = Readonly<{ x: number; y: number }>;

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
