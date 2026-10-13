// @vitest-environment node
//
// The default happy-dom test environment silently drops forbidden request
// headers such as Origin and Sec-Fetch-Site, so the spotlight guard is
// verified here under Node's fetch implementation, which preserves them.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDataClient } from "@/client/data-client";
import type { CompanionCatalog } from "@/features/catalog/catalog";
import type { ArtifactWalkthrough } from "@/features/walkthrough/artifact-walkthrough";
import type { CompanionScope } from "@/server/companion-scope";
import { createApp } from "@/server/create-app";
import { createReviewUpdates, type ReviewUpdates } from "@/server/review-updates";

import { writeCatalog } from "../../tests/helpers/write-catalog";

const baseUrl = "http://architecture-companion.test";
const artifactId = ".architecture-companion/artifacts/checkout-workflow.archcomp.json";

function catalog(title: string): CompanionCatalog {
  return {
    artifacts: [
      {
        title,
        updatedAt: "2026-10-03T09:15:00.000Z",
        generator: "built-in:freeform",
        instructions: "## Purpose\nReview the checkout trigger.",
        diagram: {
          layout: { layoutId: "general" },
          graph: {
            groups: [],
            nodes: [{ type: "default", nodeId: "submit", kind: "trigger", title: "Submit" }],
            edges: [],
          },
        },
        artifactId,
        type: "behavior",
      },
    ],
  };
}

const validWalkthrough = {
  artifactId,
  diagram: { steps: [{ elements: [{ type: "node", id: "submit" }], caption: "The submit trigger." }] },
};

async function postSpotlight(
  app: ReturnType<typeof createApp>,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): Promise<Response> {
  return app.request(`${baseUrl}/api/spotlight`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });
}

async function createSpotlightScope(catalogToWrite?: CompanionCatalog): Promise<string> {
  const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-spotlight-"));
  await mkdir(join(scopePath, ".architecture-companion"), { recursive: true });
  if (catalogToWrite) await writeCatalog(scopePath, catalogToWrite);
  return scopePath;
}

describe("spotlight server", () => {
  it("accepts an origin-less request, validates it, and returns it as the spotlight", async () => {
    const scopePath = await createSpotlightScope(catalog("Workflow"));
    const app = createApp({ isGitRepository: false, path: scopePath } satisfies CompanionScope);

    try {
      const response = await postSpotlight(app, validWalkthrough);

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({ spotlight: validWalkthrough });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("rejects a foreign origin or a cross-site request", async () => {
    const scopePath = await createSpotlightScope(catalog("Workflow"));
    const app = createApp({ isGitRepository: false, path: scopePath } satisfies CompanionScope);

    try {
      const foreignOrigin = await postSpotlight(app, validWalkthrough, { Origin: "http://elsewhere.test" });
      expect(foreignOrigin.status).toBe(403);

      const crossSite = await postSpotlight(app, validWalkthrough, { "Sec-Fetch-Site": "cross-site" });
      expect(crossSite.status).toBe(403);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("rejects a malformed walkthrough with the failing field paths", async () => {
    const scopePath = await createSpotlightScope(catalog("Workflow"));
    const app = createApp({ isGitRepository: false, path: scopePath } satisfies CompanionScope);

    try {
      const response = await postSpotlight(app, {
        artifactId,
        diagram: { steps: [{ elements: [] }] },
      });

      expect(response.status).toBe(422);
      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toBe(
        "Invalid artifact walkthrough: diagram.steps[0].caption: Invalid input: expected string, received undefined",
      );
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("rejects a walkthrough that addresses elements outside the catalog", async () => {
    const scopePath = await createSpotlightScope(catalog("Workflow"));
    const app = createApp({ isGitRepository: false, path: scopePath } satisfies CompanionScope);

    try {
      const response = await postSpotlight(app, {
        artifactId,
        diagram: {
          steps: [
            {
              elements: [
                { type: "node", id: "submit" },
                { type: "node", id: "missing" },
              ],
              caption: "Step.",
            },
          ],
        },
      });

      expect(response.status).toBe(422);
      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toBe(
        `Walkthrough does not match artifact ${artifactId}: Step 1: unknown diagram node: missing`,
      );
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("reports a missing catalog as unavailable for spotlighting", async () => {
    const scopePath = await createSpotlightScope();
    const app = createApp({ isGitRepository: false, path: scopePath } satisfies CompanionScope);

    try {
      const response = await postSpotlight(app, validWalkthrough);

      expect(response.status).toBe(404);
      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toBe("Catalog is unavailable. Spotlight has no artifact to address.");
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("reports an invalid catalog instead of spotlighting against it", async () => {
    const scopePath = await createSpotlightScope();
    await mkdir(join(scopePath, ".architecture-companion/artifacts"), { recursive: true });
    await writeFile(join(scopePath, ".architecture-companion/artifacts/broken.archcomp.json"), "{not json");
    const app = createApp({ isGitRepository: false, path: scopePath } satisfies CompanionScope);

    try {
      const response = await postSpotlight(app, validWalkthrough);

      expect(response.status).toBe(422);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("delivers a spotlight once over the event stream and keeps review events flowing", async () => {
    const scopePath = await createSpotlightScope(catalog("Workflow"));
    let updates: ReviewUpdates | undefined;
    let unsubscribe: () => void = () => undefined;

    try {
      updates = await createReviewUpdates(scopePath, { pollIntervalMs: 5 });
      const app = createApp({ isGitRepository: false, path: scopePath }, { reviewUpdates: updates });
      const client = createDataClient(baseUrl, async (input, init) => app.request(input, init));
      const onReview = vi.fn();
      const onSpotlight = vi.fn<(walkthrough: ArtifactWalkthrough) => void>();

      unsubscribe = client.subscribeToReviewUpdates(onReview, undefined, onSpotlight);
      await vi.waitFor(() => expect(onReview).toHaveBeenCalledOnce());
      expect(onSpotlight).not.toHaveBeenCalled();

      const response = await postSpotlight(app, validWalkthrough, { Origin: baseUrl });
      expect(response.status).toBe(201);
      await vi.waitFor(() => expect(onSpotlight).toHaveBeenCalledOnce());
      expect(onSpotlight).toHaveBeenCalledExactlyOnceWith(validWalkthrough);

      await writeCatalog(scopePath, catalog("Checkout started"));
      await vi.waitFor(() => expect(onReview).toHaveBeenCalledTimes(2));
    } finally {
      unsubscribe();
      await updates?.close();
      await rm(scopePath, { recursive: true });
    }
  });

  it("does not replay an earlier spotlight to a viewer that connects later", async () => {
    const scopePath = await createSpotlightScope(catalog("Workflow"));
    let updates: ReviewUpdates | undefined;
    let unsubscribe: () => void = () => undefined;

    try {
      updates = await createReviewUpdates(scopePath, { pollIntervalMs: 5 });
      const app = createApp({ isGitRepository: false, path: scopePath }, { reviewUpdates: updates });

      const response = await postSpotlight(app, validWalkthrough);
      expect(response.status).toBe(201);

      const client = createDataClient(baseUrl, async (input, init) => app.request(input, init));
      const onReview = vi.fn();
      const onSpotlight = vi.fn();
      unsubscribe = client.subscribeToReviewUpdates(onReview, undefined, onSpotlight);

      await vi.waitFor(() => expect(onReview).toHaveBeenCalledOnce());
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(onSpotlight).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
      await updates?.close();
      await rm(scopePath, { recursive: true });
    }
  });
});
