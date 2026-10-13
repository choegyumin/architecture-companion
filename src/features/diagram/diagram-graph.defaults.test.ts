import {
  componentStructureDiagramGraphSchema,
  dependencyDiagramGraphSchema,
  diagramControlSchema,
  diagramEdgeSchema,
  diagramGroupSchema,
  diagramNodeSchema,
  generalDiagramGraphSchema,
} from "./diagram-graph";

const node = { nodeId: "root", title: "Root" };
const edge = { edgeId: "edge", sourceNodeId: "root", targetNodeId: "child" };

function componentGraph(layoutContext?: Record<string, unknown>) {
  return {
    groups: [],
    nodes: [node, { nodeId: "child", title: "Child" }],
    edges: [{ ...edge, ...(layoutContext === undefined ? {} : { layoutContext }) }],
    layoutContext: { rootNodeIds: ["root"], controls: [] },
  };
}

describe("diagram input defaults", () => {
  test("omitted discriminators select default nodes, edges, and groups", () => {
    expect(diagramNodeSchema.parse(node)).toEqual({ ...node, type: "default" });
    expect(diagramEdgeSchema.parse(edge)).toEqual({ ...edge, type: "default" });
    expect(diagramGroupSchema.parse({ groupId: "group", title: "Group" })).toEqual({
      groupId: "group",
      title: "Group",
      type: "default",
    });
  });

  test("unknown or null discriminators do not fall back to default", () => {
    for (const type of [null, "unknown"]) {
      expect(diagramNodeSchema.safeParse({ ...node, type }).success).toBe(false);
      expect(diagramEdgeSchema.safeParse({ ...edge, type }).success).toBe(false);
      expect(diagramGroupSchema.safeParse({ groupId: "group", title: "Group", type }).success).toBe(false);
    }
  });

  test("branch controls normalize prerequisites and polarity without interpreting labels", () => {
    const control = {
      controlId: "gate",
      ownerNodeId: "root",
      label: "!ready",
      type: "branch",
      cases: [
        { caseId: "a", label: "!ready" },
        { caseId: "b", label: "ready" },
      ],
    };
    expect(diagramControlSchema.parse(control)).toEqual({ ...control, dependsOn: [[]], polarityPair: false });
    for (const polarityPair of [false, true]) {
      expect(diagramControlSchema.parse({ ...control, polarityPair })).toMatchObject({ polarityPair });
    }
    expect(diagramControlSchema.safeParse({ ...control, dependsOn: [] }).success).toBe(false);
  });

  test.each([undefined, {}, { composition: null }])("normalizes nested edge context from %j", (layoutContext) => {
    const graph = componentStructureDiagramGraphSchema.parse(componentGraph(layoutContext));
    expect(graph.edges.at(0)?.layoutContext).toEqual({ composition: null });
    expect(graph.layoutContext.auxiliaryDefinitions).toEqual([]);
    expect(graph.nodes.at(0)?.type).toBe("default");
  });

  test("preserves a non-default composition and explicit control prerequisites", () => {
    const composition = { type: "node", slot: "children", origins: [] };
    const graph = componentStructureDiagramGraphSchema.parse(componentGraph({ composition }));
    expect(graph.edges.at(0)?.layoutContext.composition).toEqual(composition);
    const control = diagramControlSchema.parse({
      type: "conditional",
      controlId: "gate",
      ownerNodeId: "root",
      label: "ready",
      dependsOn: [[{ controlId: "outer", value: "on" }]],
    });
    expect(control.dependsOn).toEqual([[{ controlId: "outer", value: "on" }]]);
  });
});

describe("authored diamond nodes and bounding groups", () => {
  const diamond = { nodeId: "diamond", title: "Decision", type: "diamond", groupId: "bounds" };
  const bounding = { groupId: "bounds", title: "Bounds", type: "bounding" };

  test("general graphs accept both elements and preserve their hierarchy", () => {
    const graph = generalDiagramGraphSchema.parse({
      nodes: [node, diamond],
      groups: [
        { groupId: "outer", title: "Outer" },
        { ...bounding, parentGroupId: "outer" },
      ],
      edges: [{ ...edge, targetNodeId: "diamond" }],
    });
    expect(graph.nodes.at(1)).toEqual(diamond);
    expect(graph.groups.at(1)).toEqual({ ...bounding, parentGroupId: "outer", hideTitle: false });
  });

  test("diamond fields are limited to identity, title, group, and discriminator", () => {
    for (const field of ["kind", "links", "description", "details"]) {
      expect(
        diagramNodeSchema.safeParse({ ...diamond, [field]: field === "links" || field === "details" ? [] : "text" })
          .success,
      ).toBe(false);
    }
    expect(diagramNodeSchema.safeParse({ ...diamond, title: "" }).success).toBe(false);
  });

  test("bounding titles stay required even when hidden", () => {
    expect(diagramGroupSchema.parse({ ...bounding, hideTitle: true })).toEqual({ ...bounding, hideTitle: true });
    expect(diagramGroupSchema.safeParse({ groupId: "bounds", type: "bounding", hideTitle: true }).success).toBe(false);
    expect(diagramGroupSchema.safeParse({ ...bounding, title: "" }).success).toBe(false);
  });

  test("existing reference and cycle validation applies to authored elements", () => {
    expect(generalDiagramGraphSchema.safeParse({ groups: [], nodes: [diamond], edges: [] }).success).toBe(false);
    expect(
      generalDiagramGraphSchema.safeParse({
        groups: [{ ...bounding, parentGroupId: "bounds" }],
        nodes: [diamond],
        edges: [],
      }).success,
    ).toBe(false);
    expect(generalDiagramGraphSchema.safeParse({ groups: [bounding], nodes: [diamond], edges: [edge] }).success).toBe(
      false,
    );
  });

  test("dependency graphs do not accept diamond nodes", () => {
    expect(dependencyDiagramGraphSchema.safeParse({ groups: [bounding], nodes: [diamond], edges: [] }).success).toBe(
      false,
    );
  });
});
