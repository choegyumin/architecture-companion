import { diagramLayoutConfigSchema, generalDiagramLayoutConfigSchema } from "./diagram-layout";

describe("diagram layout configuration", () => {
  test.each(["general", "sequence", "dependency-graph", "component-structure"])("accepts %s", (layoutId) => {
    expect(diagramLayoutConfigSchema.parse({ layoutId })).toEqual({ layoutId });
  });

  test("does not retain the old engine-named layout ID", () => {
    expect(diagramLayoutConfigSchema.safeParse({ layoutId: "elk-layered" }).success).toBe(false);
  });

  test("normalizes general options without creating an absent options object", () => {
    expect(generalDiagramLayoutConfigSchema.parse({ layoutId: "general" })).not.toHaveProperty("options");
    expect(generalDiagramLayoutConfigSchema.parse({ layoutId: "general", options: {} })).toEqual({
      layoutId: "general",
      options: { nudgeObstacleNodes: false, bezierEdges: false },
    });
    expect(
      generalDiagramLayoutConfigSchema.parse({ layoutId: "general", options: { bezierEdges: true } }).options,
    ).toEqual({
      nudgeObstacleNodes: false,
      bezierEdges: true,
    });
  });

  test("retains raw ELK option precedence by leaving verified options absent", () => {
    const parsed = generalDiagramLayoutConfigSchema.parse({
      layoutId: "general",
      options: { elk: { "_.direction": "DOWN" } },
    });
    expect(parsed.options?.elk).toEqual({ "_.direction": "DOWN" });
  });

  test.each(["sequence", "dependency-graph"])("does not add options to %s", (layoutId) => {
    expect(diagramLayoutConfigSchema.safeParse({ layoutId, options: {} }).success).toBe(false);
  });

  test("does not expose general routing controls in component structure", () => {
    expect(
      diagramLayoutConfigSchema.safeParse({ layoutId: "component-structure", options: { bezierEdges: true } }).success,
    ).toBe(false);
  });
});
