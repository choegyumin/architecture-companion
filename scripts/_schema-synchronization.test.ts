import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { generatedSchemaFileNames, generateSchemaSources } from "./_schema-generation";
import { assertSchemaFilesCurrent, writeSchemaFiles } from "./_schema-synchronization";

async function withTemporaryRoot(action: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "architecture-companion-schemas-"));
  try {
    await action(root);
  } finally {
    await rm(root, { recursive: true });
  }
}

describe("schema files", () => {
  it("writes every generated schema deterministically", async () => {
    await withTemporaryRoot(async (outputRoot) => {
      await writeSchemaFiles(outputRoot);

      expect((await readdir(outputRoot)).toSorted()).toEqual([...generatedSchemaFileNames].toSorted());
      const expected = generateSchemaSources();
      await Promise.all(
        generatedSchemaFileNames.map(async (fileName) => {
          expect(await readFile(join(outputRoot, fileName), "utf8")).toBe(expected[fileName]);
        }),
      );
      await expect(assertSchemaFilesCurrent(outputRoot)).resolves.toBeUndefined();
    });
  });

  it("reports every missing or stale tracked schema without rewriting it", async () => {
    await withTemporaryRoot(async (outputRoot) => {
      await writeSchemaFiles(outputRoot);
      const stalePath = join(outputRoot, "diagram.schema.json");
      await writeFile(stalePath, "{}\n");
      await rm(join(outputRoot, "artifact.schema.json"));

      await expect(assertSchemaFilesCurrent(outputRoot)).rejects.toThrow(
        "Schemas are missing or stale: diagram.schema.json, artifact.schema.json. Run `pnpm run schema-gen`.",
      );
      expect(await readFile(stalePath, "utf8")).toBe("{}\n");
    });
  });
});
