import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArtifact } from "@/features/artifact/artifact";
import { readCatalog } from "@/server/read-catalog";
import { writeCatalog } from "@/server/write-catalog";

const input = {
  type: "design",
  title: "Defaults",
  updatedAt: "2026-10-13T00:00:00.000Z",
  generator: "built-in:freeform",
  instructions: "Review the stored graph.",
  diagram: {
    layout: { layoutId: "general", options: { elk: { "_.direction": "DOWN" } } },
    graph: {
      groups: [{ groupId: "group", title: "Group" }],
      nodes: [{ nodeId: "node", title: "Node", groupId: "group" }],
      edges: [],
    },
  },
};

describe("writeCatalog", () => {
  test("omits normalized defaults without changing the parsed catalog", async () => {
    const scope = await mkdtemp(join(tmpdir(), "architecture-companion-write-"));
    try {
      const artifactId = "diagram.archcomp.json";
      const document = parseArtifact(input);
      await writeCatalog(scope, { artifacts: [{ ...document, artifactId }] });
      expect(JSON.parse(await readFile(join(scope, artifactId), "utf8"))).toEqual(input);
      const catalog = await readCatalog(scope);
      expect(catalog.status).toBe("valid");
      if (catalog.status !== "valid") throw new Error("Expected a valid written catalog");
      expect(catalog.catalog.artifacts).toEqual([{ ...document, artifactId }]);
    } finally {
      await rm(scope, { recursive: true, force: true });
    }
  });

  test("preserves incomplete authored documents instead of silently repairing them", async () => {
    const scope = await mkdtemp(join(tmpdir(), "architecture-companion-write-"));
    try {
      await writeCatalog(scope, { artifacts: [{ artifactId: "draft.archcomp.json", title: "Draft" }] });
      expect(JSON.parse(await readFile(join(scope, "draft.archcomp.json"), "utf8"))).toEqual({ title: "Draft" });
    } finally {
      await rm(scope, { recursive: true, force: true });
    }
  });
});
