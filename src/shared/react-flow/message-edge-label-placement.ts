const LABEL_GAP = 12;

type Point = Readonly<{ x: number; y: number }>;
type MessageEdgeLabelPlacement = Readonly<{
  x: number;
  y: number;
  transform: string;
}>;

export function getMessageEdgeLabelPlacement(
  points: readonly Point[],
  isSelfMessage: boolean,
): MessageEdgeLabelPlacement {
  const segments = points.slice(1).map((end, index) => {
    const start = points[index] ?? end;
    return {
      start,
      end,
      length: Math.hypot(end.x - start.x, end.y - start.y),
    };
  });
  const firstSegment = segments.at(0);
  if (!firstSegment) throw new Error("A message edge label requires at least two points.");
  if (isSelfMessage) {
    return {
      x: firstSegment.end.x,
      y: firstSegment.end.y - LABEL_GAP,
      transform: "translate(-50%, -100%)",
    };
  }
  const segment = segments
    .slice(1)
    .reduce((longest, candidate) => (candidate.length > longest.length ? candidate : longest), firstSegment);
  const x = (segment.start.x + segment.end.x) / 2;
  const y = (segment.start.y + segment.end.y) / 2;
  const isHorizontal = Math.abs(segment.end.x - segment.start.x) >= Math.abs(segment.end.y - segment.start.y);

  return isHorizontal
    ? { x, y: y - LABEL_GAP, transform: "translate(-50%, -100%)" }
    : { x: x + LABEL_GAP, y, transform: "translate(0, -50%)" };
}
