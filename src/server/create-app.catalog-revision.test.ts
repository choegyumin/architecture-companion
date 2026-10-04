import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "@/server/create-app";
import { resolveCompanionScope } from "@/server/resolve-companion-scope";
import { writeCatalog } from "@/server/write-catalog";

const baseUrl = "http://architecture-companion.test";

function catalog(title: string) {
  return {
    behaviors: [
      {
        title: "Workflow",
        updatedAt: "2026-10-03T09:15:00.000Z",
        generator: "built-in:freeform",
        instructions:
          "## Purpose\nReview the checkout trigger.\n\n## Regeneration\nRebuild the trigger from the current checkout flow.",
        layout: { id: "elk-layered", options: { elk: { direction: "RIGHT" } } },
        graph: {
          groups: [],
          nodes: [{ type: "default", id: "submit", kind: "trigger", title }],
          edges: [],
        },
        id: "checkout",
      },
    ],
    designs: [],
  };
}

describe("catalog revision", () => {
  it("keeps the revision ID stable across reads and changes it when the catalog changes", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-revision-"));

    try {
      await writeCatalog(scopePath, catalog("Checkout requested"));
      const app = createApp(await resolveCompanionScope(scopePath));

      const first = await (await app.request(`${baseUrl}/api/review`)).json();
      const repeated = await (await app.request(`${baseUrl}/api/review`)).json();
      await writeCatalog(scopePath, catalog("Checkout started"));
      const changed = await (await app.request(`${baseUrl}/api/review`)).json();

      expect(first.catalogRevisionId).toMatch(/^[a-f0-9]{64}$/);
      expect(repeated.catalogRevisionId).toBe(first.catalogRevisionId);
      expect(changed.catalogRevisionId).not.toBe(first.catalogRevisionId);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });
});
