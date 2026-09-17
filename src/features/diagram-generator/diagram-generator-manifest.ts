import { type DiagramGeneratorId, diagramGeneratorIdSchema } from "@/features/diagram-generator/diagram-generator-id";

export type DiagramGeneratorManifest = Readonly<{
  id: DiagramGeneratorId;
  description: string;
  prompt: string;
}>;

type ManifestField = Readonly<{
  key: string;
  value: string;
}>;

function invalidManifest(message: string): Error {
  return new Error(`Invalid diagram generator manifest: ${message}`);
}

function parseManifestField(line: string): ManifestField {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex < 1) throw invalidManifest(`Malformed frontmatter line: ${line}`);

  return {
    key: line.slice(0, separatorIndex).trim(),
    value: line.slice(separatorIndex + 1).trim(),
  };
}

export function parseDiagramGeneratorManifest(source: string): DiagramGeneratorManifest {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(0) !== "---") throw invalidManifest("Missing opening frontmatter delimiter");

  const closingOffset = lines.slice(1).findIndex((line) => line === "---");
  if (closingOffset < 0) throw invalidManifest("Missing closing frontmatter delimiter");

  const closingIndex = closingOffset + 1;
  const fields = lines
    .slice(1, closingIndex)
    .filter((line) => line.trim() !== "")
    .map(parseManifestField);
  const unknownField = fields.find(({ key }) => key !== "id" && key !== "description");
  if (unknownField) throw invalidManifest(`Unknown frontmatter key: ${unknownField.key}`);

  const duplicateField = fields.find(({ key }, index) => fields.findIndex((field) => field.key === key) !== index);
  if (duplicateField) throw invalidManifest(`Duplicate frontmatter key: ${duplicateField.key}`);

  const id = fields.find(({ key }) => key === "id")?.value;
  const description = fields.find(({ key }) => key === "description")?.value;
  const prompt = lines
    .slice(closingIndex + 1)
    .join("\n")
    .trim();

  if (!id) throw invalidManifest("Missing id");
  if (!description) throw invalidManifest("Missing description");
  if (!prompt) throw invalidManifest("Missing prompt");

  const parsedId = diagramGeneratorIdSchema.safeParse(id);
  if (!parsedId.success) throw invalidManifest(`Invalid id: ${id}`);

  return { id: parsedId.data, description, prompt };
}
