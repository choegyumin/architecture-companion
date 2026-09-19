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

function findObject(value: unknown, predicate: (candidate: JsonObject) => boolean): JsonObject | undefined {
  if (Array.isArray(value)) {
    return value.map((entry) => findObject(entry, predicate)).find((entry) => entry !== undefined);
  }
  if (typeof value !== "object" || value === null) return undefined;

  const object = value as JsonObject;
  if (predicate(object)) return object;
  return Object.values(object)
    .map((entry) => findObject(entry, predicate))
    .find((entry) => entry !== undefined);
}

describe("generateSchemaSources", () => {
  it("renders the two tracked Draft 2020-12 schemas deterministically", () => {
    const first = generateSchemaSources();
    const second = generateSchemaSources();

    expect(Object.keys(first).toSorted()).toEqual([...generatedSchemaFileNames].toSorted());
    expect(first).toEqual(second);
    expect(Object.values(first).every((source) => source.endsWith("\n"))).toBe(true);

    expect(parseJsonObject(first["diagram-graph.schema.json"])).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "./diagram-graph.schema.json",
      type: "object",
      required: ["groups", "nodes", "edges"],
      additionalProperties: false,
    });
    expect(parseJsonObject(first["diagram.schema.json"])).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "./diagram.schema.json",
      type: "object",
      required: ["id", "title", "generatorId", "layout", "graph"],
      additionalProperties: false,
      properties: {
        generatorScript: { type: "string", minLength: 1 },
        links: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string", minLength: 1 },
              href: { type: "string", minLength: 1 },
            },
            required: ["href"],
            additionalProperties: false,
          },
        },
        graph: { $ref: "./diagram-graph.schema.json" },
      },
    });
  });

  it("describes accepted input before Zod defaults are applied", () => {
    const graphSchema = parseJsonObject(generateSchemaSources()["diagram-graph.schema.json"]);
    const messageEdgeSchema = findObject(graphSchema, (candidate) => {
      const properties = candidate.properties;
      return typeof properties === "object" && properties !== null && "messageType" in properties;
    });

    expect(messageEdgeSchema).toBeDefined();
    expect(messageEdgeSchema).toMatchObject({
      properties: { messageType: { default: "sync" } },
    });
    expect(messageEdgeSchema?.required).not.toContain("messageType");
  });
});
