import { routeAggregateDependencyEdges } from "@/client/widgets/dependency-graph-aggregate-routes";
import { getDependencyElementBounds } from "@/client/widgets/dependency-graph-edge-routes";
import { onBoundary, pathEndpoints } from "@/client/widgets/dependency-graph-route-test-geometry";
import { parseArtifact } from "@/features/artifact/artifact";
import { layoutDependencyGraph } from "@/features/diagram/_layout/dependency-graph-layout";
import { projectDependencyEdges } from "@/features/diagram/dependency-edge-projection";
import { getOrThrow } from "@/shared/universal/get-or-throw";

import componentStructureJson from "../../../.architecture-companion/designs/component-structure.json";
import dependencyGraphJson from "../../../.architecture-companion/designs/dependency-graph.json";
import sequenceJson from "../../../.architecture-companion/designs/review-session-sequence.json";

// The dogfooding catalog tracks this repository's own refactoring, so it moves
// with every change to src/. It is smoke-tested only — parse, layout, and route
// must succeed — while the pinned showcase designs carry the detailed routing
// assertions. Strong assertions here would break on unrelated refactoring.
describe("dogfooding catalog smoke", () => {
  it("still parses every checked-in design", () => {
    for (const json of [dependencyGraphJson, componentStructureJson, sequenceJson]) {
      const artifact = parseArtifact(json);
      expect(artifact.diagram.graph).toBeDefined();
    }
  });

  it("still lays out and routes the dogfooded dependency graph", async () => {
    const diagram = parseArtifact(dependencyGraphJson);
    const graph = diagram.diagram.graph;
    const sizes = Object.fromEntries(graph.nodes.map(({ id }) => [id, { width: 288, height: 100 }]));
    const layout = await layoutDependencyGraph(graph, sizes);
    const bounds = getDependencyElementBounds(layout);

    for (const group of graph.groups) {
      const projections = projectDependencyEdges(graph, { type: "group", id: group.id }).filter(
        (projection) => projection.type === "aggregate",
      );
      if (projections.length === 0) continue;
      const routes = routeAggregateDependencyEdges(projections, layout);
      for (const { id, sourceId, targetId } of projections) {
        const route = getOrThrow(routes.get(id), `Missing dogfooded route: ${id}`);
        const { start, end } = pathEndpoints(route.path);
        expect(onBoundary(start, getOrThrow(bounds.get(sourceId), `Missing bounds: ${sourceId}`))).toBe(true);
        expect(onBoundary(end, getOrThrow(bounds.get(targetId), `Missing bounds: ${targetId}`))).toBe(true);
      }
    }
  });
});
