import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createDataClient } from "@/client/data-client";
import { WorkspacePage } from "@/client/pages/workspace-page";
import { createApp } from "@/server/create-app";
import { ARTIFACTS_RELATIVE_PATH } from "@/server/read-catalog";
import { resolveCompanionScope } from "@/server/resolve-companion-scope";
import { writeCatalog } from "@/server/write-catalog";

const checkoutDiagram = {
  artifactId: ".architecture-companion/artifacts/checkout-structure.archcomp.json",
  kind: "design",
  updatedAt: "2026-10-03T09:15:00.000Z",
  title: "Checkout structure",
  generator: "built-in:freeform",
  instructions:
    "## Purpose\nReview checkout component ownership.\n\n## Regeneration\nRebuild the page, payment form, and client relations.",
  diagram: {
    layout: { layoutId: "elk-layered" },
    graph: {
      groups: [{ groupId: "checkout-feature", title: "Checkout feature" }],
      nodes: [
        {
          type: "default",
          nodeId: "checkout-page",
          kind: "component",
          title: "Checkout page",
          description: "Coordinates checkout",
          details: ["Load the cart", "Submit the order"],
          groupId: "checkout-feature",
        },
        {
          type: "default",
          nodeId: "payment-form",
          kind: "component",
          title: "Payment form",
          description: "Collects payment details",
          details: ["Validate payment fields"],
          groupId: "checkout-feature",
        },
        {
          type: "default",
          nodeId: "payment-client",
          kind: "client",
          title: "Payment client",
          description: "Calls the payment API",
          details: ["Create a payment intent"],
          groupId: "checkout-feature",
        },
      ],
      edges: [
        {
          type: "default",
          edgeId: "payment-details",
          kind: "data-flow",
          sourceNodeId: "payment-form",
          targetNodeId: "payment-client",
          label: "Payment details",
        },
        {
          type: "default",
          edgeId: "uses-payment-client",
          kind: "dependency",
          sourceNodeId: "checkout-page",
          targetNodeId: "payment-client",
          label: "Uses payment client",
        },
      ],
    },
  },
};
const catalogDiagram = {
  artifactId: ".architecture-companion/artifacts/catalog-structure.archcomp.json",
  kind: "design",
  updatedAt: "2026-10-03T09:15:00.000Z",
  title: "Catalog structure",
  generator: "built-in:freeform",
  instructions: "## Purpose\nReview product browsing ownership.\n\n## Regeneration\nRebuild the catalog page boundary.",
  diagram: {
    layout: { layoutId: "elk-layered" },
    graph: {
      groups: [],
      nodes: [
        {
          type: "default",
          nodeId: "catalog-page",
          kind: "component",
          title: "Catalog page",
          description: "Supports product discovery",
          details: ["Browse products"],
        },
      ],
      edges: [],
    },
  },
};
const designArtifact = {
  behaviors: [
    {
      title: "Workflow",
      generator: "built-in:freeform",
      instructions:
        "## Purpose\nReview checkout confirmation.\n\n## Regeneration\nRebuild the submission and confirmation steps.",
      diagram: {
        layout: { layoutId: "elk-layered", options: { elk: { direction: "RIGHT" } } },
        graph: {
          groups: [],
          nodes: [
            { type: "default", nodeId: "submit", kind: "trigger", title: "Checkout submitted" },
            { type: "default", nodeId: "confirmed", kind: "result", title: "Order confirmed" },
          ],
          edges: [{ type: "default", edgeId: "submit-confirmed", sourceNodeId: "submit", targetNodeId: "confirmed" }],
        },
      },
      artifactId: ".architecture-companion/artifacts/checkout-workflow.archcomp.json",
      kind: "behavior",
      updatedAt: "2026-10-03T09:15:00.000Z",
    },
  ],
  designs: [checkoutDiagram, catalogDiagram],
};

const processArtifact = {
  behaviors: [
    {
      artifactId: ".architecture-companion/artifacts/invite-member.archcomp.json",
      kind: "behavior",
      updatedAt: "2026-10-03T09:15:00.000Z",
      title: "Invite member",
      generator: "built-in:freeform",
      instructions:
        "## Purpose\nReview member invitations.\n\n## Regeneration\nRebuild submission, eligibility, sending, and delivery steps.",
      diagram: {
        layout: { layoutId: "elk-layered", options: { elk: { direction: "RIGHT" } } },
        graph: {
          groups: [],
          nodes: [
            { type: "default", nodeId: "invite", kind: "trigger", title: "Invitation submitted" },
            { type: "default", nodeId: "eligible", kind: "condition", title: "Eligible member?" },
            { type: "default", nodeId: "send", kind: "action", title: "Send invitation" },
            { type: "default", nodeId: "delivered", kind: "result", title: "Invitation delivered" },
          ],
          edges: [
            { type: "default", edgeId: "invite-eligible", sourceNodeId: "invite", targetNodeId: "eligible" },
            {
              type: "default",
              edgeId: "eligible-send",
              sourceNodeId: "eligible",
              targetNodeId: "send",
              label: "Eligible",
            },
            { type: "default", edgeId: "send-delivered", sourceNodeId: "send", targetNodeId: "delivered" },
          ],
        },
      },
    },
    {
      artifactId: ".architecture-companion/artifacts/remove-member.archcomp.json",
      kind: "behavior",
      updatedAt: "2026-10-03T09:15:00.000Z",
      title: "Remove member",
      generator: "built-in:freeform",
      instructions:
        "## Purpose\nReview member removal.\n\n## Regeneration\nRebuild the removal trigger from the member workflow.",
      diagram: {
        layout: { layoutId: "elk-layered", options: { elk: { direction: "RIGHT" } } },
        graph: {
          groups: [],
          nodes: [{ type: "default", nodeId: "remove", kind: "trigger", title: "Member removal requested" }],
          edges: [],
        },
      },
    },
  ],
  designs: [],
};

type RenderableArtifact = Parameters<typeof writeCatalog>[1];

async function renderArtifact(catalog: RenderableArtifact) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "architecture-companion-diagram-review-"));
  await writeCatalog(temporaryRoot, catalog);
  const scope = await resolveCompanionScope(temporaryRoot);
  const app = createApp(scope);
  const client = createDataClient("http://architecture-companion.test", async (input, init) =>
    app.request(input, init),
  );
  const review = render(<WorkspacePage client={client} />);

  return {
    client,
    scopePath: temporaryRoot,
    cleanup: async () => {
      review.unmount();
      await rm(temporaryRoot, { recursive: true });
    },
  };
}

describe("design (architecture·implementation) review", () => {
  it("shows the design view by default when there are no behaviors", async () => {
    const { cleanup: cleanupScope } = await renderArtifact({ ...designArtifact, behaviors: [] });

    try {
      const processView = await screen.findByRole("tab", { name: "Product Behavior" });
      const designView = screen.getByRole("tab", { name: "Code Design" });

      expect(processView).toHaveAttribute("aria-disabled", "true");
      expect(designView).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("heading", { name: "Code Designs" })).toBeInTheDocument();
    } finally {
      await cleanupScope();
    }
  });

  it("shows an actionable error for an unknown layout configuration", async () => {
    const invalidArtifact = {
      ...designArtifact,
      designs: [{ ...checkoutDiagram, diagram: { ...checkoutDiagram.diagram, layout: { layoutId: "unknown" } } }],
    };
    const { cleanup: cleanupScope } = await renderArtifact(invalidArtifact);

    try {
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Invalid artifact: diagram.layout.layoutId: Unsupported layout configuration: unknown",
      );
    } finally {
      await cleanupScope();
    }
  });

  it("shows an actionable error for an invalid layout configuration", async () => {
    const invalidArtifact = {
      ...designArtifact,
      designs: [
        {
          ...checkoutDiagram,
          diagram: {
            ...checkoutDiagram.diagram,
            layout: { layoutId: "elk-layered", options: { elk: { direction: "DIAGONAL" } } },
          },
        },
      ],
    };
    const { cleanup: cleanupScope } = await renderArtifact(invalidArtifact);

    try {
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Invalid artifact: diagram.layout.options.elk.direction: Invalid option: expected one of",
      );
    } finally {
      await cleanupScope();
    }
  });

  it("shows the groups, details, and connections of the selected design", async () => {
    const { cleanup: cleanupScope } = await renderArtifact(designArtifact);

    try {
      await userEvent.click(await screen.findByRole("tab", { name: "Code Design" }));
      expect(screen.getByRole("button", { name: "Catalog structure" })).toHaveAttribute("aria-current", "page");
      expect(await screen.findByText("Browse products")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Checkout structure" }));
      expect(screen.getByRole("button", { name: "Checkout structure" })).toHaveAttribute("aria-current", "page");
      expect(await screen.findByText("Checkout page")).toBeInTheDocument();
      expect(screen.getByText("Coordinates checkout")).toBeInTheDocument();
      expect(screen.getByText("Load the cart")).toBeInTheDocument();
      expect(screen.getByText("Payment details")).toBeInTheDocument();
      expect(screen.getByText("Uses payment client")).toBeInTheDocument();
      expect(screen.queryByText("Browse products")).not.toBeInTheDocument();
    } finally {
      await cleanupScope();
    }
  });
});

describe("dependency graph review", () => {
  it("loads and lays out a nested dependency catalog through the Review page", async () => {
    const dependencyArtifact = {
      behaviors: [],
      designs: [
        {
          artifactId: ".architecture-companion/artifacts/dependencies.archcomp.json",
          kind: "design",
          updatedAt: "2026-10-03T09:15:00.000Z",
          title: "Dependencies",
          generator: "built-in:freeform",
          instructions:
            "## Purpose\nReview nested dependency boundaries.\n\n## Regeneration\nRebuild the grouped module relations.",
          diagram: {
            layout: { layoutId: "dependency-graph" },
            graph: {
              groups: [
                { groupId: "source", title: "Source" },
                { groupId: "nested", title: "Nested", parentGroupId: "source" },
                { groupId: "target", title: "Target" },
              ],
              nodes: [
                { nodeId: "a", type: "default", title: "A", groupId: "source" },
                { nodeId: "b", type: "default", title: "B", groupId: "nested" },
                { nodeId: "c", type: "default", title: "C", groupId: "target" },
              ],
              edges: [
                { edgeId: "a-c", type: "default", sourceNodeId: "a", targetNodeId: "c" },
                { edgeId: "b-c", type: "default", sourceNodeId: "b", targetNodeId: "c" },
              ],
            },
          },
        },
      ],
    } as const;
    const { cleanup } = await renderArtifact(dependencyArtifact);

    try {
      await screen.findByRole("region", { name: "Dependencies code design diagram" });
      await screen.findByText("Laying out…");
      await waitFor(() => expect(screen.queryByText("Laying out…")).not.toBeInTheDocument());
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("list", { name: "Diagram elements and connections" })).toHaveTextContent("a to c");
      expect(screen.getByRole("list", { name: "Diagram elements and connections" })).toHaveTextContent("b to c");
    } finally {
      await cleanup();
    }
  });
});

describe("process (product workflow) review", () => {
  it("renders a sequence layout with lifelines and a message", async () => {
    const sequenceArtifact = {
      behaviors: [
        {
          artifactId: ".architecture-companion/artifacts/request-response.archcomp.json",
          kind: "behavior",
          updatedAt: "2026-10-03T09:15:00.000Z",
          title: "Request response",
          generator: "built-in:freeform",
          instructions:
            "## Purpose\nReview client-server requests.\n\n## Regeneration\nRebuild the client and server lifelines and request message.",
          diagram: {
            layout: { layoutId: "sequence" },
            graph: {
              groups: [],
              nodes: [
                { nodeId: "client", type: "lifeline", kind: "participant", title: "Client", activations: [] },
                { nodeId: "server", type: "lifeline", kind: "participant", title: "Server", activations: [] },
              ],
              edges: [
                {
                  edgeId: "request",
                  type: "message",
                  sourceNodeId: "client",
                  targetNodeId: "server",
                  messageType: "sync",
                  label: "Request",
                },
              ],
            },
          },
        },
      ],
      designs: [],
    } as const;
    const { cleanup } = await renderArtifact(sequenceArtifact);

    try {
      await screen.findByRole("region", { name: "Request response product behavior diagram" });
      await screen.findByText("Laying out…");
      await waitFor(() => expect(screen.queryByText("Laying out…")).not.toBeInTheDocument());
      const overview = screen.getByRole("list", { name: "Diagram elements and connections" });
      expect(overview).toHaveTextContent("participant: Client");
      expect(overview).toHaveTextContent("participant: Server");
      expect(overview).toHaveTextContent("client to server: Request");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      await cleanup();
    }
  });

  it("keeps the page running and shows an actionable invalid-catalog error", async () => {
    const { cleanup, scopePath } = await renderArtifact({ behaviors: [], designs: [] });
    await writeFile(join(scopePath, ARTIFACTS_RELATIVE_PATH, "invalid.archcomp.json"), "{ invalid json");

    try {
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Catalog contains invalid JSON: .architecture-companion/artifacts/invalid.archcomp.json",
      );
      expect(screen.getByText("Architecture Companion")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Comment" })).toBeDisabled();
    } finally {
      await cleanup();
    }
  });

  it("provides read-only review controls for a valid workflow", async () => {
    const { cleanup } = await renderArtifact(processArtifact);

    try {
      expect(await screen.findByRole("region", { name: "Invite member product behavior diagram" })).toBeInTheDocument();
      expect(screen.getByText("Invitation submitted")).toBeInTheDocument();
      expect(screen.getByText("Eligible member?")).toBeInTheDocument();
      expect(screen.getByText("Send invitation")).toBeInTheDocument();
      expect(screen.getByText("Invitation delivered")).toBeInTheDocument();
      expect(screen.getByText("Eligible")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Zoom In" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Zoom Out" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Fit View" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Toggle theme" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Comment" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
    } finally {
      await cleanup();
    }
  });

  it("keeps the keyboard tab order of the workflow review controls", async () => {
    const { cleanup } = await renderArtifact(processArtifact);

    try {
      await screen.findByRole("heading", { name: "Product Behaviors" });
      const workflowView = screen.getByRole("tab", { name: "Product Behavior" });
      const theme = screen.getByRole("button", { name: "Toggle theme" });
      const comment = screen.getByRole("button", { name: "Comment" });
      const workflowPanel = screen.getByRole("tabpanel", { name: "Product Behavior" });
      const inviteMember = screen.getByRole("button", { name: "Invite member" });
      const removeMember = screen.getByRole("button", { name: "Remove member" });
      const zoomIn = screen.getByRole("button", { name: "Zoom In" });
      const zoomOut = screen.getByRole("button", { name: "Zoom Out" });
      const fitView = screen.getByRole("button", { name: "Fit View" });

      await userEvent.tab();
      expect(document.activeElement).toBe(workflowView);
      await userEvent.tab();
      expect(document.activeElement).toBe(theme);
      await userEvent.tab();
      expect(document.activeElement).toBe(comment);
      await userEvent.tab();
      expect(document.activeElement).toBe(workflowPanel);
      await userEvent.tab();
      expect(document.activeElement).toBe(inviteMember);
      await userEvent.tab();
      expect(document.activeElement).toBe(removeMember);
      await userEvent.tab();
      expect([zoomIn, zoomOut, fitView]).toContain(document.activeElement);
    } finally {
      await cleanup();
    }
  });
});
