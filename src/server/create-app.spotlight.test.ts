import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompanionCatalog } from "@/features/catalog/catalog";
import type { ArtifactSpotlight } from "@/features/spotlight/spotlight";
import type { CompanionScope } from "@/server/companion-scope";
import { createApp } from "@/server/create-app";
import { createSpotlightBroadcasts, type SpotlightBroadcasts } from "@/server/spotlight-broadcasts";
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
            nodes: [
              { type: "default", id: "cart", kind: "page", title: "Cart" },
              { type: "default", id: "pay", kind: "action", title: "Pay" },
            ],
            edges: [{ type: "default", id: "e1", source: "cart", target: "pay" }],
          },
        },
      },
    ],
    designs: [],
  };
}

function spotlight(elements: readonly ArtifactSpotlight["diagram"]["steps"][number]["elements"]): ArtifactSpotlight {
  return { artifactId: "checkout", diagram: { steps: [{ elements: [...elements] }] } };
}

async function prepare(extraHeaders: Record<string, string> = {}): Promise<
  Readonly<{
    app: ReturnType<typeof createApp>;
    broadcasts: SpotlightBroadcasts;
    scopePath: string;
    headers: Record<string, string>;
    cleanup: () => Promise<void>;
  }>
> {
  const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-spotlight-"));
  await mkdir(join(scopePath, ".architecture-companion"));
  await writeCatalog(scopePath, catalog());

  const broadcasts = createSpotlightBroadcasts();
  const scope: CompanionScope = { isGitRepository: false, path: scopePath };
  const app = createApp(scope, { spotlightBroadcasts: broadcasts });

  return {
    app,
    broadcasts,
    scopePath,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    cleanup: () => rm(scopePath, { recursive: true }),
  };
}

const baseUrl = "http://architecture-companion.test";

describe("spotlight endpoint", () => {
  it("publishes a catalog-validated spotlight once to connected viewers", async () => {
    const { app, broadcasts, cleanup, headers } = await prepare();
    const received: ArtifactSpotlight[] = [];
    const unsubscribe = broadcasts.subscribe((value) => received.push(value));

    try {
      const posted = await app.request(`${baseUrl}/api/spotlight`, {
        body: JSON.stringify(spotlight([{ type: "node", id: "cart" }])),
        headers,
        method: "POST",
      });
      expect(posted.status).toBe(201);
      await expect(posted.json()).resolves.toEqual({
        spotlight: spotlight([{ type: "node", id: "cart" }]),
      });
      expect(received).toEqual([spotlight([{ type: "node", id: "cart" }])]);
    } finally {
      unsubscribe();
      await cleanup();
    }
  });

  it("replaces an earlier spotlight with the latest ping and never replays it", async () => {
    const { app, broadcasts, cleanup, headers } = await prepare();
    const first: ArtifactSpotlight[] = [];
    const firstUnsubscribe = broadcasts.subscribe((value) => first.push(value));

    try {
      await app.request(`${baseUrl}/api/spotlight`, {
        body: JSON.stringify(spotlight([{ type: "node", id: "cart" }])),
        headers,
        method: "POST",
      });
      firstUnsubscribe();

      // A viewer that connects after the first ping sees nothing until the
      // agent pings again: the broadcast is one-shot and holds no state.
      const late: ArtifactSpotlight[] = [];
      const lateUnsubscribe = broadcasts.subscribe((value) => late.push(value));
      expect(late).toEqual([]);

      await app.request(`${baseUrl}/api/spotlight`, {
        body: JSON.stringify(spotlight([{ type: "edge", id: "e1" }])),
        headers,
        method: "POST",
      });
      expect(late).toEqual([spotlight([{ type: "edge", id: "e1" }])]);
      expect(first).toEqual([spotlight([{ type: "node", id: "cart" }])]);
      lateUnsubscribe();
    } finally {
      await cleanup();
    }
  });

  it("exposes no spotlight query or delete endpoints", async () => {
    const { app, cleanup } = await prepare();

    try {
      const fetched = await app.request(`${baseUrl}/api/spotlight`);
      expect(fetched.status).toBe(404);
      const deleted = await app.request(`${baseUrl}/api/spotlight`, { method: "DELETE" });
      expect(deleted.status).toBe(404);
    } finally {
      await cleanup();
    }
  });

  it("rejects spotlights for unknown artifacts and unknown diagram elements", async () => {
    const { app, broadcasts, cleanup, headers } = await prepare();
    const received: ArtifactSpotlight[] = [];
    const unsubscribe = broadcasts.subscribe((value) => received.push(value));

    try {
      const unknownArtifact = await app.request(`${baseUrl}/api/spotlight`, {
        body: JSON.stringify({ artifactId: "ghost", diagram: { steps: [{ elements: [] }] } }),
        headers,
        method: "POST",
      });
      expect(unknownArtifact.status).toBe(422);

      const unknownElement = await app.request(`${baseUrl}/api/spotlight`, {
        body: JSON.stringify(spotlight([{ type: "node", id: "ghost" }])),
        headers,
        method: "POST",
      });
      expect(unknownElement.status).toBe(422);
      const body = (await unknownElement.json()) as { error: { message: string } };
      expect(body.error.message).toContain("unknown diagram node: ghost");

      const malformed = await app.request(`${baseUrl}/api/spotlight`, {
        body: JSON.stringify({ artifactId: "checkout" }),
        headers,
        method: "POST",
      });
      expect(malformed.status).toBe(422);

      expect(received).toEqual([]);
    } finally {
      unsubscribe();
      await cleanup();
    }
  });

  it("accepts a spotlight from local tooling that sends no browser headers", async () => {
    const { app, broadcasts, cleanup, headers } = await prepare();
    const received: ArtifactSpotlight[] = [];
    const unsubscribe = broadcasts.subscribe((value) => received.push(value));

    try {
      const response = await app.request(`${baseUrl}/api/spotlight`, {
        body: JSON.stringify(spotlight([])),
        headers,
        method: "POST",
      });
      expect(response.status).toBe(201);
      expect(received).toEqual([spotlight([])]);
    } finally {
      unsubscribe();
      await cleanup();
    }
  });
});
