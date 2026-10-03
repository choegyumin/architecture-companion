import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AnnotationCanvasController } from "@/client/parts/annotation-layer";
import { installComponentDiagramBrowserMeasurements } from "@/client/widgets/component-structure-test-browser";
import { DiagramRenderer } from "@/client/widgets/diagram-renderer";
import { parseDiagram } from "@/features/diagram/diagram";
import { buildComponentGraph } from "@/plugins/diagram-generators/react-component-structure/analysis/build-component-graph";

import { waitForDiagramReady } from "../tests/helpers/wait-for-diagram";

const annotations: AnnotationCanvasController = {
  document: { annotations: [] },
  surface: { canvasId: "components" },
  isCommentMode: false,
  isManaging: false,
  isPublishing: false,
  begin: () => {},
  change: () => {},
  changeEdit: () => {},
  cancel: async () => true,
  closeEdit: async () => true,
  move: async () => {},
  open: () => {},
  publish: async () => {},
  removeEdit: async () => {},
  resolveEditConflict: async () => {},
  saveEdit: async () => true,
};

it("keeps supplied conditional paths operable after generating and serializing the graph", async () => {
  const scopePath = await mkdtemp(join(tmpdir(), "component-renderer-integration-"));
  const restoreBrowserMeasurements = installComponentDiagramBrowserMeasurements();
  try {
    await mkdir(join(scopePath, "node_modules"));
    await symlink(
      dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
      join(scopePath, "node_modules", "typescript"),
      "dir",
    );
    await writeFile(
      join(scopePath, "components.tsx"),
      `
      function Leaf() { return <span />; }
      function Shell({ children, enabled }) { return <>{enabled && children}</>; }
      function App({ open }) { return open && <Shell><Leaf /></Shell>; }
    `,
    );
    const graph = await buildComponentGraph({ scopePath, sourcePaths: ["components.tsx"], rootPatterns: ["App"] });
    const diagram = parseDiagram(
      JSON.parse(
        JSON.stringify({
          id: "generated-components",
          title: "Generated components",
          updatedAt: "2026-10-04T09:00:00.000Z",
          generator: "built-in:react-component-structure",
          instructions: "Regenerate from components.tsx.",
          layout: { id: "elk-layered" },
          graph,
        }),
      ),
    );
    const user = userEvent.setup();
    render(<DiagramRenderer annotations={annotations} diagram={diagram} onOpenSource={() => {}} />);
    await waitForDiagramReady();
    expect(screen.getByRole("article", { name: /\bLeaf$/ })).toHaveAccessibleDescription(/\binactive\b/i);

    const consumerSwitch = await screen.findByRole("switch", { name: "enabled" });
    expect(consumerSwitch).not.toBeDisabled();
    await user.click(consumerSwitch);
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "open" })).toBeChecked();
      expect(screen.getByRole("switch", { name: "enabled" })).toBeChecked();
      expect(screen.getByRole("article", { name: /Leaf$/ })).toHaveAccessibleDescription(/^active /i);
    });
    expect(screen.getByText(/App.*children/)).toBeVisible();
  } finally {
    cleanup();
    restoreBrowserMeasurements();
    await rm(scopePath, { recursive: true, force: true });
  }
});

it("honors control prerequisites when an authored edge contains only its local requirement", async () => {
  const restoreBrowserMeasurements = installComponentDiagramBrowserMeasurements();
  try {
    const diagram = parseDiagram({
      id: "nested-metadata",
      title: "Nested metadata",
      updatedAt: "2026-10-04T09:00:00.000Z",
      generator: "built-in:react-component-structure",
      instructions: "Review nested rendering prerequisites.",
      layout: { id: "elk-layered" },
      graph: {
        groups: [],
        nodes: [
          { id: "app", type: "default", title: "App" },
          { id: "leaf", type: "default", title: "Leaf" },
        ],
        edges: [
          {
            id: "app-leaf",
            type: "default",
            source: "app",
            target: "leaf",
            component: { paths: [[{ controlId: "child", value: "on" }]] },
          },
        ],
        componentStructure: {
          roots: ["app"],
          controls: [
            { id: "parent", source: "app", kind: "conditional", label: "parent", when: [[]] },
            {
              id: "child",
              source: "app",
              kind: "conditional",
              label: "child",
              when: [[{ controlId: "parent", value: "on" }]],
            },
          ],
        },
      },
    });
    const user = userEvent.setup();
    render(<DiagramRenderer annotations={annotations} diagram={diagram} onOpenSource={() => {}} />);
    await waitForDiagramReady();
    await user.click(screen.getByRole("switch", { name: "child" }));
    expect(screen.getByRole("article", { name: "Leaf" })).toHaveAccessibleDescription(/^active /i);
    await user.click(screen.getByRole("switch", { name: "parent" }));

    expect(screen.getByRole("switch", { name: "child" })).toBeChecked();
    expect(screen.getByRole("article", { name: "Leaf" })).toHaveAccessibleDescription(/^inactive /i);
  } finally {
    cleanup();
    restoreBrowserMeasurements();
  }
});

it("does not activate a shared consumer's output through an inactive supplier's retained local selection", async () => {
  const restoreBrowserMeasurements = installComponentDiagramBrowserMeasurements();
  try {
    const diagram = parseDiagram({
      id: "supplier-metadata",
      title: "Supplier metadata",
      updatedAt: "2026-10-04T09:00:00.000Z",
      generator: "built-in:react-component-structure",
      instructions: "Review conditional supplied output through a shared consumer.",
      layout: { id: "elk-layered" },
      graph: {
        groups: [],
        nodes: ["App", "Supplier", "Shared", "Leaf"].map((title) => ({ id: title, type: "default", title })),
        edges: [
          {
            id: "supplier",
            type: "default",
            source: "App",
            target: "Supplier",
            component: { paths: [[{ controlId: "supplier-visible", value: "on" }]] },
          },
          { id: "direct-shared", type: "default", source: "App", target: "Shared" },
          { id: "supplied-shared", type: "default", source: "Supplier", target: "Shared" },
          {
            id: "shared-leaf",
            type: "default",
            source: "Shared",
            target: "Leaf",
            component: { paths: [[{ controlId: "leaf", value: "on" }]] },
          },
        ],
        componentStructure: {
          roots: ["App"],
          controls: [
            { id: "supplier-visible", source: "App", kind: "conditional", label: "supplier visible", when: [[]] },
            { id: "leaf", source: "Supplier", kind: "conditional", label: "leaf", when: [[]] },
          ],
        },
      },
    });
    const user = userEvent.setup();
    render(<DiagramRenderer annotations={annotations} diagram={diagram} onOpenSource={() => {}} />);
    await waitForDiagramReady();
    await user.click(screen.getByRole("switch", { name: "leaf" }));
    expect(screen.getByRole("article", { name: "Leaf" })).toHaveAccessibleDescription(/^active /i);
    await user.click(screen.getByRole("switch", { name: "supplier visible" }));

    expect(screen.getByRole("switch", { name: "leaf" })).toBeChecked();
    expect(screen.getByRole("article", { name: "Supplier" })).toHaveAccessibleDescription(/^inactive /i);
    expect(screen.getByRole("article", { name: "Shared" })).toHaveAccessibleDescription(/^active /i);
    expect(screen.getByRole("article", { name: "Leaf" })).toHaveAccessibleDescription(/^inactive /i);
  } finally {
    cleanup();
    restoreBrowserMeasurements();
  }
});
