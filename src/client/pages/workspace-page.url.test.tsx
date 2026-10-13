import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { createDataClient } from "@/client/data-client";
import { WorkspacePage } from "@/client/pages/workspace-page";
import { type AppType, createApp } from "@/server/create-app";
import { resolveCompanionScope } from "@/server/resolve-companion-scope";
import { writeCatalog } from "@/server/write-catalog";

const catalog = {
  artifacts: [
    {
      artifactId: ".architecture-companion/artifacts/invite-member.archcomp.json",
      type: "behavior",
      updatedAt: "2026-10-03T09:15:00.000Z",
      title: "Invite member",
      generator: "built-in:freeform",
      instructions: "## Purpose\nReview member invitations.",
      diagram: {
        layout: { layoutId: "elk-layered" },
        graph: {
          groups: [],
          nodes: [{ type: "default", nodeId: "invite", kind: "trigger", title: "Invitation submitted" }],
          edges: [],
        },
      },
    },
    {
      artifactId: ".architecture-companion/artifacts/checkout-structure.archcomp.json",
      type: "design",
      updatedAt: "2026-10-03T09:15:00.000Z",
      title: "Checkout structure",
      generator: "built-in:freeform",
      instructions: "## Purpose\nReview checkout ownership.",
      diagram: {
        layout: { layoutId: "elk-layered" },
        graph: {
          groups: [],
          nodes: [{ type: "default", nodeId: "checkout-page", kind: "component", title: "Checkout page" }],
          edges: [],
        },
      },
    },
    {
      artifactId: ".architecture-companion/artifacts/settings-structure.archcomp.json",
      type: "design",
      updatedAt: "2026-10-03T09:15:00.000Z",
      title: "Settings structure",
      generator: "built-in:freeform",
      instructions: "## Purpose\nReview settings ownership.",
      diagram: {
        layout: { layoutId: "elk-layered" },
        graph: {
          groups: [],
          nodes: [{ type: "default", nodeId: "settings-page", kind: "component", title: "Settings page" }],
          edges: [],
        },
      },
    },
  ],
};

async function renderWorkspace(initialUrl = "/") {
  const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-url-page-"));
  await writeCatalog(scopePath, catalog);
  const scope = await resolveCompanionScope(scopePath);
  const app: AppType = createApp(scope);
  const client = createDataClient("http://architecture-companion.test", async (input, init) =>
    app.request(input, init),
  );
  const history = createMemoryHistory({ initialEntries: [initialUrl] });
  const view = render(<WorkspacePage client={client} history={history} />);

  return {
    history,
    cleanup: async () => {
      view.unmount();
      await rm(scopePath, { recursive: true });
    },
  };
}

describe("workspace URL routing", () => {
  it("redirects the bare root to the first behavior artifact", async () => {
    const { history, cleanup } = await renderWorkspace("/");

    try {
      expect(await screen.findByRole("button", { name: "Invite member" })).toHaveAttribute("aria-current", "page");
      await waitFor(() => expect(history.location.pathname).toBe("/artifacts/invite-member.archcomp"));
    } finally {
      await cleanup();
    }
  });

  it("renders a deep-linked design artifact", async () => {
    const { history, cleanup } = await renderWorkspace("/artifacts/settings-structure.archcomp");

    try {
      expect(await screen.findByRole("button", { name: "Settings structure" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("tab", { name: "Code Design" })).toHaveAttribute("aria-selected", "true");
      expect(history.location.pathname).toBe("/artifacts/settings-structure.archcomp");
    } finally {
      await cleanup();
    }
  });

  it("pushes artifact selections and restores them through history back", async () => {
    const user = userEvent.setup();
    const { history, cleanup } = await renderWorkspace("/");

    try {
      await screen.findByRole("button", { name: "Invite member" });

      await user.click(screen.getByRole("tab", { name: "Code Design" }));
      await waitFor(() => expect(history.location.pathname).toBe("/artifacts/checkout-structure.archcomp"));

      await user.click(screen.getByRole("button", { name: "Settings structure" }));
      await waitFor(() => expect(history.location.pathname).toBe("/artifacts/settings-structure.archcomp"));

      history.back();
      await waitFor(() => {
        expect(history.location.pathname).toBe("/artifacts/checkout-structure.archcomp");
        expect(screen.getByRole("button", { name: "Checkout structure" })).toHaveAttribute("aria-current", "page");
      });
    } finally {
      await cleanup();
    }
  });

  it("redirects an unknown stem to the first artifact", async () => {
    const { history, cleanup } = await renderWorkspace("/artifacts/nope");

    try {
      expect(await screen.findByRole("button", { name: "Invite member" })).toHaveAttribute("aria-current", "page");
      await waitFor(() => expect(history.location.pathname).toBe("/artifacts/invite-member.archcomp"));
    } finally {
      await cleanup();
    }
  });

  it("switches to the first design artifact through the design tab", async () => {
    const user = userEvent.setup();
    const { history, cleanup } = await renderWorkspace("/");

    try {
      expect(await screen.findByRole("button", { name: "Invite member" })).toHaveAttribute("aria-current", "page");

      await user.click(screen.getByRole("tab", { name: "Code Design" }));

      await waitFor(() => {
        expect(history.location.pathname).toBe("/artifacts/checkout-structure.archcomp");
        expect(screen.getByRole("tab", { name: "Code Design" })).toHaveAttribute("aria-selected", "true");
      });
    } finally {
      await cleanup();
    }
  });
});
