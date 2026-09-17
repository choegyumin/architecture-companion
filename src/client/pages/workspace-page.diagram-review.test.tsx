import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createDataClient } from "@/client/data-client";
import { WorkspacePage } from "@/client/pages/workspace-page";
import { createApp } from "@/server/create-app";
import { resolveConsumerScope } from "@/server/resolve-consumer-scope";

const checkoutDiagram = {
  id: "checkout-structure",
  title: "Checkout structure",
  generatorId: "freeform",
  layout: { id: "elk-layered" },
  graph: {
    groups: [{ id: "checkout-feature", title: "Checkout feature" }],
    nodes: [
      {
        type: "default",
        id: "checkout-page",
        kind: "component",
        title: "Checkout page",
        description: "Coordinates checkout",
        details: ["Load the cart", "Submit the order"],
        groupId: "checkout-feature",
      },
      {
        type: "default",
        id: "payment-form",
        kind: "component",
        title: "Payment form",
        description: "Collects payment details",
        details: ["Validate payment fields"],
        groupId: "checkout-feature",
      },
      {
        type: "default",
        id: "payment-client",
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
        id: "payment-details",
        kind: "data-flow",
        source: "payment-form",
        target: "payment-client",
        label: "Payment details",
      },
      {
        type: "default",
        id: "uses-payment-client",
        kind: "dependency",
        source: "checkout-page",
        target: "payment-client",
        label: "Uses payment client",
      },
    ],
  },
};
const catalogDiagram = {
  id: "catalog-structure",
  title: "Catalog structure",
  generatorId: "freeform",
  layout: { id: "elk-layered" },
  graph: {
    groups: [],
    nodes: [
      {
        type: "default",
        id: "catalog-page",
        kind: "component",
        title: "Catalog page",
        description: "Supports product discovery",
        details: ["Browse products"],
      },
    ],
    edges: [],
  },
};
const designArtifact = {
  version: 1,
  processes: [
    {
      title: "Workflow",
      generatorId: "freeform",
      layout: { id: "elk-layered", options: { direction: "RIGHT" } },
      graph: {
        groups: [],
        nodes: [
          { type: "default", id: "submit", kind: "trigger", title: "Checkout submitted" },
          { type: "default", id: "confirmed", kind: "result", title: "Order confirmed" },
        ],
        edges: [{ type: "default", id: "submit-confirmed", source: "submit", target: "confirmed" }],
      },
      id: "checkout",
    },
  ],
  designs: [checkoutDiagram, catalogDiagram],
};

const processArtifact = {
  version: 1,
  processes: [
    {
      id: "invite-member",
      title: "Invite member",
      generatorId: "freeform",
      layout: { id: "elk-layered", options: { direction: "RIGHT" } },
      graph: {
        groups: [],
        nodes: [
          { type: "default", id: "invite", kind: "trigger", title: "Invitation submitted" },
          { type: "default", id: "eligible", kind: "condition", title: "Eligible member?" },
          { type: "default", id: "send", kind: "action", title: "Send invitation" },
          { type: "default", id: "delivered", kind: "result", title: "Invitation delivered" },
        ],
        edges: [
          { type: "default", id: "invite-eligible", source: "invite", target: "eligible" },
          { type: "default", id: "eligible-send", source: "eligible", target: "send", label: "Eligible" },
          { type: "default", id: "send-delivered", source: "send", target: "delivered" },
        ],
      },
    },
    {
      id: "remove-member",
      title: "Remove member",
      generatorId: "freeform",
      layout: { id: "elk-layered", options: { direction: "RIGHT" } },
      graph: {
        groups: [],
        nodes: [{ type: "default", id: "remove", kind: "trigger", title: "Member removal requested" }],
        edges: [],
      },
    },
  ],
  designs: [],
};

async function renderArtifact(artifactSource: unknown) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "architecture-companion-diagram-review-"));
  const artifactDirectory = join(temporaryRoot, ".architecture-companion");
  await mkdir(artifactDirectory);
  await writeFile(
    join(artifactDirectory, "artifact.json"),
    typeof artifactSource === "string" ? artifactSource : JSON.stringify(artifactSource),
  );
  const scope = await resolveConsumerScope(temporaryRoot);
  const app = createApp(scope);
  const client = createDataClient("http://architecture-companion.test", async (input, init) =>
    app.request(input, init),
  );
  const review = render(<WorkspacePage client={client} />);

  return async () => {
    review.unmount();
    await rm(temporaryRoot, { recursive: true });
  };
}

describe("design (architecture·implementation) review", () => {
  it("shows the design view by default when there are no processes", async () => {
    const cleanupScope = await renderArtifact({ ...designArtifact, processes: [] });

    try {
      const processView = await screen.findByRole("tab", { name: "Process" });
      const designView = screen.getByRole("tab", { name: "Design" });

      expect(processView).toHaveAttribute("aria-disabled", "true");
      expect(designView).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("heading", { name: "Designs" })).toBeInTheDocument();
    } finally {
      await cleanupScope();
    }
  });

  it("shows an actionable error for an unknown layout configuration", async () => {
    const invalidArtifact = {
      ...designArtifact,
      designs: [{ ...checkoutDiagram, layout: { id: "unknown" } }],
    };
    const cleanupScope = await renderArtifact(invalidArtifact);

    try {
      expect(await screen.findByRole("alert")).toHaveTextContent("Invalid artifact: Invalid discriminator value");
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
          layout: { id: "elk-layered", options: { direction: "DIAGONAL" } },
        },
      ],
    };
    const cleanupScope = await renderArtifact(invalidArtifact);

    try {
      expect(await screen.findByRole("alert")).toHaveTextContent("Invalid artifact: Invalid option: expected one of");
    } finally {
      await cleanupScope();
    }
  });

  it("shows the groups, details, and connections of the selected design", async () => {
    const cleanupScope = await renderArtifact(designArtifact);

    try {
      await userEvent.click(await screen.findByRole("tab", { name: "Design" }));
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

describe("process (product workflow) review", () => {
  it("keeps the page running and shows an actionable invalid-artifact error", async () => {
    const cleanup = await renderArtifact("{ invalid json");

    try {
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Artifact contains invalid JSON: .architecture-companion/artifact.json",
      );
      expect(screen.getByText("Architecture Companion")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Comment" })).toBeDisabled();
    } finally {
      await cleanup();
    }
  });

  it("provides read-only review controls for a valid workflow", async () => {
    const cleanup = await renderArtifact(processArtifact);

    try {
      expect(await screen.findByRole("region", { name: "Invite member process diagram" })).toBeInTheDocument();
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
    const cleanup = await renderArtifact(processArtifact);

    try {
      await screen.findByRole("heading", { name: "Processes" });
      const workflowView = screen.getByRole("tab", { name: "Process" });
      const theme = screen.getByRole("button", { name: "Toggle theme" });
      const comment = screen.getByRole("button", { name: "Comment" });
      const workflowPanel = screen.getByRole("tabpanel", { name: "Process" });
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
