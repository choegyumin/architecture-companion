import { z } from "zod";

import { artifactSchema } from "@/features/artifact/artifact";
import { catalogConfigSchema } from "@/features/catalog/catalog";

export const generatedSchemaFileNames = ["artifact.schema.json", "config.schema.json"] as const;

type GeneratedSchemaFileName = (typeof generatedSchemaFileNames)[number];

// One schema document holds the whole artifact contract: every union member
// and every shared subschema the `.meta({ id })` calls name, rendered once in
// `$defs` and referenced, instead of one inline copy per union member. The
// single-root form emits no `$id`, so the file identity is stamped here.
export function generateSchemaSources(): Readonly<Record<GeneratedSchemaFileName, string>> {
  return Object.fromEntries(
    [
      ["artifact.schema.json", artifactSchema],
      ["config.schema.json", catalogConfigSchema],
    ].map(([fileName, source]) => {
      const { $schema, ...schema } = z.toJSONSchema(source as z.ZodType, {
        target: "draft-2020-12",
        io: "input",
        reused: "inline",
      }) as Record<string, unknown>;
      const document = { $schema, $id: `./${fileName}`, ...schema };
      return [fileName, `${JSON.stringify(document, null, 2)}\n`];
    }),
  ) as Record<GeneratedSchemaFileName, string>;
}
