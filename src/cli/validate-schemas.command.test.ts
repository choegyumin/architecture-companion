import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeValidateSchemasCommand } from "@/cli/validate-schemas.command";
import { ARTIFACTS_RELATIVE_PATH } from "@/server/read-catalog";
import { writeCatalog } from "@/server/write-catalog";

const checkoutBehavior = {
  kind: "behavior",
  title: "Checkout",
  updatedAt: "2026-10-03T09:15:00.000Z",
  generator: "built-in:freeform",
  instructions:
    "## Purpose\nReview order submission.\n\n## Regeneration\nRebuild the checkout trigger from the order flow.",
  diagram: {
    layout: { layoutId: "elk-layered" },
    graph: {
      groups: [],
      nodes: [{ nodeId: "submit", type: "default", kind: "trigger", title: "Submit order" }],
      edges: [],
    },
  },
} as const;

describe("Catalog schema validation command", () => {
  test("requires exactly one explicit scope argument", async () => {
    const outputs: string[] = [];
    const options = { writeStdout: (output: string) => outputs.push(output) };

    await expect(executeValidateSchemasCommand([], options)).rejects.toThrow("Usage: node validate-schemas.js <scope>");
    await expect(executeValidateSchemasCommand(["first", "second"], options)).rejects.toThrow(
      "Usage: node validate-schemas.js <scope>",
    );
    expect(outputs).toEqual([]);
  });

  test("validates a valid catalog and prints a single success line", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-validation-"));
    const outputs: string[] = [];

    try {
      await writeCatalog(scopePath, { artifacts: [] });

      await executeValidateSchemasCommand([scopePath], {
        writeStdout: (output) => outputs.push(output),
      });

      expect(outputs).toEqual(["Catalog is valid.\n"]);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("catalog validation is independent of the scope's Git metadata", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-validation-"));
    const nonDirectoryPath = join(scopePath, "not-a-directory");
    const outputs: string[] = [];

    try {
      await writeCatalog(scopePath, { artifacts: [] });
      await writeFile(nonDirectoryPath, "file");
      await symlink(join(nonDirectoryPath, "child"), join(scopePath, ".git"));

      await executeValidateSchemasCommand([scopePath], {
        writeStdout: (output) => outputs.push(output),
      });

      expect(outputs).toEqual(["Catalog is valid.\n"]);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("fails without stdout when the catalog is missing", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-validation-"));
    const outputs: string[] = [];

    try {
      await expect(
        executeValidateSchemasCommand([scopePath], {
          writeStdout: (output) => outputs.push(output),
        }),
      ).rejects.toThrow("Catalog is missing: no artifacts found in the configured paths");
      expect(outputs).toEqual([]);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("fails without stdout when a diagram file contains invalid JSON", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-validation-"));
    const outputs: string[] = [];

    try {
      await mkdir(join(scopePath, ARTIFACTS_RELATIVE_PATH), { recursive: true });
      await writeFile(join(scopePath, ARTIFACTS_RELATIVE_PATH, "invalid.archcomp.json"), "{ invalid");

      await expect(
        executeValidateSchemasCommand([scopePath], {
          writeStdout: (output) => outputs.push(output),
        }),
      ).rejects.toThrow("Catalog contains invalid JSON: .architecture-companion/artifacts/invalid.archcomp.json");
      expect(outputs).toEqual([]);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("accepts an arbitrary artifact file name without a persisted ID", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-validation-"));
    const outputs: string[] = [];

    try {
      await mkdir(join(scopePath, ARTIFACTS_RELATIVE_PATH), { recursive: true });
      await writeFile(
        join(scopePath, ARTIFACTS_RELATIVE_PATH, "order-flow.archcomp.json"),
        JSON.stringify(checkoutBehavior),
      );

      await executeValidateSchemasCommand([scopePath], {
        writeStdout: (output) => outputs.push(output),
      });

      expect(outputs).toEqual(["Catalog is valid.\n"]);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });
});
