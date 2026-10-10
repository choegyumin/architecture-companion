import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { createDataClient } from "@/client/data-client";
import { WorkspacePage } from "@/client/pages/workspace-page";
import { type AppType, createApp } from "@/server/create-app";
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
      diagram: {
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
    },
  ],
  designs: [
    {
      id: "checkout-structure",
      updatedAt: "2026-10-03T09:15:00.000Z",
      title: "Checkout structure",
      generator: "built-in:freeform",
      instructions: "## Purpose\nReview checkout ownership.",
      diagram: {
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
    },
    {
      id: "settings-structure",
      updatedAt: "2026-10-03T09:15:00.000Z",
      title: "Settings structure",
      generator: "built-in:freeform",
      instructions: "## Purpose\nReview settings ownership.",
      diagram: {
        layout: { id: "elk-layered" },
        graph: {
          groups: [],
          nodes: [{ type: "default", id: "settings-page", kind: "component", title: "Settings page" }],
          edges: [],
        },
      },
    },
  ],
};

const designSpotlight = {
  artifactId: "checkout-structure",
  diagram: {
    steps: [
      { elements: [{ type: "node", id: "checkout-page" }], caption: "Checkout page owns the flow" },
      { elements: [{ type: "node", id: "payment-client" }], caption: "Payment client is composed in" },
    ],
  },
};

const sequenceCatalog = {
  behaviors: [
    {
      id: "review-session",
      updatedAt: "2026-10-03T09:15:00.000Z",
      title: "Review session",
      generator: "built-in:freeform",
      instructions: "## Purpose\nReview the review session flow.",
      diagram: {
        layout: { id: "sequence" },
        graph: {
          groups: [],
          nodes: [
            {
              type: "lifeline",
              id: "user",
              kind: "actor",
              title: "User",
              links: [],
              activations: [],
            },
            {
              type: "lifeline",
              id: "server",
              kind: "participant",
              title: "Server",
              links: [],
              activations: [],
            },
          ],
          edges: [{ type: "message", id: "m1", source: "user", target: "server", label: "POST", messageType: "sync" }],
        },
      },
    },
  ],
  designs: [],
};

async function renderWorkspace(catalogContents: typeof catalog | typeof sequenceCatalog = catalog) {
  const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-spotlight-page-"));
  await writeCatalog(scopePath, catalogContents);
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
  it("opens the spotlighted artifact on its first step with the pill", async () => {
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
      expect(screen.getByRole("status")).toHaveTextContent("Checkout page owns the flow");
      expect(screen.getByRole("status")).toHaveTextContent("1/2");
    } finally {
      await cleanup();
    }
  });

  it("moves between steps through the pill", async () => {
    const user = userEvent.setup();
    const { app, cleanup } = await renderWorkspace();

    try {
      await publishSpotlight(app, designSpotlight);
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1/2"));

      await user.click(screen.getByRole("button", { name: "Next step" }));

      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2/2"));
      expect(screen.getByRole("status")).toHaveTextContent("Payment client is composed in");
      await waitFor(() => {
        expect(document.querySelector(".diagram-spotlight-emphasized")?.textContent).toContain("Payment client");
      });
    } finally {
      await cleanup();
    }
  });

  it("clears the spotlight from the pill's close button", async () => {
    const user = userEvent.setup();
    const { app, cleanup } = await renderWorkspace();

    try {
      await publishSpotlight(app, designSpotlight);
      await waitFor(() => expect(document.querySelector(".diagram-spotlight-emphasized")).not.toBeNull());

      await user.click(screen.getByRole("button", { name: "Close spotlight" }));

      await waitFor(() => expect(document.querySelector(".diagram-spotlight-emphasized")).toBeNull());
      expect(document.querySelector(".diagram-spotlight-dimmed")).toBeNull();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } finally {
      await cleanup();
    }
  });

  it("replaces an earlier spotlight with the newest ping", async () => {
    const { app, cleanup } = await renderWorkspace();

    try {
      await publishSpotlight(app, designSpotlight);
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "Code Design" })).toHaveAttribute("aria-selected", "true"),
      );

      await publishSpotlight(app, {
        artifactId: "invite-member",
        diagram: { steps: [{ elements: [{ type: "edge", id: "invite-delivered" }] }] },
      });

      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "Product Behavior" })).toHaveAttribute("aria-selected", "true"),
      );
      expect(screen.getByRole("button", { name: "Invite member" })).toHaveAttribute("aria-current", "page");
    } finally {
      await cleanup();
    }
  });

  it("keeps the spotlight while the reviewer browses other artifacts", async () => {
    const user = userEvent.setup();
    const { app, cleanup } = await renderWorkspace();

    try {
      await publishSpotlight(app, designSpotlight);
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1/2"));
      await user.click(screen.getByRole("button", { name: "Next step" }));
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2/2"));

      await user.click(screen.getByRole("button", { name: "Settings structure" }));

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Settings structure" })).toHaveAttribute("aria-current", "page"),
      );
      expect(document.querySelector(".diagram-spotlight-emphasized")).toBeNull();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Checkout structure" }));

      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2/2"));
      expect(screen.getByRole("status")).toHaveTextContent("Payment client is composed in");
      await waitFor(() => {
        expect(document.querySelector(".diagram-spotlight-emphasized")).not.toBeNull();
      });
    } finally {
      await cleanup();
    }
  });

  it("emphasizes a spotlighted sequence lifeline", async () => {
    // happy-dom measures no real layout, so React Flow never renders edge
    // elements there; edge emphasis is covered by the applySpotlight unit
    // tests. This end-to-end case verifies the sequence pipeline itself.
    const { app, cleanup } = await renderWorkspace(sequenceCatalog);

    try {
      await publishSpotlight(app, {
        artifactId: "review-session",
        diagram: { steps: [{ elements: [{ type: "node", id: "user" }], caption: "The user drives the session" }] },
      });

      expect(await screen.findByRole("button", { name: "Review session" })).toHaveAttribute("aria-current", "page");
      await waitFor(() => {
        expect(document.querySelector(".react-flow__node.diagram-spotlight-emphasized")?.textContent).toContain("User");
      });
      expect(document.querySelector(".react-flow__node.diagram-spotlight-dimmed")?.textContent).toContain("Server");
      expect(screen.getByRole("status")).toHaveTextContent("The user drives the session");
    } finally {
      await cleanup();
    }
  });
});
