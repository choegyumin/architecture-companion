import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, MouseEvent, ReactNode } from "react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DiagramCanvas } from "@/client/parts/diagram-canvas";

const mocks = vi.hoisted(() => {
  const screenToFlowPosition = vi.fn(() => ({ x: 12, y: 34 }));
  return {
    flowInstance: { screenToFlowPosition },
    screenToFlowPosition,
  };
});

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  ControlButton: ({ children, ...props }: ComponentProps<"button">) => <button {...props}>{children}</button>,
  Controls: ({ children }: { children: ReactNode }) => <>{children}</>,
  ReactFlow: ({
    children,
    edges,
    nodes,
    onEdgeClick,
    onInit,
    onNodeClick,
    onPaneClick,
  }: {
    children: ReactNode;
    edges: readonly { id: string }[];
    nodes: readonly { id: string; type: string }[];
    onEdgeClick?: (event: MouseEvent<Element>, edge: { id: string }) => void;
    onInit: (instance: unknown) => void;
    onNodeClick?: (event: MouseEvent<Element>, node: { id: string; type: string }) => void;
    onPaneClick?: (event: MouseEvent<Element>) => void;
  }) => {
    useEffect(() => {
      onInit(mocks.flowInstance);
    }, [onInit]);
    return (
      <div
        aria-label="React Flow pane"
        onClick={(event) => {
          if (event.target === event.currentTarget) onPaneClick?.(event);
        }}
      >
        {nodes.map((node) => (
          <span
            aria-label={`React Flow node ${node.id}`}
            key={node.id}
            onClick={(event) => onNodeClick?.(event, node)}
          />
        ))}
        {edges.map((edge) => (
          <span
            aria-label={`React Flow edge ${edge.id}`}
            key={edge.id}
            onClick={(event) => onEdgeClick?.(event, edge)}
          />
        ))}
        {children}
      </div>
    );
  },
}));

describe("diagram canvas", () => {
  beforeEach(() => {
    mocks.screenToFlowPosition.mockClear();
  });

  it("converts canvas clicks to flow coordinates and forwards them", async () => {
    const onCanvasClick = vi.fn();
    render(<DiagramCanvas edges={[]} nodes={[]} onCanvasClick={onCanvasClick} />);
    const pane = await screen.findByLabelText("React Flow pane");
    await act(async () => undefined);

    fireEvent.click(pane, { clientX: 120, clientY: 80 });

    expect(mocks.screenToFlowPosition).toHaveBeenCalledWith({ x: 120, y: 80 });
    expect(onCanvasClick).toHaveBeenCalledWith({ x: 12, y: 34 }, undefined);
  });

  it("forwards the type and ID of a selected node, group, or edge with the flow coordinates", async () => {
    const onCanvasClick = vi.fn();
    render(
      <DiagramCanvas
        edges={[
          {
            id: "checkout-edge",
            source: "checkout-page",
            target: "checkout-page",
            type: "polyline",
            data: { points: [] },
          },
        ]}
        nodes={[
          {
            id: "checkout-page",
            type: "card",
            position: { x: 0, y: 0 },
            data: { label: "Checkout page" },
          },
          {
            id: "checkout-boundary",
            type: "labeled-group",
            position: { x: 0, y: 0 },
            data: { label: "Checkout boundary" },
          },
        ]}
        onCanvasClick={onCanvasClick}
      />,
    );
    await screen.findByLabelText("React Flow pane");
    await act(async () => undefined);

    fireEvent.click(screen.getByLabelText("React Flow node checkout-page"), { clientX: 120, clientY: 80 });
    fireEvent.click(screen.getByLabelText("React Flow node checkout-boundary"), { clientX: 140, clientY: 90 });
    fireEvent.click(screen.getByLabelText("React Flow edge checkout-edge"), { clientX: 160, clientY: 100 });

    expect(onCanvasClick).toHaveBeenNthCalledWith(1, { x: 12, y: 34 }, { type: "node", id: "checkout-page" });
    expect(onCanvasClick).toHaveBeenNthCalledWith(2, { x: 12, y: 34 }, { type: "group", id: "checkout-boundary" });
    expect(onCanvasClick).toHaveBeenNthCalledWith(3, { x: 12, y: 34 }, { type: "edge", id: "checkout-edge" });
  });

  it("forwards module selection and pane reset separately from annotations", async () => {
    const onModuleClick = vi.fn();
    const onPaneClick = vi.fn();
    render(
      <DiagramCanvas
        edges={[]}
        nodes={[
          {
            id: "checkout-page",
            type: "card",
            position: { x: 0, y: 0 },
            data: { label: "Checkout page" },
          },
          {
            id: "checkout-boundary",
            type: "labeled-group",
            position: { x: 0, y: 0 },
            data: { label: "Checkout boundary" },
          },
        ]}
        onModuleClick={onModuleClick}
        onPaneClick={onPaneClick}
      />,
    );
    const pane = await screen.findByLabelText("React Flow pane");
    await act(async () => undefined);

    fireEvent.click(screen.getByLabelText("React Flow node checkout-page"));
    fireEvent.click(screen.getByLabelText("React Flow node checkout-boundary"));
    fireEvent.click(pane);

    expect(onModuleClick).toHaveBeenNthCalledWith(1, { type: "node", id: "checkout-page" });
    expect(onModuleClick).toHaveBeenNthCalledWith(2, { type: "group", id: "checkout-boundary" });
    expect(onPaneClick).toHaveBeenCalledOnce();
  });

  it("does not forward clicks on interactive elements as canvas clicks", async () => {
    const onCanvasClick = vi.fn();
    render(
      <DiagramCanvas edges={[]} nodes={[]} onCanvasClick={onCanvasClick}>
        <button type="button">Node action</button>
      </DiagramCanvas>,
    );
    const button = await screen.findByRole("button", { name: "Node action" });
    await act(async () => undefined);

    fireEvent.click(button, { clientX: 120, clientY: 80 });

    expect(mocks.screenToFlowPosition).not.toHaveBeenCalled();
    expect(onCanvasClick).not.toHaveBeenCalled();
  });
});
