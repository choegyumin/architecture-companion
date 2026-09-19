import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createDataClient } from "@/client/data-client";
import { WorkspacePage } from "@/client/pages/workspace-page";
import { createApp } from "@/server/create-app";
import { ARTIFACT_RELATIVE_PATH } from "@/server/read-artifact";
import { resolveConsumerScope } from "@/server/resolve-consumer-scope";

const artifact = {
  behaviors: [
    {
      id: "checkout",
      title: "Checkout workflow",
      generatorId: "freeform",
      layout: { id: "elk-layered" },
      graph: {
        groups: [],
        nodes: [{ type: "default", id: "submit", kind: "trigger", title: "Checkout requested" }],
        edges: [],
      },
    },
    {
      id: "cancel-order",
      title: "Cancel order",
      generatorId: "freeform",
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
      title: "Checkout structure",
      generatorId: "freeform",
      layout: { id: "elk-layered" },
      graph: {
        groups: [],
        nodes: [{ type: "default", id: "checkout-page", kind: "component", title: "Checkout page" }],
        edges: [],
      },
    },
    {
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
  return link;
}

describe("reviewer understands the architecture from diagrams and source evidence", () => {
  it("reads diagrams across the review scope and opens source links to verify the implementation", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-architecture-review-"));
    let openedPaths: readonly string[] = [];

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await mkdir(join(scopePath, "src"));
      await writeFile(join(scopePath, ARTIFACT_RELATIVE_PATH), JSON.stringify(artifact));
      await writeFile(join(scopePath, "src/catalog-page.ts"), "export const catalogPage = true;\n");
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

      expect(await screen.findByText("Cancellation requested")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Checkout workflow" }));
      expect(await screen.findByText("Checkout requested")).toBeInTheDocument();

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
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });
});
