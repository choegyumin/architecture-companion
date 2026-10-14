import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMemoryHistory } from "@tanstack/react-router";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createDataClient } from "@/client/data-client";
import { createApp } from "@/server/create-app";
import { resolveCompanionScope } from "@/server/resolve-companion-scope";

import { renderWorkspace } from "../../tests/helpers/render-workspace";
import { writeCatalog } from "../../tests/helpers/write-catalog";

const workflowId = ".architecture-companion/artifacts/workflow.archcomp.json";
const secondWorkflowId = ".architecture-companion/artifacts/z-workflow.archcomp.json";
const designId = ".architecture-companion/artifacts/design.archcomp.json";
const secondDesignId = ".architecture-companion/artifacts/z-design.archcomp.json";

function artifact(artifactId: string, type: "behavior" | "design", title: string) {
  return {
    artifactId,
    type,
    title,
    updatedAt: "2026-10-03T09:15:00.000Z",
    generator: "built-in:freeform",
    instructions: "Review the flow.",
    diagram: {
      layout: { layoutId: "general" },
      graph: {
        groups: [],
        nodes: [{ type: "default", nodeId: "alpha", title: "Alpha" }],
        edges: [],
      },
    },
  };
}

async function openWorkspace(entry: string) {
  const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-url-"));
  await writeCatalog(scopePath, {
    artifacts: [
      artifact(workflowId, "behavior", "Workflow"),
      artifact(secondWorkflowId, "behavior", "Z workflow"),
      artifact(designId, "design", "Design"),
      artifact(secondDesignId, "design", "Second design"),
    ],
  });
  const app = createApp(await resolveCompanionScope(scopePath));
  const client = createDataClient("http://architecture-companion.test", async (input, init) =>
    app.request(input, init),
  );
  const history = createMemoryHistory({ initialEntries: [entry] });
  const mounted = await renderWorkspace(client, history);
  return {
    ...mounted,
    dispose: async () => {
      mounted.unmount();
      await rm(scopePath, { recursive: true, force: true });
    },
  };
}

describe("workspace artifact URLs", () => {
  it.each(["/", "/unknown/path", "/artifacts/missing.json"])(
    "replaces %s with the first behavior artifact without adding history",
    async (entry) => {
      const workspace = await openWorkspace(entry);
      try {
        await waitFor(() => expect(workspace.history.location.pathname).toBe(`/artifacts/${workflowId}`));
        await screen.findByRole("region", { name: "Workflow product behavior diagram" });
        expect(workspace.history.length).toBe(1);
      } finally {
        await workspace.dispose();
      }
    },
  );

  it("derives the active category and selected artifact from a direct URL", async () => {
    const workspace = await openWorkspace(`/artifacts/${secondDesignId}`);
    try {
      await screen.findByRole("region", { name: "Second design code design diagram" });
      expect(screen.getByRole("tab", { name: "Code Design" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("button", { name: "Second design" })).toHaveAttribute("aria-current", "page");
    } finally {
      await workspace.dispose();
    }
  });

  it("pushes only artifact changes and chooses the first artifact when returning to a category", async () => {
    const workspace = await openWorkspace(`/artifacts/${workflowId}?q=Alpha`);
    const user = userEvent.setup();
    try {
      await screen.findByRole("region", { name: "Workflow product behavior diagram" });
      await user.click(screen.getByRole("button", { name: "Workflow" }));
      expect(workspace.history.length).toBe(1);
      await user.click(screen.getByRole("button", { name: "Z workflow" }));
      await waitFor(() => expect(workspace.history.location.pathname).toBe(`/artifacts/${secondWorkflowId}`));
      expect(workspace.history.location.search).toBe("");
      expect(workspace.history.length).toBe(2);
      await user.click(screen.getByRole("tab", { name: "Code Design" }));
      await screen.findByRole("region", { name: "Design code design diagram" });
      await user.click(screen.getByRole("tab", { name: "Product Behavior" }));
      await screen.findByRole("region", { name: "Workflow product behavior diagram" });
      expect(workspace.history.location.search).toBe("");
      expect(workspace.history.length).toBe(4);
    } finally {
      await workspace.dispose();
    }
  });

  it("mirrors typing with replace and removes an empty query on Escape", async () => {
    const workspace = await openWorkspace(`/artifacts/${workflowId}`);
    const user = userEvent.setup();
    try {
      const input = await screen.findByRole("combobox", { name: "Search nodes" });
      await user.type(input, "123 한글");
      await waitFor(() => expect(new URLSearchParams(workspace.history.location.search).get("q")).toBe("123 한글"));
      expect(workspace.history.length).toBe(1);
      await user.keyboard("{Escape}");
      await waitFor(() => expect(workspace.history.location.search).toBe(""));
      expect(input).toHaveValue("");
      expect(workspace.history.length).toBe(1);
    } finally {
      await workspace.dispose();
    }
  });

  it("restores the complete URL and search input on back instead of remembering artifact searches", async () => {
    const workspace = await openWorkspace(`/artifacts/${workflowId}?q=Alpha`);
    const user = userEvent.setup();
    try {
      expect(await screen.findByRole("combobox", { name: "Search nodes" })).toHaveValue("Alpha");
      await user.click(screen.getByRole("button", { name: "Z workflow" }));
      await screen.findByRole("region", { name: "Z workflow product behavior diagram" });
      await act(async () => workspace.history.back());
      await screen.findByRole("region", { name: "Workflow product behavior diagram" });
      expect(await screen.findByRole("combobox", { name: "Search nodes" })).toHaveValue("Alpha");
      expect(new URLSearchParams(workspace.history.location.search).get("q")).toBe("Alpha");
    } finally {
      await workspace.dispose();
    }
  });

  it.each(["123", "true", '{"name":"Alpha"}', "한글 + / ? #"])(
    "preserves %s as URL text on direct entry",
    async (query) => {
      const workspace = await openWorkspace(`/artifacts/${workflowId}?q=${encodeURIComponent(query)}`);
      try {
        expect(await screen.findByRole("combobox", { name: "Search nodes" })).toHaveValue(query);
      } finally {
        await workspace.dispose();
      }
    },
  );

  it("preserves a valid query when replacing an unknown artifact", async () => {
    const workspace = await openWorkspace("/artifacts/missing.json?q=Alpha");
    try {
      await waitFor(() => expect(workspace.history.location.pathname).toBe(`/artifacts/${workflowId}`));
      expect(await screen.findByRole("combobox", { name: "Search nodes" })).toHaveValue("Alpha");
      expect(workspace.history.length).toBe(1);
    } finally {
      await workspace.dispose();
    }
  });

  it("removes an empty query without adding a history entry", async () => {
    const workspace = await openWorkspace(`/artifacts/${workflowId}?q=`);
    try {
      await screen.findByRole("region", { name: "Workflow product behavior diagram" });
      await waitFor(() => expect(workspace.history.location.search).toBe(""));
      expect(workspace.history.length).toBe(1);
    } finally {
      await workspace.dispose();
    }
  });
});
