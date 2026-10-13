import { render, screen } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";

import { BoundingGroupNode, type BoundingGroupReactFlowNode } from "@/shared/react-flow/bounding-group-node";

function renderGroup(data: BoundingGroupReactFlowNode["data"]) {
  const props = { id: "group", data } as NodeProps<BoundingGroupReactFlowNode>;
  return render(
    <ReactFlowProvider>
      <BoundingGroupNode {...props} />
    </ReactFlowProvider>,
  );
}

describe("BoundingGroupNode", () => {
  it("shows a supplied title and description", () => {
    renderGroup({ label: "Application", description: "Review boundary" });
    expect(screen.getByRole("article", { name: "Group: Application" })).toContainElement(
      screen.getByRole("heading", { name: "Application" }),
    );
    expect(screen.getByText("Review boundary")).toBeVisible();
  });

  it("hides the title without removing its accessible name or description", () => {
    renderGroup({ label: "Application", hideTitle: true, description: "Review boundary" });
    expect(screen.getByRole("article", { name: "Group: Application" })).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByText("Review boundary")).toBeVisible();
  });

  it("keeps an unlabeled derived outline inert and hidden from assistive technology", () => {
    renderGroup({});
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.getByRole("article", { hidden: true })).toHaveClass("pointer-events-none");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
