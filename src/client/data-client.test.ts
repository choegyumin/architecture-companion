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
        new Response(JSON.stringify({ artifactRevisionId: "a".repeat(64), document: { annotations: [] } }), {
          status: 200,
        }),
    );
    const client = createDataClient(baseUrl, fetcher);

    await expect(client.getAnnotations()).rejects.toThrow("Annotation response is missing its revision.");
  });

  it("sends the read Artifact revision and ETag with the Annotation save request", async () => {
    const artifactRevisionId = "a".repeat(64);
    const initialDocument = { annotations: [] };
    const savedDocument = {
      annotations: [
        {
          id: "annotation-1",
          anchor: { canvasId: "process:checkout", point: { x: 120, y: 80 } },
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
        return new Response(JSON.stringify({ artifactRevisionId, document: initialDocument }), {
          headers: { ETag: '"initial"' },
        });
      }

      expect(request.headers.get("If-Match")).toBe('"initial"');
      await expect(request.json()).resolves.toEqual({ artifactRevisionId, document: savedDocument });
      return new Response(JSON.stringify({ artifactRevisionId, document: savedDocument }), {
        headers: { ETag: '"saved"' },
      });
    });
    const client = createDataClient(baseUrl, fetcher);
    const initial = await client.getAnnotations();

    expect(initial).toEqual({ artifactRevisionId, document: initialDocument });
    if (initial.document === null) throw new Error("Expected active revision annotations.");
    await expect(client.saveAnnotations(savedDocument, initial.document)).resolves.toEqual(savedDocument);
  });

  it("returns no active Annotation revision when the Artifact is missing or invalid", async () => {
    const fetcher: typeof fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: "Artifact is invalid." } }), {
          status: 422,
        }),
    );
    const client = createDataClient(baseUrl, fetcher);

    await expect(client.getAnnotations()).resolves.toEqual({
      artifactRevisionId: null,
      document: null,
    });
  });

  it("sorts the diagrams of a Review response by title", async () => {
    const diagram = (id: string, title: string) => ({
      id,
      title,
      generatorId: "freeform",
      layout: { id: "elk-layered" },
      graph: { groups: [], nodes: [], edges: [] },
    });
    const fetcher: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            scope: { isGitRepository: false, path: "/consumer" },
            artifact: {
              processes: [diagram("invite", "Invite member"), diagram("checkout", "Checkout workflow")],
              designs: [diagram("structure", "Structure"), diagram("catalog", "Catalog")],
            },
          }),
          { status: 200 },
        ),
    );

    const review = await createDataClient(baseUrl, fetcher).getReview();

    expect(review.artifact?.processes.map(({ title }) => title)).toEqual(["Checkout workflow", "Invite member"]);
    expect(review.artifact?.designs.map(({ title }) => title)).toEqual(["Catalog", "Structure"]);
  });
});
