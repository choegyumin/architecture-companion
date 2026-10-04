import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { render, screen, waitFor } from "@testing-library/react";

import { createDataClient } from "@/client/data-client";
import { WorkspacePage } from "@/client/pages/workspace-page";
import { createApp, type AppType } from "@/server/create-app";
import { resolveCompanionScope } from "@/server/resolve-companion-scope";
import { writeCatalog } from "@/server/write-catalog";

const catalog = {
  behaviors: [
    {
      id: "invite-member",
      updatedAt: "2026-10-03T09:15:00.000Z",
      title: "Invite member",
      generator: "built-in:freeform",
      instructions: "## Purpose\nReview member invitations.",
      layout: { id: "elk-layered" },
      graph: {
        groups: [],
        nodes: [
          { type: "default", id: "invite", kind: "trigger", title: "Invitation submitted" },
          { type: "default", id: "delivered", kind: "result", title: "Invitation delivered" },
        ],
        edges: [{ type: "default", id: "invite-delivered", source: "invite", target: "delivered" }],
      },
    },
  ],
  designs: [
    {
      id: "checkout-structure",
      updatedAt: "2026-10-03T09:15:00.000Z",
      title: "Checkout structure",
      generator: "built-in:freeform",
      instructions: "## Purpose\nReview checkout ownership.",
      layout: { id: "elk-layered" },
      graph: {
        groups: [],
        nodes: [
          { type: "default", id: "checkout-page", kind: "component", title: "Checkout page" },
          { type: "default", id: "payment-client", kind: "client", title: "Payment client" },
        ],
        edges: [{ type: "default", id: "uses-payment-client", source: "checkout-page", target: "payment-client" }],
      },
    },
  ],
};

const designSpotlight = {
  artifactId: "checkout-structure",
  diagram: { elements: [{ type: "node", id: "checkout-page" }] },
};

async function renderWorkspace() {
  const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-spotlight-page-"));
  await writeCatalog(scopePath, catalog);
  const scope = await resolveCompanionScope(scopePath);
  const app: AppType = createApp(scope);
  const client = createDataClient("http://architecture-companion.test", async (input, init) =>
    app.request(input, init),
  );
  const view = render(<WorkspacePage client={client} />);

  return {
    app,
    cleanup: async () => {
      view.unmount();
      await rm(scopePath, { recursive: true });
    },
  };
}

async function publishSpotlight(app: AppType, body: unknown) {
  const response = await app.request("http://architecture-companion.test/api/spotlight", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Spotlight publish failed: ${response.status}`);
}

describe("workspace spotlight", () => {
  it("opens the spotlighted design artifact and emphasizes its elements", async () => {
    const { app, cleanup } = await renderWorkspace();

    try {
      expect(await screen.findByRole("tab", { name: "Product Behavior" })).toHaveAttribute("aria-selected", "true");

      await publishSpotlight(app, designSpotlight);

      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "Code Design" })).toHaveAttribute("aria-selected", "true"),
      );
      expect(screen.getByRole("button", { name: "Checkout structure" })).toHaveAttribute("aria-current", "page");
      await waitFor(() => {
        expect(document.querySelector(".diagram-spotlight-emphasized")).not.toBeNull();
        expect(document.querySelector(".diagram-spotlight-dimmed")).not.toBeNull();
      });
    } finally {
      await cleanup();
    }
  });

  it("clears the emphasis when the spotlight is deleted", async () => {
    const { app, cleanup } = await renderWorkspace();

    try {
      await publishSpotlight(app, designSpotlight);
      await waitFor(() => expect(document.querySelector(".diagram-spotlight-emphasized")).not.toBeNull());

      const response = await app.request("http://architecture-companion.test/api/spotlight", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      expect(response.status).toBe(200);

      await waitFor(() => expect(document.querySelector(".diagram-spotlight-emphasized")).toBeNull());
      expect(document.querySelector(".diagram-spotlight-dimmed")).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it("switches back to a behavior artifact spotlight", async () => {
    const { app, cleanup } = await renderWorkspace();

    try {
      await publishSpotlight(app, designSpotlight);
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "Code Design" })).toHaveAttribute("aria-selected", "true"),
      );

      await publishSpotlight(app, {
        artifactId: "invite-member",
        diagram: { elements: [{ type: "edge", id: "invite-delivered" }] },
      });

      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "Product Behavior" })).toHaveAttribute("aria-selected", "true"),
      );
      expect(screen.getByRole("button", { name: "Invite member" })).toHaveAttribute("aria-current", "page");
    } finally {
      await cleanup();
    }
  });
});
