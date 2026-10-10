// @vitest-environment node
//
// The default happy-dom test environment silently drops forbidden request
// headers such as Origin and Sec-Fetch-Site, so the endpoint-level guard is
// verified here under Node's fetch implementation, which preserves them.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompanionCatalog } from "@/features/catalog/catalog";
import type { CompanionScope } from "@/server/companion-scope";
import { createApp } from "@/server/create-app";
import { createSpotlightBroadcasts } from "@/server/spotlight-broadcasts";
import { writeCatalog } from "@/server/write-catalog";

function catalog(): CompanionCatalog {
  return {
    behaviors: [
      {
        id: "checkout",
        title: "Checkout",
        updatedAt: "2026-10-03T09:15:00.000Z",
        generator: "built-in:freeform",
        instructions: "## Purpose\nReview the checkout trigger.",
        diagram: {
          layout: { id: "elk-layered" },
          graph: {
            groups: [],
            nodes: [{ type: "default", id: "cart", kind: "page", title: "Cart" }],
            edges: [],
          },
        },
      },
    ],
    designs: [],
  };
}

const baseUrl = "http://architecture-companion.test";

async function renderAppWithBroadcasts() {
  const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-spotlight-guard-"));
  await mkdir(join(scopePath, ".architecture-companion"));
  await writeCatalog(scopePath, catalog());

  const broadcasts = createSpotlightBroadcasts();
  const scope: CompanionScope = { isGitRepository: false, path: scopePath };
  const app = createApp(scope, { spotlightBroadcasts: broadcasts });
  return { app, broadcasts, cleanup: () => rm(scopePath, { recursive: true }) };
}

describe("spotlight endpoint request guard", () => {
  it("rejects cross-site requests without publishing", async () => {
    const { app, broadcasts, cleanup } = await renderAppWithBroadcasts();
    const published: unknown[] = [];
    const unsubscribe = broadcasts.subscribe((value) => published.push(value));

    try {
      const response = await app.request(`${baseUrl}/api/spotlight`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://example.com",
          "Sec-Fetch-Site": "cross-site",
        },
        body: JSON.stringify({ artifactId: "checkout", diagram: { steps: [{ elements: [] }] } }),
      });

      expect(response.status).toBe(403);
      expect(published).toEqual([]);
    } finally {
      unsubscribe();
      await cleanup();
    }
  });

  it("allows the companion page's own same-origin request", async () => {
    const { app, broadcasts, cleanup } = await renderAppWithBroadcasts();
    const published: unknown[] = [];
    const unsubscribe = broadcasts.subscribe((value) => published.push(value));

    try {
      const response = await app.request(`${baseUrl}/api/spotlight`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: baseUrl,
          "Sec-Fetch-Site": "same-origin",
        },
        body: JSON.stringify({ artifactId: "checkout", diagram: { steps: [{ elements: [] }] } }),
      });

      expect(response.status).toBe(201);
      expect(published).toHaveLength(1);
    } finally {
      unsubscribe();
      await cleanup();
    }
  });
});
