import { fireEvent, render, screen } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";

import { CardNode, type CardReactFlowNode } from "@/shared/react-flow/card-node";

describe("CardNode", () => {
  it("highlights an activatable card while leaving its source link functional", () => {
    const onLinkActivate = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const props = {
      id: "file",
      data: {
        label: "File",
        activatable: true,
        links: [{ href: "source:///src/file.ts", label: "Open source" }],
        onLinkActivate,
      },
    } as unknown as NodeProps<CardReactFlowNode>;

    render(
      <ReactFlowProvider>
        <CardNode {...props} />
      </ReactFlowProvider>,
    );

    expect(screen.getByRole("article", { name: "File" })).toHaveClass("cursor-pointer", "hover:border-primary/60");
    fireEvent.click(screen.getByRole("button", { name: "Open source" }));
    expect(onLinkActivate).toHaveBeenCalledWith(expect.anything(), "source:///src/file.ts");
  });

  it("does not highlight a card without focus activation", () => {
    const props = { id: "file", data: { label: "File" } } as unknown as NodeProps<CardReactFlowNode>;

    render(
      <ReactFlowProvider>
        <CardNode {...props} />
      </ReactFlowProvider>,
    );

    expect(screen.getByRole("article", { name: "File" })).not.toHaveClass("cursor-pointer", "hover:border-primary/60");
  });
});
