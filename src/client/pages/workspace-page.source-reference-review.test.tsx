import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { createDataClient } from "@/client/data-client";
import { WorkspacePage } from "@/client/pages/workspace-page";
import { createApp } from "@/server/create-app";
import { resolveConsumerScope } from "@/server/resolve-consumer-scope";
import { writeArtifact } from "@/server/write-artifact";

const artifact = {
  behaviors: [
    {
      id: "checkout",
      title: "Checkout workflow",
      generator: "freeform",
      layout: { id: "elk-layered" },
      links: [{ href: "source:///specs/user-review-architecture.spec.tsx" }],
      graph: {
        groups: [],
        nodes: [
          {
            type: "default",
            id: "submit",
            kind: "trigger",
            title: "Checkout requested",
            links: [{ href: "source:///src/workflow.ts" }],
          },
          { type: "default", id: "confirmed", kind: "result", title: "Order confirmed" },
        ],
        edges: [{ type: "default", id: "submit-confirmed", source: "submit", target: "confirmed" }],
      },
    },
  ],
  designs: [
    {
      id: "structure",
      title: "Checkout structure",
      generator: "freeform",
      layout: { id: "elk-layered" },
      graph: {
        groups: [],
        nodes: [
          {
            type: "default",
            id: "checkout-page",
            kind: "component",
            title: "Checkout page",
            description: "Coordinates checkout",
            details: ["Submit the order"],
            links: [{ href: "source:///src/checkout-page.ts" }, { href: "source:///src/checkout-page.test.ts" }],
          },
        ],
        edges: [],
      },
    },
  ],
};

async function findSourceLink(label: string): Promise<HTMLAnchorElement> {
  const link = (await screen.findByText(`Open ${label}`)).closest("a");
  if (!(link instanceof HTMLAnchorElement)) throw new Error(`Source control is not a link: ${label}`);
  return link;
}

describe("source links in a review", () => {
  it("shows an English error when the operating system cannot open the source", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-source-review-"));

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await mkdir(join(scopePath, "src"));
      await writeArtifact(scopePath, artifact);
      await writeFile(join(scopePath, "src/workflow.ts"), "export const workflow = true;\n");
      const scope = await resolveConsumerScope(scopePath);
      const app = createApp(scope, {
        openPath: async () => {
          throw new Error("No default application");
        },
      });
      const client = createDataClient("http://architecture-companion.test", async (input, init) =>
        app.request(input, init),
      );

      render(<WorkspacePage client={client} />);
      const workflowLink = await findSourceLink("workflow.ts");
      await act(async () => {
        fireEvent.click(workflowLink);
      });

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not open source file: src/workflow.ts. No default application",
      );
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("opens diagram-level and element source links to the correct files", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-source-links-"));
    let openedPaths: readonly string[] = [];

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await mkdir(join(scopePath, "specs"));
      await mkdir(join(scopePath, "src"));
      await writeArtifact(scopePath, artifact);
      await writeFile(
        join(scopePath, "specs/user-review-architecture.spec.tsx"),
        "export const workflowReview = true;\n",
      );
      await writeFile(join(scopePath, "src/workflow.ts"), "export const workflow = true;\n");
      await writeFile(join(scopePath, "src/checkout-page.ts"), "export const checkoutPage = true;\n");
      await writeFile(join(scopePath, "src/checkout-page.test.ts"), "export const checkoutPageTest = true;\n");
      const scope = await resolveConsumerScope(scopePath);
      const app = createApp(scope, {
        openPath: async ({ path }) => {
          openedPaths = [...openedPaths, path];
        },
      });
      const client = createDataClient("http://architecture-companion.test", async (input, init) =>
        app.request(input, init),
      );

      render(<WorkspacePage client={client} />);
      fireEvent.click(await screen.findByRole("button", { name: "Comment" }));
      const expectedPaths = [
        await realpath(join(scopePath, "specs/user-review-architecture.spec.tsx")),
        await realpath(join(scopePath, "src/workflow.ts")),
        await realpath(join(scopePath, "src/checkout-page.test.ts")),
      ];
      const diagramLink = await findSourceLink("user-review-architecture.spec.tsx");
      const workflowLink = await findSourceLink("workflow.ts");
      await act(async () => {
        fireEvent.click(diagramLink);
      });
      await waitFor(() => expect(openedPaths).toEqual(expectedPaths.slice(0, 1)));
      expect(screen.queryByRole("form", { name: "Add comment" })).not.toBeInTheDocument();
      await act(async () => {
        fireEvent.click(workflowLink);
      });
      await waitFor(() => expect(openedPaths).toEqual(expectedPaths.slice(0, 2)));
      expect(screen.queryByRole("form", { name: "Add comment" })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("tab", { name: "Code Design" }));
      const componentTestLink = await findSourceLink("checkout-page.test.ts");
      await act(async () => {
        fireEvent.click(componentTestLink);
      });
      await waitFor(() => expect(openedPaths).toEqual(expectedPaths));
      expect(screen.queryByRole("form", { name: "Add comment" })).not.toBeInTheDocument();
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });
});
