/** What the pointer currently hovers: a route edge, one of its labels, or a node. */
export type EdgeHoverOrigin =
  | Readonly<{ kind: "edge"; edgeId: string }>
  | Readonly<{ kind: "label"; edgeId: string }>
  | Readonly<{ kind: "node"; nodeId: string }>;

const NO_EDGES: ReadonlySet<string> = new Set();

/** Default highlight: the hovered route itself; node hovers light nothing. */
export function defaultEdgeHoverHighlight(origin: EdgeHoverOrigin): ReadonlySet<string> {
  return origin.kind === "node" ? NO_EDGES : new Set([origin.edgeId]);
}

export const EDGE_HOVER_CLASS = "is-edge-hovered";

type EdgeHoverListener = (origin: EdgeHoverOrigin | null) => void;

let current: EdgeHoverOrigin | null = null;
const listeners = new Set<EdgeHoverListener>();

const sameOrigin = (a: EdgeHoverOrigin, b: EdgeHoverOrigin): boolean => {
  if (a.kind === "node" && b.kind === "node") return a.nodeId === b.nodeId;
  if (a.kind !== "node" && b.kind !== "node") return a.edgeId === b.edgeId;
  return false;
};

const notify = (): void => {
  for (const listen of listeners) listen(current);
};

/**
 * Hover reports travel through a module-level channel instead of React
 * context: labels are built by diagram renderers, which run above the canvas
 * and cannot see a provider mounted inside it. Any mounted canvas subscribes
 * and decides which edges the origin lights.
 */
export function reportEdgeHover(origin: EdgeHoverOrigin): void {
  current = origin;
  notify();
}

/** Clears the origin only when it still is `origin` — a later hover wins. */
export function clearEdgeHover(origin: EdgeHoverOrigin): void {
  if (current == null || !sameOrigin(current, origin)) return;
  current = null;
  notify();
}

/** Drops whatever origin is held (canvas unmount), without notifying. */
export function resetEdgeHover(): void {
  current = null;
}

export function subscribeEdgeHover(listener: EdgeHoverListener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
