import { collectComponentOrigins } from "./component-structure-guards";

it("resolves supplier names from the registry, stored nodes, and the outside-graph fallback", () => {
  const graph = {
    nodes: [
      {
        nodeId: "supplied",
        type: "default",
        title: "Supplied",
        layoutContext: {
          definitionId: "definition:Shared",
          origins: [
            { supplierDefinitionId: "outside:App", slot: "header" },
            { supplierDefinitionId: "outside:App", slot: "header" },
            { supplierDefinitionId: "outside:Other", slot: "footer" },
            { supplierDefinitionId: "definition:Inner", slot: "children" },
          ],
        },
      },
      {
        nodeId: "inner",
        type: "default",
        title: "Inner",
        layoutContext: { definitionId: "definition:Inner", origins: [] },
      },
      { nodeId: "authored", type: "default", title: "Authored" },
      {
        nodeId: "empty",
        type: "default",
        title: "Empty",
        layoutContext: { definitionId: "definition:Empty", origins: [] },
      },
    ],
    edges: [
      { source: "parent", target: "supplied", label: "Do not override structured origins" },
      { source: "parent", target: "authored", label: "Authored relationship" },
      { source: "parent", target: "empty", label: "Empty origins relationship" },
    ],
    auxiliaryDefinitions: [{ definitionId: "outside:App", title: "App" }],
  } satisfies Parameters<typeof collectComponentOrigins>[0];

  expect(collectComponentOrigins(graph)).toEqual(
    new Map([
      ["supplied", ["from App (header)", "from Inner (children)", "from outside graph (footer)"]],
      ["authored", ["Authored relationship"]],
      ["empty", ["Empty origins relationship"]],
    ]),
  );
});

it("prefers an explicit registry entry over a matching node", () => {
  const graph = {
    nodes: [
      {
        nodeId: "supplied",
        type: "default",
        title: "Supplied",
        layoutContext: {
          definitionId: "definition:Shared",
          origins: [{ supplierDefinitionId: "definition:Inner", slot: "children" }],
        },
      },
      {
        nodeId: "inner@1",
        type: "default",
        title: "Inner from node",
        layoutContext: { definitionId: "definition:Inner", origins: [] },
      },
    ],
    edges: [],
    auxiliaryDefinitions: [{ definitionId: "definition:Inner", title: "Inner from registry" }],
  } satisfies Parameters<typeof collectComponentOrigins>[0];

  expect(collectComponentOrigins(graph)).toEqual(new Map([["supplied", ["from Inner from registry (children)"]]]));
});
