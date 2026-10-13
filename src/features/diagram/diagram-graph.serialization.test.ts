import {
  componentStructureDiagramGraphSchema,
  generalDiagramGraphSchema,
  sequenceDiagramGraphSchema,
  toDiagramGraphInput,
} from "./diagram-graph";

describe("diagram graph serialization", () => {
  it("omits default element types and visible bounding titles without changing authored elements", () => {
    const input = {
      groups: [
        { groupId: "group", title: "Group" },
        { groupId: "visible", type: "bounding", title: "Visible", parentGroupId: "group" },
        { groupId: "hidden", type: "bounding", title: "Hidden", hideTitle: true },
      ],
      nodes: [
        {
          nodeId: "source",
          title: "Source",
          groupId: "visible",
          kind: "service",
          description: "Source details",
          links: [{ href: "source:///source.ts" }],
        },
        { nodeId: "target", type: "diamond", title: "Target", groupId: "hidden" },
      ],
      edges: [
        { edgeId: "connection", sourceNodeId: "source", targetNodeId: "target", label: "Calls", kind: "runtime" },
      ],
    };
    const graph = generalDiagramGraphSchema.parse(input);
    const original = structuredClone(graph);
    const serialized = toDiagramGraphInput(graph);

    expect(serialized).toEqual(input);
    expect(generalDiagramGraphSchema.parse(JSON.parse(JSON.stringify(serialized)))).toEqual(graph);
    expect(graph).toEqual(original);
  });

  it("omits synchronous message defaults while retaining asynchronous and return messages", () => {
    const input = {
      groups: [],
      nodes: [
        { nodeId: "source", type: "lifeline", title: "Source", kind: "participant", activations: [] },
        { nodeId: "target", type: "lifeline", title: "Target", kind: "participant", activations: [] },
      ],
      edges: [
        { edgeId: "sync", type: "message", sourceNodeId: "source", targetNodeId: "target" },
        { edgeId: "async", type: "message", sourceNodeId: "source", targetNodeId: "target", messageType: "async" },
        { edgeId: "return", type: "message", sourceNodeId: "target", targetNodeId: "source", messageType: "return" },
      ],
    };
    const graph = sequenceDiagramGraphSchema.parse(input);
    const serialized = toDiagramGraphInput(graph);

    expect(serialized).toEqual(input);
    expect(sequenceDiagramGraphSchema.parse(JSON.parse(JSON.stringify(serialized)))).toEqual(graph);
  });

  it("omits component defaults while preserving explicit controls, prerequisites, and supplied compositions", () => {
    const input = {
      groups: [{ groupId: "group", title: "Group" }],
      nodes: [
        { nodeId: "root", title: "Root", groupId: "group", layoutContext: { definitionId: "Root", origins: [] } },
        { nodeId: "child", title: "Child" },
        { nodeId: "supplied", title: "Supplied" },
      ],
      edges: [
        { edgeId: "direct", sourceNodeId: "root", targetNodeId: "child" },
        {
          edgeId: "gated",
          type: "control",
          sourceNodeId: "root",
          targetNodeId: "child",
          activeWhen: [[{ controlId: "choice", value: "on" }]],
        },
        {
          edgeId: "supplied-edge",
          sourceNodeId: "root",
          targetNodeId: "supplied",
          layoutContext: {
            composition: { type: "node", slot: "children", origins: [{ supplierDefinitionId: "Root", slot: "body" }] },
          },
        },
      ],
      layoutContext: {
        rootNodeIds: ["root"],
        controls: [
          { controlId: "enabled", ownerNodeId: "root", type: "conditional", label: "Enabled" },
          {
            controlId: "mode",
            ownerNodeId: "root",
            type: "branch",
            label: "Mode",
            cases: [
              { caseId: "first", label: "First" },
              { caseId: "second", label: "Second" },
            ],
          },
          {
            controlId: "choice",
            ownerNodeId: "root",
            type: "branch",
            label: "Choice",
            polarityPair: true,
            dependsOn: [[{ controlId: "enabled", value: "on" }]],
            cases: [
              { caseId: "on", label: "On" },
              { caseId: "off", label: "Off" },
            ],
          },
        ],
      },
    };
    const graph = componentStructureDiagramGraphSchema.parse(input);
    const original = structuredClone(graph);
    const serialized = toDiagramGraphInput(graph);

    expect(serialized).toEqual(input);
    expect(componentStructureDiagramGraphSchema.parse(JSON.parse(JSON.stringify(serialized)))).toEqual(graph);
    expect(graph).toEqual(original);

    const withRegistry = componentStructureDiagramGraphSchema.parse({
      ...input,
      layoutContext: {
        ...input.layoutContext,
        auxiliaryDefinitions: [{ definitionId: "Outside", title: "Outside supplier" }],
      },
    });
    const serializedRegistry = toDiagramGraphInput(withRegistry);
    expect(serializedRegistry.layoutContext.auxiliaryDefinitions).toEqual([
      { definitionId: "Outside", title: "Outside supplier" },
    ]);
    expect(componentStructureDiagramGraphSchema.parse(JSON.parse(JSON.stringify(serializedRegistry)))).toEqual(
      withRegistry,
    );
  });
});
