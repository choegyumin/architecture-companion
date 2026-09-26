type Point = Readonly<{ x: number; y: number }>;
type Bounds = Readonly<{ position: Point; size: Readonly<{ width: number; height: number }> }>;
type Segment = readonly [number, number, number, number];

export function pathEndpoints(path: string): Readonly<{ start: Point; end: Point }> {
  const commands = [...path.matchAll(/([MLQ]) ([-\d.]+) ([-\d.]+)(?: ([-\d.]+) ([-\d.]+))?/g)];
  const first = commands.at(0);
  const last = commands.at(-1);
  if (first?.at(1) !== "M" || !last) throw new Error(`Invalid aggregate path: ${path}`);
  return {
    start: { x: Number(first.at(2)), y: Number(first.at(3)) },
    end: { x: Number(last.at(last.at(1) === "Q" ? 4 : 2)), y: Number(last.at(last.at(1) === "Q" ? 5 : 3)) },
  };
}

export function onBoundary(point: Point, bounds: Bounds): boolean {
  const { x, y } = bounds.position;
  const right = x + bounds.size.width;
  const bottom = y + bounds.size.height;
  const close = (first: number, second: number) => Math.abs(first - second) < 0.01;
  return (
    ((close(point.x, x) || close(point.x, right)) && point.y >= y && point.y <= bottom) ||
    ((close(point.y, y) || close(point.y, bottom)) && point.x >= x && point.x <= right)
  );
}

function renderedSegments(path: string): Segment[] {
  const segments: Segment[] = [];
  let previous: readonly [number, number] | undefined;
  for (const [, command, x, y, endX, endY] of path.matchAll(/([MLQ]) ([-\d.]+) ([-\d.]+)(?: ([-\d.]+) ([-\d.]+))?/g)) {
    const point = [Number(x), Number(y)] as const;
    if (command === "L" && previous) segments.push([...previous, ...point]);
    if (command === "Q" && previous) {
      const [fromX, fromY] = previous;
      let prior = previous;
      for (let step = 1; step <= 20; step += 1) {
        const t = step / 20;
        const next = [
          (1 - t) ** 2 * fromX + 2 * (1 - t) * t * Number(x) + t ** 2 * Number(endX),
          (1 - t) ** 2 * fromY + 2 * (1 - t) * t * Number(y) + t ** 2 * Number(endY),
        ] as const;
        segments.push([...prior, ...next]);
        prior = next;
      }
    }
    previous = command === "Q" ? [Number(endX), Number(endY)] : point;
  }
  return segments;
}

export function pathsCross(first: string, second: string): boolean {
  for (const [ax, ay, bx, by] of renderedSegments(first)) {
    for (const [cx, cy, dx, dy] of renderedSegments(second)) {
      const vx = bx - ax;
      const vy = by - ay;
      const wx = dx - cx;
      const wy = dy - cy;
      const denominator = vx * wy - vy * wx;
      if (Math.abs(denominator) < 0.000001) continue;
      const t = ((cx - ax) * wy - (cy - ay) * wx) / denominator;
      const u = ((cx - ax) * vy - (cy - ay) * vx) / denominator;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
    }
  }
  return false;
}

export function pathsOverlap(first: string, second: string): boolean {
  const prior = renderedSegments(second);
  let overlap = 0;
  for (const [ax, ay, bx, by] of renderedSegments(first)) {
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (length < 0.001) continue;
    const ux = dx / length;
    const uy = dy / length;
    let adjacent = 0;
    for (const [cx, cy, ex, ey] of prior) {
      const otherLength = Math.hypot(ex - cx, ey - cy);
      if (otherLength < 0.001 || Math.abs((ux * (ey - cy) - uy * (ex - cx)) / otherLength) > 0.08) continue;
      if (Math.abs(ux * (cy - ay) - uy * (cx - ax)) > 2.1) continue;
      if (Math.abs(ux * (ey - ay) - uy * (ex - ax)) > 2.1) continue;
      const start = ux * (cx - ax) + uy * (cy - ay);
      const end = ux * (ex - ax) + uy * (ey - ay);
      adjacent = Math.max(
        adjacent,
        Math.max(0, Math.min(length, Math.max(start, end)) - Math.max(0, Math.min(start, end))),
      );
    }
    overlap += adjacent;
    if (overlap > 4) return true;
  }
  return false;
}

export function pathEntersBounds(path: string, bounds: Bounds): boolean {
  const { x, y } = bounds.position;
  const axes = [
    { from: x + 0.01, to: x + bounds.size.width - 0.01, offset: 0 },
    { from: y + 0.01, to: y + bounds.size.height - 0.01, offset: 1 },
  ];
  return renderedSegments(path).some(([ax, ay, bx, by]) => {
    const start = [ax, ay];
    const end = [bx, by];
    let lower = 0;
    let upper = 1;
    for (const { from, to, offset } of axes) {
      const value = start[offset]!;
      const change = end[offset]! - value;
      if (Math.abs(change) < 1e-9) {
        if (value <= from || value >= to) return false;
        continue;
      }
      lower = Math.max(lower, Math.min((from - value) / change, (to - value) / change));
      upper = Math.min(upper, Math.max((from - value) / change, (to - value) / change));
    }
    return lower < upper && upper > 0 && lower < 1;
  });
}
