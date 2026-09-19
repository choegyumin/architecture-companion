import { z } from "zod";

import { diagramSchema } from "@/features/diagram/diagram";
import { diagramGraphSchema } from "@/features/diagram/diagram-graph";

export const generatedSchemaFileNames = ["diagram-graph.schema.json", "diagram.schema.json"] as const;

type GeneratedSchemaFileName = (typeof generatedSchemaFileNames)[number];
type SchemaId = "Diagram" | "DiagramGraph";

type SchemaDefinition = Readonly<{
  fileName: GeneratedSchemaFileName;
  id: SchemaId;
  schema: z.ZodType;
}>;

const schemaDefinitions: readonly SchemaDefinition[] = [
  { id: "DiagramGraph", fileName: "diagram-graph.schema.json", schema: diagramGraphSchema },
  { id: "Diagram", fileName: "diagram.schema.json", schema: diagramSchema },
];

function resolveSchemaUri(id: string): string {
  const definition = schemaDefinitions.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Unknown schema ID: ${id}`);
  return `./${definition.fileName}`;
}

export function generateSchemaSources(): Readonly<Record<GeneratedSchemaFileName, string>> {
  const registry = z.registry<{ id: string }>();
  schemaDefinitions.forEach(({ id, schema }) => registry.add(schema, { id }));

  const { schemas } = z.toJSONSchema(registry, {
    target: "draft-2020-12",
    io: "input",
    uri: resolveSchemaUri,
  });

  return Object.fromEntries(
    schemaDefinitions.map(({ fileName, id }) => {
      const schema = schemas[id];
      if (!schema) throw new Error(`Zod did not generate schema: ${id}`);
      return [fileName, `${JSON.stringify(schema, null, 2)}\n`];
    }),
  ) as Record<GeneratedSchemaFileName, string>;
}
