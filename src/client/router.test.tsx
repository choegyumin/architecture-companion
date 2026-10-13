import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMemoryHistory } from "@tanstack/react-router";
import { act, createEvent, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createDataClient } from "@/client/data-client";
import { createApp } from "@/server/create-app";
import { resolveCompanionScope } from "@/server/resolve-companion-scope";

import { renderWorkspace } from "../../tests/helpers/render-workspace";
import { waitForDiagramReady } from "../../tests/helpers/wait-for-diagram";
import { writeCatalog } from "../../tests/helpers/write-catalog";

const mocks = vi.hoisted(() => ({ platform: { os: { mac: false } } }));

vi.mock("@base-ui/utils/platform", () => ({ platform: mocks.platform }));

const workflowId = ".architecture-companion/artifacts/workflow.archcomp.json";
const secondWorkflowId = ".architecture-companion/artifacts/z-workflow.archcomp.json";
const designId = ".architecture-companion/artifacts/design.archcomp.json";
const secondDesignId = ".architecture-companion/artifacts/z-design.archcomp.json";
const dependencyId = ".architecture-companion/artifacts/dependencies.archcomp.json";

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
        groups: [{ groupId: "alpha-boundary", title: "Alpha boundary" }],
        nodes: [
          { type: "default", nodeId: "alpha", title: "Alpha" },
          { type: "default", nodeId: "alpha-relay", title: "Alpha relay", groupId: "alpha-boundary" },
        ],
        edges: [],
      },
    },
  };
}

function dependencyGraphArtifact() {
  return {
    artifactId: dependencyId,
    type: "design" as const,
    title: "Dependencies",
    updatedAt: "2026-10-03T09:15:00.000Z",
    generator: "built-in:freeform",
    instructions: "Review the dependencies.",
    diagram: {
      layout: { layoutId: "dependency-graph" },
      graph: {
        groups: [{ groupId: "service", title: "Service layer" }],
        nodes: [
          { type: "default", nodeId: "alpha", title: "Alpha service", groupId: "service" },
          { type: "default", nodeId: "beta", title: "Beta service", groupId: "service" },
        ],
        edges: [],
      },
    },
  };
}

type FixtureArtifact = ReturnType<typeof artifact> | ReturnType<typeof dependencyGraphArtifact>;

const catalogArtifacts: readonly FixtureArtifact[] = [
  artifact(workflowId, "behavior", "Workflow"),
  artifact(secondWorkflowId, "behavior", "Z workflow"),
  artifact(designId, "design", "Design"),
  artifact(secondDesignId, "design", "Second design"),
];

async function openWorkspace(entry: string, artifacts: readonly FixtureArtifact[] = catalogArtifacts) {
  const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-url-"));
  await writeCatalog(scopePath, { artifacts });
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

function flowNode(id: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
  if (!node) throw new Error(`Missing React Flow node: ${id}`);
  return node;
}

describe("workspace search shortcut", () => {
  beforeEach(() => {
    mocks.platform.os.mac = false;
  });

  it.each([
    {
      os: "macOS",
      mac: true,
      modifier: { metaKey: true },
      wrongModifier: { ctrlKey: true },
      shortcut: "⌘K",
    },
    {
      os: "Windows/Linux",
      mac: false,
      modifier: { ctrlKey: true },
      wrongModifier: { metaKey: true },
      shortcut: "Ctrl+K",
    },
  ])(
    "focuses the advertised search input with the $os shortcut and unsubscribes on unmount",
    async ({ mac, modifier, wrongModifier, shortcut }) => {
      mocks.platform.os.mac = mac;
      const workspace = await openWorkspace(`/artifacts/${workflowId}`);
      try {
        const input = await screen.findByRole("combobox", { name: "Search nodes" });
        expect(screen.getByText(shortcut)).toBeVisible();

        expect(fireEvent.keyDown(document, { key: "k", ...wrongModifier })).toBe(true);
        expect(input).not.toHaveFocus();

        expect(fireEvent.keyDown(document, { key: "k", ...modifier })).toBe(false);
        expect(input).toHaveFocus();
      } finally {
        await workspace.dispose();
      }

      expect(fireEvent.keyDown(document, { key: "k", ...modifier })).toBe(true);
    },
  );

  it.each([
    { key: "k" },
    { key: "j", ctrlKey: true },
    { key: "k", ctrlKey: true, metaKey: true },
    { key: "k", ctrlKey: true, altKey: true },
    { key: "k", ctrlKey: true, shiftKey: true },
    { key: "k", ctrlKey: true, repeat: true },
    { key: "k", ctrlKey: true, isComposing: true },
  ])("does not intercept unrelated or conflicting key events: %j", async (event) => {
    const workspace = await openWorkspace(`/artifacts/${workflowId}`);
    try {
      const input = await screen.findByRole("combobox", { name: "Search nodes" });

      expect(fireEvent.keyDown(document, event)).toBe(true);
      expect(input).not.toHaveFocus();
    } finally {
      await workspace.dispose();
    }
  });

  it("does not steal focus from an already-prevented event", async () => {
    const workspace = await openWorkspace(`/artifacts/${workflowId}`);
    try {
      const input = await screen.findByRole("combobox", { name: "Search nodes" });

      const event = createEvent.keyDown(document, { key: "k", ctrlKey: true });
      event.preventDefault();
      fireEvent(document, event);
      expect(input).not.toHaveFocus();
    } finally {
      await workspace.dispose();
    }
  });
});

describe("workspace diagram search", () => {
  it("highlights every matching node and group, marks the visited match, and keeps the query on confirm", async () => {
    const workspace = await openWorkspace(`/artifacts/${workflowId}`);
    const user = userEvent.setup();
    try {
      const input = await screen.findByRole("combobox", { name: "Search nodes" });
      await waitForDiagramReady();
      const boundary = flowNode("alpha-boundary");
      const alpha = flowNode("alpha");
      const relay = flowNode("alpha-relay");

      await user.type(input, "Alpha");
      expect(screen.getByRole("option", { name: "Alpha boundary" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Alpha" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Alpha relay" })).toBeInTheDocument();
      expect(screen.getByText("0/3")).toBeVisible();
      expect(boundary).toHaveClass("is-search-match");
      expect(alpha).toHaveClass("is-search-match");
      expect(relay).toHaveClass("is-search-match");
      expect(boundary).not.toHaveClass("is-search-current");
      expect(alpha).not.toHaveClass("is-search-current");
      expect(relay).not.toHaveClass("is-search-current");

      await user.keyboard("{ArrowDown}");
      expect(boundary).toHaveClass("is-search-current");
      expect(alpha).not.toHaveClass("is-search-current");
      expect(screen.getByText("1/3")).toBeVisible();

      await user.keyboard("{ArrowDown}");
      expect(relay).toHaveClass("is-search-current");
      expect(boundary).not.toHaveClass("is-search-current");
      expect(alpha).not.toHaveClass("is-search-current");
      expect(boundary).not.toHaveClass("is-search-current");

      await user.keyboard("{Enter}");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(input).toHaveValue("Alpha");
      expect(new URLSearchParams(workspace.history.location.search).get("q")).toBe("Alpha");
      expect(boundary).not.toHaveClass("is-search-match", "is-search-current");
      expect(alpha).not.toHaveClass("is-search-match", "is-search-current");
      expect(relay).not.toHaveClass("is-search-match", "is-search-current");

      await user.keyboard("{Escape}");
      expect(input).toHaveValue("");
      await waitFor(() => expect(workspace.history.location.search).toBe(""));
    } finally {
      await workspace.dispose();
    }
  });

  it("focuses the searched dependency-graph element through the active indicator", async () => {
    const workspace = await openWorkspace(`/artifacts/${dependencyId}`, [dependencyGraphArtifact()]);
    const user = userEvent.setup();
    try {
      await screen.findByRole("region", { name: "Dependencies code design diagram" });
      await waitForDiagramReady();
      const input = screen.getByRole("combobox", { name: "Search nodes" });

      await user.type(input, "service");
      await user.keyboard("{ArrowDown}");
      expect(await screen.findByRole("status")).toHaveTextContent("Focused on Service layer");

      await user.keyboard("{ArrowDown}");
      expect(await screen.findByRole("status")).toHaveTextContent("Focused on Alpha service");

      await user.keyboard("{Enter}");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(await screen.findByRole("status")).toHaveTextContent("Focused on Alpha service");

      await user.click(screen.getByRole("button", { name: "Clear focus" }));
      await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    } finally {
      await workspace.dispose();
    }
  });
});
