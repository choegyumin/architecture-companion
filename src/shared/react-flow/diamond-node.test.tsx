import { render, screen } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";

import { DiamondNode, type DiamondReactFlowNode } from "@/shared/react-flow/diamond-node";

function renderDiamond(data: DiamondReactFlowNode["data"]) {
  const props = { id: "diamond", data } as NodeProps<DiamondReactFlowNode>;
  return render(
    <ReactFlowProvider>
      <DiamondNode {...props} />
    </ReactFlowProvider>,
  );
}

describe("DiamondNode", () => {
  it("shows a supplied title inside the diamond", () => {
    renderDiamond({ label: "Continue?" });
    expect(screen.getByRole("img", { name: "Continue?" })).toContainElement(screen.getByText("Continue?"));
  });

  it("keeps an accessible-only diamond visually unlabeled", () => {
    renderDiamond({ accessibleLabel: "View mode", ports: ["preview", "edit"], active: true });
    expect(screen.getByRole("img", { name: "View mode" })).toHaveTextContent("");
    expect(screen.queryByText("View mode")).not.toBeInTheDocument();
  });
});
