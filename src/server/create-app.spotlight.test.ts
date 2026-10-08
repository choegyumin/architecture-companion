import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompanionCatalog } from "@/features/catalog/catalog";
import type { ArtifactSpotlight } from "@/features/spotlight/spotlight";
import type { CompanionScope } from "@/server/companion-scope";
import { createApp } from "@/server/create-app";
import { createSpotlightChannel, type SpotlightChannel } from "@/server/spotlight-channel";
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

function spotlight(elements: ArtifactSpotlight["diagram"]["elements"]): ArtifactSpotlight {
  return { artifactId: "checkout", diagram: { elements } };
}

async function prepare(extraHeaders: Record<string, string> = {}): Promise<
  Readonly<{
    app: ReturnType<typeof createApp>;
    channel: SpotlightChannel;
    scopePath: string;
    headers: Record<string, string>;
    cleanup: () => Promise<void>;
  }>
> {
  const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-spotlight-"));
  await mkdir(join(scopePath, ".architecture-companion"));
  await writeCatalog(scopePath, catalog());

  const channel = createSpotlightChannel();
  const scope: CompanionScope = { isGitRepository: false, path: scopePath };
  const app = createApp(scope, { spotlightChannel: channel });

  return {
    app,
    channel,
    scopePath,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    cleanup: () => rm(scopePath, { recursive: true }),
  };
}

const baseUrl = "http://architecture-companion.test";

describe("spotlight endpoints", () => {
  it("stores a catalog-validated spotlight and serves it afterwards", async () => {
    const { app, channel, cleanup, headers } = await prepare();

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
      expect(channel.current()).toEqual(spotlight([{ type: "node", id: "cart" }]));

      const fetched = await app.request(`${baseUrl}/api/spotlight`);
      expect(fetched.status).toBe(200);
      await expect(fetched.json()).resolves.toEqual({
        spotlight: spotlight([{ type: "node", id: "cart" }]),
      });
    } finally {
      await cleanup();
    }
  });

  it("notifies subscribers when a spotlight is published or cleared", async () => {
    const { app, channel, cleanup, headers } = await prepare();
    const received: Array<ArtifactSpotlight | null> = [];
    const unsubscribe = channel.subscribe((value) => received.push(value));

    try {
      await app.request(`${baseUrl}/api/spotlight`, {
        body: JSON.stringify(spotlight([])),
        headers,
        method: "POST",
      });
      await app.request(`${baseUrl}/api/spotlight`, { headers, method: "DELETE" });

      expect(received).toEqual([spotlight([]), null]);
      expect(channel.current()).toBeNull();
    } finally {
      unsubscribe();
      await cleanup();
    }
  });

  it("rejects spotlights for unknown artifacts and unknown diagram elements", async () => {
    const { app, channel, cleanup, headers } = await prepare();

    try {
      const unknownArtifact = await app.request(`${baseUrl}/api/spotlight`, {
        body: JSON.stringify({ artifactId: "ghost", diagram: { elements: [] } }),
        headers,
        method: "POST",
      });
      expect(unknownArtifact.status).toBe(422);
      expect(channel.current()).toBeNull();

      const unknownElement = await app.request(`${baseUrl}/api/spotlight`, {
        body: JSON.stringify(spotlight([{ type: "node", id: "ghost" }])),
        headers,
        method: "POST",
      });
      expect(unknownElement.status).toBe(422);
      const body = (await unknownElement.json()) as { error: { message: string } };
      expect(body.error.message).toContain("Unknown diagram node: ghost");

      const malformed = await app.request(`${baseUrl}/api/spotlight`, {
        body: JSON.stringify({ artifactId: "checkout" }),
        headers,
        method: "POST",
      });
      expect(malformed.status).toBe(422);
    } finally {
      await cleanup();
    }
  });

  it("accepts a spotlight from local tooling that sends no browser headers", async () => {
    const { app, channel, cleanup, headers } = await prepare();

    try {
      const response = await app.request(`${baseUrl}/api/spotlight`, {
        body: JSON.stringify(spotlight([])),
        headers,
        method: "POST",
      });
      expect(response.status).toBe(201);
      expect(channel.current()).toEqual(spotlight([]));
    } finally {
      await cleanup();
    }
  });
});
