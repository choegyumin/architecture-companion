import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AnnotationCanvasController } from "@/client/parts/annotation-layer";
import { installComponentDiagramBrowserMeasurements } from "@/client/widgets/component-structure-test-browser";
import { DiagramRenderer } from "@/client/widgets/diagram-renderer";
import type { Artifact } from "@/features/artifact/artifact";
import { projectDecisionNodes } from "@/features/diagram/decision-nodes";

import { waitForDiagramReady } from "../tests/helpers/wait-for-diagram";

const annotations = {
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
} satisfies AnnotationCanvasController;

const diagram = {
  id: "components",
  updatedAt: "2026-10-03T09:15:00.000Z",
  title: "Page composition",
  generator: "built-in:react-component-structure",
  instructions: "## Purpose\nExplore supplied page content.\n\n## Regeneration\nRead the page composition sources.",
  layout: { id: "elk-layered" },
  graph: projectDecisionNodes({
    groups: [],
    nodes: [
      { id: "app", type: "default", kind: "component", title: "App" },
      { id: "main", type: "default", kind: "component", title: "Main" },
      { id: "main-child", type: "default", kind: "component", title: "MainContent" },
      { id: "preview", type: "default", kind: "component", title: "Preview" },
      {
        id: "footer",
        type: "default",
        kind: "component",
        title: "Footer",
        links: [{ href: "source:///src/footer.tsx" }],
        component: { definitionId: "Footer", origins: [{ supplierId: "App", supplierTitle: "App", prop: "footer" }] },
      },
    ],
    edges: [
      {
        id: "a-main",
        type: "default",
        source: "app",
        target: "main",
        activeWhen: [
          [
            { controlId: "show-page", value: "on" },
            { controlId: "view", value: "main" },
          ],
        ],
      },
      { id: "main-child", type: "default", source: "main", target: "main-child", activeWhen: [[]] },
      {
        id: "z-preview",
        type: "default",
        source: "app",
        target: "preview",
        activeWhen: [
          [
            { controlId: "show-page", value: "on" },
            { controlId: "view", value: "preview" },
          ],
        ],
      },
      {
        id: "preview-footer",
        type: "default",
        source: "preview",
        target: "footer",
        activeWhen: [[{ controlId: "show-footer", value: "on" }]],
      },
    ],
    roots: ["app"],
    controls: [
      { id: "show-page", owner: "app", kind: "conditional", label: "showPage", dependsOn: [[]] },
      {
        id: "view",
        owner: "app",
        kind: "branch",
        label: "view",
        dependsOn: [[{ controlId: "show-page", value: "on" }]],
        cases: [
          { id: "main", label: "Main" },
          { id: "preview", label: "Preview" },
        ],
      },
      { id: "show-footer", owner: "preview", kind: "conditional", label: "showFooter", dependsOn: [[]] },
    ],
  }),
} satisfies Artifact;

let restoreBrowserMeasurements: () => void;
beforeEach(() => {
  restoreBrowserMeasurements = installComponentDiagramBrowserMeasurements();
});
afterEach(() => restoreBrowserMeasurements());

it("reviewer reaches supplied content from an inactive path and opens its source evidence", async () => {
  const user = userEvent.setup();
  const onOpenSource = vi.fn();
  render(<DiagramRenderer annotations={annotations} diagram={diagram} onOpenSource={onOpenSource} />);
  await waitForDiagramReady();

  expect(screen.getByRole("article", { name: "component: Preview" })).toHaveAccessibleDescription("Inactive path");
  await user.click(screen.getByRole("switch", { name: "showFooter" }));

  expect(screen.getByRole("switch", { name: "showPage" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("article", { name: "component: Footer" })).toHaveAccessibleDescription("Active path");
  expect(screen.getByText("from App (footer)")).toBeVisible();
  expect(screen.getByRole("article", { name: "component: Main" })).toHaveAccessibleDescription("Inactive path");
  await user.click(screen.getByRole("button", { name: "Open footer.tsx" }));
  expect(onOpenSource).toHaveBeenCalledWith("source:///src/footer.tsx");
});
