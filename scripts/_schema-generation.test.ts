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
    // The envelope is declared once at the root; only the `diagram` field
    // varies by layout.
    expect(artifactSchemaJson).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "./artifact.schema.json",
      type: "object",
      required: ["id", "title", "updatedAt", "generator", "instructions", "diagram"],
      additionalProperties: false,
      properties: {
        id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" },
        updatedAt: { type: "string", format: "date-time" },
        generator: {
          type: "string",
          pattern: "^(?:built-in|project|global):[a-z0-9]+(?:-[a-z0-9]+)*$",
        },
        instructions: { type: "string", minLength: 1 },
        links: {
          type: "array",
          items: { $ref: "#/$defs/Link" },
        },
      },
    });

    // Every shared subschema is a named `$defs` entry, so each renders once
    // and every use references it.
    expect(Object.keys(artifactSchemaJson.$defs as JsonObject).toSorted()).toEqual(
      [
        "ComponentStructureGraph",
        "ControlEdge",
        "DefaultEdge",
        "DefaultNode",
        "DependencyGraph",
        "DiagramGraph",
        "ElkOptions",
        "FragmentNode",
        "Group",
        "LifelineNode",
        "Link",
        "MessageEdge",
        "RouteRequirementRuleset",
        "SequenceGraph",
      ].toSorted(),
    );

    // One union member per layout, each pairing that layout with its named
    // graph contract.
    const members = ((artifactSchemaJson.properties as JsonObject).diagram as JsonObject).anyOf as JsonObject[];
    expect(members.map((member) => member.type)).toEqual(["object", "object", "object", "object"]);
    const graphDefByLayoutId: Record<string, string> = {};
    for (const member of members) {
      const layoutId = (((member.properties as JsonObject).layout as JsonObject).properties as JsonObject).id as {
        const: string;
      };
      graphDefByLayoutId[layoutId.const] = refName((member.properties as JsonObject).graph);
      expect(member).toMatchObject({
        required: ["layout", "graph"],
        additionalProperties: false,
      });
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
