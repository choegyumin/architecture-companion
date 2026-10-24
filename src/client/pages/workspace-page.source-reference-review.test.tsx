import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createDataClient } from "@/client/data-client";
import { createApp } from "@/server/create-app";
import { resolveCompanionScope } from "@/server/resolve-companion-scope";

import { renderWorkspace } from "../../../tests/helpers/render-workspace";
import { waitForDiagramReady } from "../../../tests/helpers/wait-for-diagram";
import { writeCatalog } from "../../../tests/helpers/write-catalog";

const catalog = {
  artifacts: [
    {
      artifactId: ".architecture-companion/artifacts/checkout-workflow.archcomp.json",
      type: "behavior",
      updatedAt: "2026-10-03T09:15:00.000Z",
      title: "Checkout workflow",
      generator: "built-in:freeform",
      instructions:
        "## Purpose\nReview checkout requests.\n\n## Regeneration\nRebuild the trigger and confirmation from src/workflow.ts.",
      links: [{ href: "source:///specs/user-review-architecture.spec.tsx" }],
      diagram: {
        layout: { layoutId: "general" },
        graph: {
          groups: [],
          nodes: [
            {
              type: "default",
              nodeId: "submit",
              kind: "trigger",
              title: "Checkout requested",
              links: [{ href: "source:///src/workflow.ts" }],
            },
            { type: "default", nodeId: "confirmed", kind: "result", title: "Order confirmed" },
          ],
          edges: [{ type: "default", edgeId: "submit-confirmed", sourceNodeId: "submit", targetNodeId: "confirmed" }],
        },
      },
    },
    {
      artifactId: ".architecture-companion/artifacts/checkout-structure.archcomp.json",
      type: "design",
      updatedAt: "2026-10-03T09:15:00.000Z",
      title: "Checkout structure",
      generator: "built-in:freeform",
      instructions:
        "## Purpose\nReview checkout ownership.\n\n## Regeneration\nRebuild the page boundary from src/checkout-page.ts and its tests.",
      diagram: {
        layout: { layoutId: "general" },
        graph: {
          groups: [],
          nodes: [
            {
              type: "default",
              nodeId: "checkout-page",
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
    },
  ],
};

async function findSourceLink(label: string): Promise<HTMLAnchorElement> {
  const link = (await screen.findByText(`Open ${label}`)).closest("a");
  if (!(link instanceof HTMLAnchorElement)) throw new Error(`Source control is not a link: ${label}`);
  await waitForDiagramReady();
  return link;
}

describe("source links in a review", () => {
  it.each([
    { surface: "Artifact", label: "user-review-architecture.spec.tsx", target: undefined },
    { surface: "Node", label: "workflow.ts", target: { type: "node", id: "submit" } as const },
  ])("comments instead of opening the $surface source link in Comment mode", async ({ label, target }) => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-comment-source-"));
    const openedPaths: string[] = [];
    let review: Awaited<ReturnType<typeof renderWorkspace>> | undefined;
    try {
      await writeCatalog(scopePath, catalog);
      await mkdir(join(scopePath, "src"));
      await mkdir(join(scopePath, "specs"));
      await writeFile(join(scopePath, "src/workflow.ts"), "export const workflow = true;\n");
      await writeFile(join(scopePath, "specs/user-review-architecture.spec.tsx"), "export const review = true;\n");
      const app = createApp(await resolveCompanionScope(scopePath), {
        openPath: async ({ path }) => {
          openedPaths.push(path);
        },
      });
      const client = createDataClient("http://architecture-companion.test", async (input, init) =>
        app.request(input, init),
      );
      review = await renderWorkspace(client);
      const link = await findSourceLink(label);
      await userEvent.click(screen.getByRole("button", { name: "Comment" }));
      fireEvent.click(link);
      const composer = await screen.findByRole("form", { name: "Add comment" });
      await userEvent.type(within(composer).getByLabelText("Comment text"), "Review the linked element");
      await userEvent.click(within(composer).getByRole("button", { name: "Post" }));
      await screen.findByRole("button", { name: "Comment: Review the linked element" });
      const document = (await client.getAnnotations()).document;
      expect(document?.annotations).toHaveLength(1);
      expect(document?.annotations.at(0)?.anchor).toEqual({
        canvasId: "behavior:.architecture-companion/artifacts/checkout-workflow.archcomp.json",
        point: { x: expect.any(Number), y: expect.any(Number) },
        ...(target ? { target } : {}),
      });
      expect(openedPaths).toEqual([]);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      review?.unmount();
      await rm(scopePath, { recursive: true });
    }
  });

  it("shows an English error when the operating system cannot open the source", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-source-review-"));

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await mkdir(join(scopePath, "src"));
      await writeCatalog(scopePath, catalog);
      await writeFile(join(scopePath, "src/workflow.ts"), "export const workflow = true;\n");
      const scope = await resolveCompanionScope(scopePath);
      const app = createApp(scope, {
        openPath: async () => {
          throw new Error("No default application");
        },
      });
      const client = createDataClient("http://architecture-companion.test", async (input, init) =>
        app.request(input, init),
      );

      await renderWorkspace(client);
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
      await writeCatalog(scopePath, catalog);
      await writeFile(
        join(scopePath, "specs/user-review-architecture.spec.tsx"),
        "export const workflowReview = true;\n",
      );
      await writeFile(join(scopePath, "src/workflow.ts"), "export const workflow = true;\n");
      await writeFile(join(scopePath, "src/checkout-page.ts"), "export const checkoutPage = true;\n");
      await writeFile(join(scopePath, "src/checkout-page.test.ts"), "export const checkoutPageTest = true;\n");
      const scope = await resolveCompanionScope(scopePath);
      const app = createApp(scope, {
        openPath: async ({ path }) => {
          openedPaths = [...openedPaths, path];
        },
      });
      const client = createDataClient("http://architecture-companion.test", async (input, init) =>
        app.request(input, init),
      );

      const expectedPaths = [
        await realpath(join(scopePath, "specs/user-review-architecture.spec.tsx")),
        await realpath(join(scopePath, "src/workflow.ts")),
        await realpath(join(scopePath, "src/checkout-page.test.ts")),
      ];
      await renderWorkspace(client);
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
