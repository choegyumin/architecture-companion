export type DiagramLayoutPoint = Readonly<{ x: number; y: number }>;
export type DiagramLayoutSize = Readonly<{ width: number; height: number }>;

export type DiagramLayoutNodeData = Readonly<{
  handles?: readonly Readonly<{ id: string; side: "left" | "right"; y: number }>[];
  activations?: readonly Readonly<{ id: string; y: number; height: number }>[];
  branches?: readonly Readonly<{ id: string; y: number; height: number }>[];
}>;

export type DiagramLayoutNode = Readonly<{
  id: string;
  parentId?: string;
  position: DiagramLayoutPoint;
  size: DiagramLayoutSize;
  data?: DiagramLayoutNodeData;
}>;

export type DiagramLayoutEdge = Readonly<{
  id: string;
  points: readonly DiagramLayoutPoint[];
}>;

export type DiagramLayoutGroup = Readonly<{
  id: string;
  parentId?: string;
  position: DiagramLayoutPoint;
  size: DiagramLayoutSize;
}>;

export type DiagramViewFramingOptions =
  | Readonly<{ mode: "fit" }>
  | Readonly<{
      mode: "node";
      nodeId: string;
      x: "center" | "clamp";
      y: "center" | "clamp";
    }>;

export type DiagramLayout = Readonly<{
  nodes: readonly DiagramLayoutNode[];
  groups: readonly DiagramLayoutGroup[];
  edges: readonly DiagramLayoutEdge[];
  initialView: DiagramViewFramingOptions;
}>;

export type DiagramNodeSizes = Readonly<Record<string, DiagramLayoutSize>>;
