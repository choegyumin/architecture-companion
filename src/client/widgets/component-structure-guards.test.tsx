import { collectComponentOrigins } from "./component-structure-guards";

it("displays supplier slots from layoutContext and falls back to authored labels only without structured origins", () => {
  const graph = {
    nodes: [
      {
        id: "supplied",
        type: "default",
        title: "Supplied",
        layoutContext: {
          definitionId: "definition:Shared",
          origins: [
            { supplierId: "outside:App", supplierTitle: "App", slot: "header" },
            { supplierId: "outside:App", supplierTitle: "App", slot: "header" },
            { supplierId: "outside:Other", supplierTitle: "Other", slot: "footer" },
          ],
        },
      },
      { id: "authored", type: "default", title: "Authored" },
      {
        id: "empty",
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
  } satisfies Parameters<typeof collectComponentOrigins>[0];

  expect(collectComponentOrigins(graph)).toEqual(
    new Map([
      ["supplied", ["from App (header)", "from Other (footer)"]],
      ["authored", ["Authored relationship"]],
      ["empty", ["Empty origins relationship"]],
    ]),
  );
});
