import { describe, expect, it } from "vitest";

import { generatedSchemaFileNames, generateSchemaSources } from "./_schema-generation";

type JsonObject = Record<string, unknown>;

function parseJsonObject(source: string): JsonObject {
  const parsed: unknown = JSON.parse(source);
  expect(parsed).toBeTypeOf("object");
  expect(parsed).not.toBeNull();
  expect(Array.isArray(parsed)).toBe(false);
  return parsed as JsonObject;
}

function refName(schema: unknown): string {
  expect(schema).toMatchObject({ $ref: expect.stringMatching(/^#\/\$defs\//) });
  return (schema as { $ref: string }).$ref.replace("#/$defs/", "");
}

describe("generateSchemaSources", () => {
  it("renders the tracked Draft 2020-12 schema deterministically", () => {
    const first = generateSchemaSources();
    const second = generateSchemaSources();

    expect(Object.keys(first)).toEqual([...generatedSchemaFileNames]);
    expect(first).toEqual(second);
    expect(Object.values(first).every((source) => source.endsWith("\n"))).toBe(true);

    const artifactSchemaJson = parseJsonObject(first["artifact.schema.json"]);
    expect(artifactSchemaJson).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "./artifact.schema.json",
    });

    // Every shared subschema is a named `$defs` entry, so each renders once
    // and every use references it.
    expect(Object.keys(artifactSchemaJson.$defs as JsonObject).toSorted()).toEqual(
      [
        "ArtifactId",
        "ControlEdge",
        "DefaultEdge",
        "DefaultNode",
        "DependencyGraph",
        "DiagramGraph",
        "ElkOptions",
        "FragmentNode",
        "Generator",
        "Group",
        "LifelineNode",
        "Link",
        "Links",
        "MessageEdge",
        "RouteRequirementRuleset",
        "SequenceGraph",
        "UpdatedAt",
        "Vcs",
        "ComponentStructureGraph",
      ].toSorted(),
    );

    // One union member per layout, each pairing that layout with its named
    // graph contract and referencing the shared envelope pieces.
    const members = artifactSchemaJson.anyOf as JsonObject[];
    expect(members.map((member) => member.type)).toEqual(["object", "object", "object", "object"]);
    const graphDefByLayoutId: Record<string, string> = {};
    for (const member of members) {
      const properties = member.properties as JsonObject;
      const layoutId = ((properties.layout as JsonObject).properties as JsonObject).id as {
        const: string;
      };
      graphDefByLayoutId[layoutId.const] = refName(properties.graph);
      expect(member).toMatchObject({
        required: ["id", "title", "updatedAt", "generator", "instructions", "layout", "graph"],
        additionalProperties: false,
      });
      expect(refName(properties.id)).toBe("ArtifactId");
      expect(refName(properties.updatedAt)).toBe("UpdatedAt");
      expect(refName(properties.vcs)).toBe("Vcs");
      expect(refName(properties.generator)).toBe("Generator");
      expect(refName(properties.links)).toBe("Links");
    }
    expect(graphDefByLayoutId).toEqual({
      "component-structure": "ComponentStructureGraph",
      "dependency-graph": "DependencyGraph",
      "elk-layered": "DiagramGraph",
      sequence: "SequenceGraph",
    });
  });

  it("describes accepted input before Zod defaults are applied", () => {
    const defs = parseJsonObject(generateSchemaSources()["artifact.schema.json"]).$defs as JsonObject;
    const messageEdgeSchema = defs.MessageEdge as JsonObject;

    expect(messageEdgeSchema).toMatchObject({
      properties: { messageType: { default: "sync" } },
    });
    expect(messageEdgeSchema.required).not.toContain("messageType");
  });
});
