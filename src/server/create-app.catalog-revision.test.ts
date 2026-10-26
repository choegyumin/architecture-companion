import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "@/server/create-app";
import { resolveCompanionScope } from "@/server/resolve-companion-scope";

import { writeCatalog } from "../../tests/helpers/write-catalog";

const baseUrl = "http://architecture-companion.test";

function catalog(title: string) {
  return {
    artifacts: [
      {
        title: "Workflow",
        updatedAt: "2026-10-03T09:15:00.000Z",
        generator: "built-in:freeform",
        instructions:
          "## Purpose\nReview the checkout trigger.\n\n## Regeneration\nRebuild the trigger from the current checkout flow.",
        diagram: {
          layout: { layoutId: "general", options: { elk: { direction: "RIGHT" } } },
          graph: {
            groups: [],
            nodes: [{ type: "default", nodeId: "submit", kind: "trigger", title }],
            edges: [],
          },
        },
        artifactId: ".architecture-companion/artifacts/checkout-workflow.archcomp.json",
        type: "behavior",
      },
    ],
  };
}

function reversePropertyOrder(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(reversePropertyOrder);
  if (input === null || typeof input !== "object") return input;
  return Object.fromEntries(
    Object.entries(input)
      .reverse()
      .map(([key, value]) => [key, reversePropertyOrder(value)]),
  );
}

describe("catalog revision", () => {
  // Recorded from the existing revision implementation; re-recorded when parse output gained the synthetic default.
  it.each([
    ["empty", "bf551427bb93b2762e29fc326bedde7a8e2cac4e25b3126cea8fc66f46d2e55b"],
    ["general", "ed77fbfc7a2ac65d98843a645765618433f5a80d623cb7fb70aa241fb4ed3a2e"],
    ["flowchart", "e4b4e2b7e79b066263698ba370786e002c4969987a73645c775b23724b0dcd4d"],
    ["sequence", "75ecb844bbe6489d87450888bddaf13848d8956dd863b3f47a6e00f7341a6193"],
    ["dependency-graph", "2d5972eea21104fd5d5d71a125682bdbf296d1aaa6d055cf96c2b56b3a6f0510"],
    ["component-structure", "634f88aaa3b72b3a4b334fb9df0fadfe806345a07ea993f6ce6beca491324196"],
  ])("preserves the existing %s revision regardless of authored property order", async (kind, revisionId) => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-revision-"));
    const document = {
      instructions: "Synthetic revision compatibility fixture.",
      generator: kind === "flowchart" ? "built-in:flowchart" : "built-in:freeform",
      diagram: {
        graph: {
          edges: [],
          nodes: [
            {
              title: "Synthetic entry",
              nodeId: "entry",
              ...(kind === "sequence" ? { type: "lifeline", kind: "participant", activations: [] } : {}),
            },
          ],
          groups: [],
          ...(kind === "component-structure" ? { layoutContext: { controls: [], rootNodeIds: ["entry"] } } : {}),
        },
        layout: {
          layoutId: kind === "flowchart" ? "general" : kind,
          ...(kind === "general" || kind === "flowchart" ? { options: { elk: { direction: "RIGHT" } } } : {}),
        },
      },
      updatedAt: "2026-10-24T00:00:00.000Z",
      title: "Synthetic revision",
      type: "design",
    };

    try {
      await mkdir(join(scopePath, ".architecture-companion/artifacts"), { recursive: true });
      await mkdir(join(scopePath, "synthetic"));
      const app = createApp(await resolveCompanionScope(scopePath));
      for (const input of [document, reversePropertyOrder(document)]) {
        if (kind !== "empty") {
          await writeFile(join(scopePath, `synthetic/${kind}.archcomp.json`), JSON.stringify(input));
        }
        const response = await app.request(`${baseUrl}/api/review`);
        expect(response.status).toBe(200);
        expect((await response.json()).catalogRevisionId).toBe(revisionId);
      }
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

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
