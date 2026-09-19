import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeValidateSchemasCommand } from "@/cli/validate-schemas.command";

describe("Artifact schema validation command", () => {
  test("requires exactly one explicit scope argument", async () => {
    const outputs: string[] = [];
    const options = { writeStdout: (output: string) => outputs.push(output) };

    await expect(executeValidateSchemasCommand([], options)).rejects.toThrow("Usage: node validate-schemas.js <scope>");
    await expect(executeValidateSchemasCommand(["first", "second"], options)).rejects.toThrow(
      "Usage: node validate-schemas.js <scope>",
    );
    expect(outputs).toEqual([]);
  });

  test("validates a valid artifact and prints a single success line", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-validation-"));
    const artifactDirectory = join(scopePath, ".architecture-companion");
    const outputs: string[] = [];

    try {
      await mkdir(artifactDirectory);
      await writeFile(join(artifactDirectory, "artifact.json"), JSON.stringify({ behaviors: [], designs: [] }));

      await executeValidateSchemasCommand([scopePath], {
        writeStdout: (output) => outputs.push(output),
      });

      expect(outputs).toEqual(["Artifact is valid.\n"]);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("artifact validation is independent of the scope's Git metadata", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-validation-"));
    const artifactDirectory = join(scopePath, ".architecture-companion");
    const nonDirectoryPath = join(scopePath, "not-a-directory");
    const outputs: string[] = [];

    try {
      await mkdir(artifactDirectory);
      await writeFile(nonDirectoryPath, "file");
      await symlink(join(nonDirectoryPath, "child"), join(scopePath, ".git"));
      await writeFile(join(artifactDirectory, "artifact.json"), JSON.stringify({ behaviors: [], designs: [] }));

      await executeValidateSchemasCommand([scopePath], {
        writeStdout: (output) => outputs.push(output),
      });

      expect(outputs).toEqual(["Artifact is valid.\n"]);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("fails without stdout when the artifact is missing", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-validation-"));
    const outputs: string[] = [];

    try {
      await expect(
        executeValidateSchemasCommand([scopePath], {
          writeStdout: (output) => outputs.push(output),
        }),
      ).rejects.toThrow("Artifact is missing: .architecture-companion/artifact.json");
      expect(outputs).toEqual([]);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("fails without stdout when the artifact contains invalid JSON", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-validation-"));
    const artifactDirectory = join(scopePath, ".architecture-companion");
    const outputs: string[] = [];

    try {
      await mkdir(artifactDirectory);
      await writeFile(join(artifactDirectory, "artifact.json"), "{ invalid");

      await expect(
        executeValidateSchemasCommand([scopePath], {
          writeStdout: (output) => outputs.push(output),
        }),
      ).rejects.toThrow("Artifact contains invalid JSON: .architecture-companion/artifact.json");
      expect(outputs).toEqual([]);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  test("fails with a detailed error when the artifact violates a domain rule", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-validation-"));
    const artifactDirectory = join(scopePath, ".architecture-companion");
    const outputs: string[] = [];
    const process = {
      id: "checkout",
      title: "Checkout",
      generatorId: "freeform",
      layout: { id: "elk-layered" },
      graph: {
        groups: [],
        nodes: [{ id: "submit", type: "default", kind: "trigger", title: "Submit order" }],
        edges: [],
      },
    };

    try {
      await mkdir(artifactDirectory);
      await writeFile(
        join(artifactDirectory, "artifact.json"),
        JSON.stringify({ behaviors: [process, process], designs: [] }),
      );

      await expect(
        executeValidateSchemasCommand([scopePath], {
          writeStdout: (output) => outputs.push(output),
        }),
      ).rejects.toThrow(
        "Artifact is invalid: .architecture-companion/artifact.json. Invalid artifact: Duplicate behavior ID: checkout",
      );
      expect(outputs).toEqual([]);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });
});
