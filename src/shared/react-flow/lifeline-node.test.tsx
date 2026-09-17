import { fireEvent, render, screen } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";

import { LifelineNode, type LifelineReactFlowNode } from "@/shared/react-flow/lifeline-node";

describe("LifelineNode", () => {
  it("renders URI links as anchors and passes the href to the activation callback", () => {
    const onLinkActivate = vi.fn();
    const props = {
      id: "participant",
      data: {
        node: { kind: "participant", title: "Participant" },
        links: [{ href: "https://example.com/docs", label: "Docs" }],
        onLinkActivate,
      },
    } as unknown as NodeProps<LifelineReactFlowNode>;

    render(
      <ReactFlowProvider>
        <LifelineNode {...props} />
      </ReactFlowProvider>,
    );

    const link = screen.getByRole("button", { name: "Docs" });

    expect(link).toBeInstanceOf(HTMLAnchorElement);
    expect(link).toHaveAttribute("data-slot", "button");
    expect(link).toHaveAttribute("href", "https://example.com/docs");
    fireEvent.click(link);
    expect(onLinkActivate).toHaveBeenCalledWith(expect.any(Object), "https://example.com/docs");
  });

  it("maps handle sides to flow positions and connection types", () => {
    const props = {
      id: "participant",
      data: {
        node: { kind: "participant", title: "Participant" },
        layout: {
          handles: [
            { id: "request:source", side: "right", y: 48 },
            { id: "response:target", side: "left", y: 96 },
          ],
        },
      },
    } as unknown as NodeProps<LifelineReactFlowNode>;

    render(
      <ReactFlowProvider>
        <LifelineNode {...props} />
      </ReactFlowProvider>,
    );

    expect(document.querySelectorAll(".react-flow__handle")).toHaveLength(2);
    const sourceHandle = document.querySelector('[data-handleid="request:source"]');
    expect(sourceHandle).toHaveAttribute("data-handlepos", "right");
    expect(sourceHandle).toHaveClass("source");
    const targetHandle = document.querySelector('[data-handleid="response:target"]');
    expect(targetHandle).toHaveAttribute("data-handlepos", "left");
    expect(targetHandle).toHaveClass("target");
  });
});
