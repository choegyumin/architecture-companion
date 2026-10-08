import { z } from "zod";

import { artifactSchema } from "@/features/artifact/artifact";

export const generatedSchemaFileNames = ["artifact.schema.json"] as const;

type GeneratedSchemaFileName = (typeof generatedSchemaFileNames)[number];

// One schema document holds the whole artifact contract: every union member
// and every shared subschema the `.meta({ id })` calls name, rendered once in
// `$defs` and referenced, instead of one inline copy per union member. The
// single-root form emits no `$id`, so the file identity is stamped here.
export function generateSchemaSources(): Readonly<Record<GeneratedSchemaFileName, string>> {
  const { $schema, ...schema } = z.toJSONSchema(artifactSchema, {
    target: "draft-2020-12",
    io: "input",
    reused: "inline",
  }) as Record<string, unknown>;
  const document = { $schema, $id: "./artifact.schema.json", ...schema };
  return { "artifact.schema.json": `${JSON.stringify(document, null, 2)}\n` };
}
