import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { render, screen } from "@testing-library/react";

import { createDataClient } from "@/client/data-client";
import { WorkspacePage } from "@/client/pages/workspace-page";
import { createApp } from "@/server/create-app";
import { resolveConsumerScope } from "@/server/resolve-consumer-scope";

function isReviewEventRequest(input: RequestInfo | URL): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(url).pathname === "/api/review/events";
}

describe("local review scope", () => {
  it("keeps the workspace shell even when the Hono app has an empty review state", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "architecture-companion-"));

    try {
      const scope = await resolveConsumerScope(temporaryRoot);
      const app = createApp(scope);
      const client = createDataClient("http://architecture-companion.test", async (input, init) =>
        app.request(input, init),
      );

      render(<WorkspacePage client={client} />);

      expect(await screen.findByRole("heading", { name: /Architecture Companion/ })).toHaveTextContent(
        basename(temporaryRoot),
      );
      expect(screen.getByRole("button", { name: "Toggle theme" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Process" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Comment" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "No review artifacts yet" })).toBeInTheDocument();
    } finally {
      await rm(temporaryRoot, { recursive: true });
    }
  });

  it("shows an actionable error when the RPC connection fails", async () => {
    const client = createDataClient("http://architecture-companion.test", async (input) => {
      if (isReviewEventRequest(input)) return new Response("");
      throw new Error("Connection refused");
    });

    render(<WorkspacePage client={client} />);

    expect(screen.getByText("Loading review…")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection refused");
  });

  it("shows the HTTP status when the RPC rejects the review", async () => {
    const client = createDataClient("http://architecture-companion.test", async (input) => {
      if (isReviewEventRequest(input)) return new Response("");
      return new Response(null, { status: 503 });
    });

    render(<WorkspacePage client={client} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Review request failed with status 503.");
  });
});
