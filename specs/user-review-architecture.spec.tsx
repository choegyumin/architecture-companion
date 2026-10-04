import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createDataClient } from "@/client/data-client";
import { WorkspacePage } from "@/client/pages/workspace-page";
import { createApp } from "@/server/create-app";
import { resolveCompanionScope } from "@/server/resolve-companion-scope";
import { writeCatalog } from "@/server/write-catalog";

import { waitForDiagramReady } from "../tests/helpers/wait-for-diagram";

const catalog = {
  behaviors: [
    {
      id: "checkout",
      updatedAt: "2026-10-03T09:15:00.000Z",
      title: "Checkout workflow",
      generator: "built-in:freeform",
      instructions:
        "## Purpose\nReview checkout requests.\n\n## Regeneration\nRebuild the checkout trigger from the order flow.",
      layout: { id: "elk-layered" },
      graph: {
        groups: [],
        nodes: [{ type: "default", id: "submit", kind: "trigger", title: "Checkout requested" }],
        edges: [],
      },
    },
    {
      id: "cancel-order",
      updatedAt: "2026-10-03T09:15:00.000Z",
      title: "Cancel order",
      generator: "built-in:freeform",
      instructions:
        "## Purpose\nReview order cancellation.\n\n## Regeneration\nRebuild the cancellation trigger from the order flow.",
      layout: { id: "elk-layered" },
      graph: {
        groups: [],
        nodes: [{ type: "default", id: "cancel", kind: "trigger", title: "Cancellation requested" }],
        edges: [],
      },
    },
  ],
  designs: [
    {
      id: "checkout-structure",
      updatedAt: "2026-10-03T09:15:00.000Z",
      title: "Checkout structure",
      generator: "built-in:freeform",
      instructions:
        "## Purpose\nReview the checkout entry point.\n\n## Regeneration\nRebuild the checkout page boundary.",
      layout: { id: "elk-layered" },
      graph: {
        groups: [],
        nodes: [{ type: "default", id: "checkout-page", kind: "component", title: "Checkout page" }],
        edges: [],
      },
    },
    {
      id: "catalog-structure",
      updatedAt: "2026-10-03T09:15:00.000Z",
      title: "Catalog structure",
      generator: "built-in:freeform",
      instructions:
        "## Purpose\nReview product browsing.\n\n## Regeneration\nRebuild the page boundary from src/catalog-page.ts.",
      layout: { id: "elk-layered" },
      graph: {
        groups: [],
        nodes: [
          {
            type: "default",
            id: "catalog-page",
            kind: "component",
            title: "Catalog page",
            details: ["Browse products"],
            links: [{ href: "source:///src/catalog-page.ts" }],
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
  await waitForDiagramReady();
  return link;
}

describe("reviewer understands the architecture from diagrams and source evidence", () => {
  it("reads diagrams across the review scope and opens source links to verify the implementation", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-architecture-review-"));
    let openedPaths: readonly string[] = [];

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await mkdir(join(scopePath, "src"));
      await writeCatalog(scopePath, catalog);
      await writeFile(join(scopePath, "src/catalog-page.ts"), "export const catalogPage = true;\n");
      const scope = await resolveCompanionScope(scopePath);
      const app = createApp(scope, {
        openPath: async ({ path }) => {
          openedPaths = [...openedPaths, path];
        },
      });
      const client = createDataClient("http://architecture-companion.test", async (input, init) =>
        app.request(input, init),
      );

      render(<WorkspacePage client={client} />);

      expect(await screen.findByText("Cancellation requested")).toBeInTheDocument();
      await waitForDiagramReady();
      await userEvent.click(screen.getByRole("button", { name: "Checkout workflow" }));
      expect(await screen.findByText("Checkout requested")).toBeInTheDocument();
      await waitForDiagramReady();

      await userEvent.click(screen.getByRole("tab", { name: "Code Design" }));
      expect(await screen.findByText("Browse products")).toBeInTheDocument();
      const sourceLink = await findSourceLink("catalog-page.ts");
      await act(async () => {
        fireEvent.click(sourceLink);
      });
      await waitFor(async () => {
        expect(openedPaths).toEqual([await realpath(join(scopePath, "src/catalog-page.ts"))]);
      });

      await userEvent.click(screen.getByRole("button", { name: "Checkout structure" }));
      expect(await screen.findByText("Checkout page")).toBeInTheDocument();
      await waitForDiagramReady();
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });
});
