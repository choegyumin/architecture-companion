import { projectDecisionNodes } from "@/client/widgets/component-structure-diagram-renderer";
import { componentStructureDiagramGraphSchema } from "@/features/diagram/diagram-graph";

const graph = {
  groups: [],
  nodes: [
    { nodeId: "root", title: "Root" },
    { nodeId: "child", title: "Child" },
  ],
  edges: [{ edgeId: "edge", sourceNodeId: "root", targetNodeId: "child" }],
  layoutContext: { rootNodeIds: ["root"], controls: [] },
};

describe("component composition and projection", () => {
  test.each([
    {},
    { composition: null },
    {
      composition: {
        type: "node",
        slot: "children",
        origins: [{ supplierDefinitionId: "outside:App", slot: "header" }],
      },
    },
  ])("composition metadata does not change the control projection: %j", (layoutContext) => {
    const withContext = componentStructureDiagramGraphSchema.parse({
      ...graph,
      edges: graph.edges.map((edge) => ({ ...edge, layoutContext })),
    });
    expect(projectDecisionNodes(withContext)).toEqual(
      projectDecisionNodes(componentStructureDiagramGraphSchema.parse(graph)),
    );
  });
});
