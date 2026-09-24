import { routeAggregateDependencyEdges } from "@/client/widgets/dependency-graph-aggregate-routes";
import { getDependencyElementBounds } from "@/client/widgets/dependency-graph-edge-routes";
import { layoutDependencyGraph } from "@/features/diagram/_layout/dependency-graph-layout";
import { type DependencyEdgeProjection, projectDependencyEdges } from "@/features/diagram/dependency-edge-projection";
import { parseDiagram } from "@/features/diagram/diagram";
import { getOrThrow } from "@/shared/universal/get-or-throw";

import artifactJson from "../../../.architecture-companion/designs/dependency-graph.json";

function routeOrdinateRange(path: string): readonly [number, number] {
  const ordinates = [...path.matchAll(/[MLQ] [-\d.]+ ([-\d.]+)/g)].map((match) => Number(match.at(1)));
  return [Math.min(...ordinates), Math.max(...ordinates)];
}

describe("dependency aggregate routes on the checked-in design", () => {
  it("does not wrap unrelated groups or travel beyond the destination to avoid other edges", async () => {
    const diagram = parseDiagram(artifactJson);
    const sizes = Object.fromEntries(diagram.graph.nodes.map(({ id }) => [id, { width: 288, height: 100 }]));
    const layout = await layoutDependencyGraph(diagram.graph, sizes);
    const bounds = getDependencyElementBounds(layout);
    const elements = new Map(
      [...layout.groups, ...layout.nodes.filter(({ parentId }) => !parentId)].map(
        ({ id }) => [id, getOrThrow(bounds.get(id), `Missing aggregate element: ${id}`)] as const,
      ),
    );
    const projections = projectDependencyEdges(diagram.graph).filter(
      (projection): projection is Extract<DependencyEdgeProjection, { type: "aggregate" }> =>
        projection.type === "aggregate",
    );
    const routes = routeAggregateDependencyEdges(projections, elements);
    const externalId = "group:external-packages";
    const pathFrom = (sourceId: string) => {
      const projection = projections.find((edge) => edge.sourceId === sourceId && edge.targetId === externalId);
      if (!projection) throw new Error(`Missing aggregate to external packages: ${sourceId}`);
      return getOrThrow(routes.get(projection.id), `Missing aggregate route: ${projection.id}`).path;
    };
    const clientId = "group:directory:src/client";
    const featuresId = "group:directory:src/features";
    const client = getOrThrow(bounds.get(clientId), "Missing client group");
    const external = getOrThrow(bounds.get(externalId), "Missing external group");

    expect(routeOrdinateRange(pathFrom(clientId)).at(0)).toBeGreaterThanOrEqual(client.position.y);
    expect(routeOrdinateRange(pathFrom(featuresId)).at(-1)).toBeLessThanOrEqual(
      external.position.y + external.size.height,
    );
  });
});
