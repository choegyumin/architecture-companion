/** What currently lights edges: a route edge, one of its labels, or a node. */
export type EdgeHighlightOrigin =
  | Readonly<{ kind: "edge"; edgeId: string }>
  | Readonly<{ kind: "label"; edgeId: string }>
  | Readonly<{ kind: "node"; nodeId: string }>;

const NO_EDGES: ReadonlySet<string> = new Set();

/** Default highlight: the origin's own route; node origins light nothing. */
export function defaultEdgeHighlight(origin: EdgeHighlightOrigin): ReadonlySet<string> {
  return origin.kind === "node" ? NO_EDGES : new Set([origin.edgeId]);
}

export const EDGE_HIGHLIGHT_CLASS = "is-highlighted";

type EdgeHighlightListener = (origin: EdgeHighlightOrigin | null) => void;

let current: EdgeHighlightOrigin | null = null;
const listeners = new Set<EdgeHighlightListener>();

const sameOrigin = (a: EdgeHighlightOrigin, b: EdgeHighlightOrigin): boolean => {
  if (a.kind === "node" && b.kind === "node") return a.nodeId === b.nodeId;
  if (a.kind !== "node" && b.kind !== "node") return a.edgeId === b.edgeId;
  return false;
};

const notify = (): void => {
  for (const listen of listeners) listen(current);
};

/**
 * Highlight reports travel through a module-level channel instead of React
 * context: labels are built by diagram renderers, which run above the canvas
 * and cannot see a provider mounted inside it. Any mounted canvas subscribes
 * and decides which edges the origin lights.
 */
export function reportEdgeHighlight(origin: EdgeHighlightOrigin): void {
  current = origin;
  notify();
}

/** Clears the origin only when it still is `origin` — a later highlight wins. */
export function clearEdgeHighlight(origin: EdgeHighlightOrigin): void {
  if (current == null || !sameOrigin(current, origin)) return;
  current = null;
  notify();
}

/** Drops whatever origin is held (canvas unmount), without notifying. */
export function resetEdgeHighlight(): void {
  current = null;
}

export function subscribeEdgeHighlight(listener: EdgeHighlightListener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
