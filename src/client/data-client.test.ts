import { describe, expect, it, vi } from "vitest";

import { createDataClient } from "@/client/data-client";

const baseUrl = "http://architecture-companion.test";

function createSseResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });

  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

describe("DataClient", () => {
  it("delivers a parsed spotlight event to the spotlight callback", async () => {
    const walkthrough = {
      artifactId: ".architecture-companion/artifacts/checkout-workflow.archcomp.json",
      diagram: { steps: [{ elements: [{ type: "node", id: "submit" }], caption: "The submit trigger." }] },
    };
    const fetcher: typeof fetch = vi.fn(async () =>
      createSseResponse([
        'event: review\r\ndata: {"revision":0}\r\n\r\n',
        `event: spotlight\r\ndata: ${JSON.stringify(walkthrough)}\r\n\r\n`,
      ]),
    );
    const onUpdate = vi.fn();
    const onSpotlight = vi.fn();
    const unsubscribe = createDataClient(baseUrl, fetcher).subscribeToReviewUpdates(onUpdate, undefined, onSpotlight);

    try {
      await vi.waitFor(() => expect(onSpotlight).toHaveBeenCalledOnce());
      expect(onSpotlight).toHaveBeenCalledWith(walkthrough);
      expect(onUpdate).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
    }
  });

  it("ignores malformed and invalid spotlight events without breaking the review stream", async () => {
    const fetcher: typeof fetch = vi.fn(async () =>
      createSseResponse([
        "event: spotlight\r\ndata: {broken\r\n\r\n",
        'event: spotlight\r\ndata: {"artifactId":".architecture-companion/artifacts/checkout-workflow.archcomp.json","diagram":{"steps":[{"elements":[]}]}}\r\n\r\n',
        'event: review\r\ndata: {"revision":0}\r\n\r\n',
      ]),
    );
    const onUpdate = vi.fn();
    const onError = vi.fn();
    const onSpotlight = vi.fn();
    const unsubscribe = createDataClient(baseUrl, fetcher).subscribeToReviewUpdates(onUpdate, onError, onSpotlight);

    try {
      await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledOnce());
      expect(onSpotlight).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("reports a throwing spotlight callback through the stream error boundary", async () => {
    const walkthrough = {
      artifactId: ".architecture-companion/artifacts/checkout-workflow.archcomp.json",
      diagram: { steps: [{ elements: [], caption: "The whole flow." }] },
    };
    const fetcher: typeof fetch = vi.fn(async () =>
      createSseResponse([`event: spotlight\r\ndata: ${JSON.stringify(walkthrough)}\r\n\r\n`]),
    );
    const onSpotlight = vi.fn(() => {
      throw new Error("Spotlight consumer failed.");
    });
    const onError = vi.fn();
    const unsubscribe = createDataClient(baseUrl, fetcher).subscribeToReviewUpdates(vi.fn(), onError, onSpotlight);

    try {
      await vi.waitFor(() => expect(onSpotlight).toHaveBeenCalledOnce());
      await vi.waitFor(() =>
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Spotlight consumer failed." })),
      );
    } finally {
      unsubscribe();
    }
  });

  it("ignores malformed SSE data and delivers only review events", async () => {
    const fetcher: typeof fetch = vi.fn(async () =>
      createSseResponse(["event: unrelated\r\ndata: {broken\r\n\r\n", "event: review\r\ndata: {broken}\r\n\r\n"]),
    );
    const onUpdate = vi.fn();
    const onError = vi.fn();
    const unsubscribe = createDataClient(baseUrl, fetcher).subscribeToReviewUpdates(onUpdate, onError);

    try {
      await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledOnce());
      expect(onError).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("does not report an AbortError from an unsubscribed request as an error", async () => {
    const fetcher: typeof fetch = vi.fn(async () => {
      await Promise.resolve();
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    const onError = vi.fn();
    const unsubscribe = createDataClient(baseUrl, fetcher).subscribeToReviewUpdates(vi.fn(), onError);
    unsubscribe();

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).not.toHaveBeenCalled();
  });

  it("cannot read comments when the response has no ETag", async () => {
    const fetcher: typeof fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ catalogRevisionId: "a".repeat(64), document: { annotations: [] } }), {
          status: 200,
        }),
    );
    const client = createDataClient(baseUrl, fetcher);

    await expect(client.getAnnotations()).rejects.toThrow("Annotation response is missing its revision.");
  });

  it("sends the read Catalog revision and ETag with the Annotation save request", async () => {
    const catalogRevisionId = "a".repeat(64);
    const initialDocument = { annotations: [] };
    const savedDocument = {
      annotations: [
        {
          id: "annotation-1",
          anchor: {
            canvasId: "behavior:.architecture-companion/artifacts/checkout-workflow.archcomp.json",
            point: { x: 120, y: 80 },
          },
          comment: {
            id: "comment-1",
            author: { id: "reviewer", name: "Reviewer" },
            body: "Review this area.",
            createdAt: "2026-08-28T00:00:00.000Z",
          },
        },
      ],
    };
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "GET") {
        return new Response(JSON.stringify({ catalogRevisionId, document: initialDocument }), {
          headers: { ETag: '"initial"' },
        });
      }

      expect(request.headers.get("If-Match")).toBe('"initial"');
      await expect(request.json()).resolves.toEqual({ catalogRevisionId, document: savedDocument });
      return new Response(JSON.stringify({ catalogRevisionId, document: savedDocument }), {
        headers: { ETag: '"saved"' },
      });
    });
    const client = createDataClient(baseUrl, fetcher);
    const initial = await client.getAnnotations();

    expect(initial).toEqual({ catalogRevisionId, document: initialDocument });
    if (initial.document === null) throw new Error("Expected active revision annotations.");
    await expect(client.saveAnnotations(savedDocument, initial.document)).resolves.toEqual(savedDocument);
  });

  it("returns no active Annotation revision when the Catalog is missing or invalid", async () => {
    const fetcher: typeof fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: "Catalog is invalid." } }), {
          status: 422,
        }),
    );
    const client = createDataClient(baseUrl, fetcher);

    await expect(client.getAnnotations()).resolves.toEqual({
      catalogRevisionId: null,
      document: null,
    });
  });

  it("sorts the diagrams of a Review response by title", async () => {
    const diagram = (type: "behavior" | "design", id: string, title: string) => ({
      artifactId: id,
      type,
      updatedAt: "2026-10-03T09:15:00.000Z",
      title,
      generator: "built-in:freeform",
      instructions: `## Purpose\nReview ${title}.\n\n## Regeneration\nRebuild the ${id} diagram from its current workflow or component boundary.`,
      diagram: {
        layout: { layoutId: "general" },
        graph: { groups: [], nodes: [{ nodeId: "start", type: "default", title: "Start" }], edges: [] },
      },
    });
    const fetcher: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            scope: { isGitRepository: false, path: "/consumer" },
            catalog: {
              artifacts: [
                diagram("behavior", ".architecture-companion/artifacts/invite-member.archcomp.json", "Invite member"),
                diagram(
                  "behavior",
                  ".architecture-companion/artifacts/checkout-workflow.archcomp.json",
                  "Checkout workflow",
                ),
                diagram("design", ".architecture-companion/artifacts/structure.archcomp.json", "Structure"),
                diagram("design", ".architecture-companion/artifacts/catalog.archcomp.json", "Catalog"),
              ],
            },
          }),
          { status: 200 },
        ),
    );

    const review = await createDataClient(baseUrl, fetcher).getReview();

    expect(review.catalog?.artifacts.map(({ title }) => title)).toEqual([
      "Catalog",
      "Checkout workflow",
      "Invite member",
      "Structure",
    ]);
  });
});
