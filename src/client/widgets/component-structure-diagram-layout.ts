import type { ComponentPaths, DiagramEdge, DiagramGraph } from "@/features/diagram/diagram-graph";
import type { DiagramLayout, DiagramLayoutPoint } from "@/features/diagram/diagram-spatial";

// These nodes exist only in the layout input, never in the saved graph or React Flow node list.
export function buildComponentStructureLayoutGraph(graph: DiagramGraph) {
  const controls = graph.componentStructure!.controls;
  const controlsById = new Map(controls.map((control) => [control.id, control]));
  const reservedIds = new Set([...graph.nodes, ...graph.groups, ...graph.edges].map(({ id }) => id));
  let nextId = 0;
  const allocateId = () => {
    let id: string;
    do id = `component-path:${nextId++}`;
    while (reservedIds.has(id));
    reservedIds.add(id);
    return id;
  };
  const junctions = new Map(controls.map((control) => [control.id, allocateId()]));
  const nodes = controls.map((control) => {
    const owner = graph.nodes.find(({ id }) => id === control.source)!;
    return { id: junctions.get(control.id)!, type: "default" as const, title: control.label, groupId: owner.groupId };
  });
  const routes = new Map<
    string,
    Readonly<{
      edge: DiagramEdge;
      paths: ComponentPaths;
      controlId?: string;
      originalEdgeId?: string;
    }>
  >();
  const edges: DiagramEdge[] = [];
  const labelRoutes = new Map<string, string>();

  const mergePath = (left: ComponentPaths[number], right: ComponentPaths[number]) => {
    const merged = [...left];
    for (const requirement of right) {
      const known = merged.find(({ controlId }) => controlId === requirement.controlId);
      if (known && known.value !== requirement.value) return undefined;
      if (!known) merged.push(requirement);
    }
    return merged;
  };
  const expandPath = (path: ComponentPaths[number]): ComponentPaths =>
    path.reduce<ComponentPaths>(
      (expanded, requirement) => {
        const control = controlsById.get(requirement.controlId)!;
        const prerequisites = control.when.flatMap(expandPath);
        return expanded.flatMap((prefix) =>
          prerequisites.flatMap((prerequisite) => {
            const merged = mergePath(prefix, [...prerequisite, requirement]);
            return merged ? [merged] : [];
          }),
        );
      },
      [[]],
    );

  const prerequisites = new Map(controls.map((control) => [control.id, control.when.flatMap(expandPath)]));
  const upstreamByOwner = new Map<string, ReadonlySet<string>>();
  const upstreamControls = (owner: string): ReadonlySet<string> => {
    const known = upstreamByOwner.get(owner);
    if (known) return known;
    const upstream = new Set<string>();
    const visited = new Set<string>();
    const pending = [owner];
    while (pending.length) {
      const target = pending.pop()!;
      if (visited.has(target)) continue;
      visited.add(target);
      for (const edge of graph.edges.filter((item) => item.target === target)) {
        pending.push(edge.source);
        const paths = edge.type === "default" ? (edge.component?.paths ?? [[]]) : [[]];
        for (const path of paths) {
          for (const requirement of [path, ...expandPath(path)].flat()) upstream.add(requirement.controlId);
        }
      }
    }
    upstreamByOwner.set(owner, upstream);
    return upstream;
  };
  const sourcesFor = (owner: string, paths: ComponentPaths, includeExternal = false) => {
    const sources = new Map<string, ComponentPaths>();
    const expandedPaths = paths.flatMap((path) => {
      const expanded = expandPath(path);
      // An impossible transitive condition is still part of the displayed graph; activation remains false.
      return expanded.length ? expanded : [path];
    });
    for (const path of expandedPaths) {
      // A control already traversed before this visible source must not create a return edge to its label.
      const local = path.filter(
        ({ controlId }) =>
          controlsById.get(controlId)!.source === owner || (includeExternal && !upstreamControls(owner).has(controlId)),
      );
      const terminals = local.filter(
        (requirement) =>
          !local.some(
            (other) =>
              other.controlId !== requirement.controlId &&
              prerequisites
                .get(other.controlId)!
                .some((prefix) => prefix.some((ancestor) => ancestor.controlId === requirement.controlId)),
          ),
      );
      for (const source of terminals.length ? terminals.map(({ controlId }) => junctions.get(controlId)!) : [owner]) {
        sources.set(source, [...(sources.get(source) ?? []), path]);
      }
    }
    return sources;
  };

  for (const control of controls) {
    for (const [source, paths] of sourcesFor(control.source, control.when)) {
      const id = allocateId();
      const edge = { id, type: "default" as const, source: control.source, target: control.source };
      routes.set(id, { edge, paths, controlId: control.id });
      edges.push({ ...edge, source, target: junctions.get(control.id)! });
      if (!labelRoutes.has(control.id)) labelRoutes.set(control.id, id);
    }
  }
  const ingressRoutes = new Map<string, string>();
  for (const edge of graph.edges) {
    const paths = edge.type === "default" ? (edge.component?.paths ?? [[]]) : [[]];
    let first = true;
    for (const [source, routePaths] of sourcesFor(edge.source, paths, true)) {
      const controlId = [...junctions].find(([, id]) => id === source)?.at(0);
      if (controlId && controlsById.get(controlId)!.source !== edge.source) {
        const key = JSON.stringify([edge.source, source]);
        const prefixPaths = routePaths.map((path) => path.filter((requirement) => requirement.controlId !== controlId));
        const knownId = ingressRoutes.get(key);
        if (knownId) {
          const known = routes.get(knownId)!;
          routes.set(knownId, { ...known, paths: [...known.paths, ...prefixPaths] });
        } else {
          const id = allocateId();
          const incoming = { id, type: "default" as const, source: edge.source, target: edge.source };
          routes.set(id, { edge: incoming, paths: prefixPaths, controlId });
          edges.push({ ...incoming, target: source });
          ingressRoutes.set(key, id);
        }
      }
      const id = first ? edge.id : allocateId();
      first = false;
      routes.set(id, { edge: { ...edge, id }, paths: routePaths, originalEdgeId: edge.id });
      edges.push({ ...edge, id, source });
    }
  }
  return { graph: { nodes: [...graph.nodes, ...nodes], groups: graph.groups, edges }, junctions, routes, labelRoutes };
}

export function componentStructureLabelPositions(
  layout: DiagramLayout,
  junctions: ReadonlyMap<string, string>,
): ReadonlyMap<string, DiagramLayoutPoint> {
  const groupOrigin = (id: string): DiagramLayoutPoint => {
    const group = layout.groups.find((item) => item.id === id)!;
    const parent = group.parentId ? groupOrigin(group.parentId) : { x: 0, y: 0 };
    return { x: parent.x + group.position.x, y: parent.y + group.position.y };
  };
  return new Map(
    [...junctions].map(([controlId, id]) => {
      const node = layout.nodes.find((item) => item.id === id)!;
      const parent = node.parentId ? groupOrigin(node.parentId) : { x: 0, y: 0 };
      return [
        controlId,
        {
          x: parent.x + node.position.x + node.size.width / 2,
          y: parent.y + node.position.y + node.size.height / 2,
        },
      ];
    }),
  );
}
