import { act, fireEvent, render, screen } from "@testing-library/react";
import type { MouseEvent, ReactNode } from "react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DiagramCanvas } from "@/client/parts/diagram-canvas";

const mocks = vi.hoisted(() => {
  const screenToFlowPosition = vi.fn(() => ({ x: 12, y: 34 }));
  const fitView = vi.fn();
  const viewport = { x: 0, y: 0, zoom: 1 };
  const setViewport = vi.fn(async (next: typeof viewport) => {
    Object.assign(viewport, next);
    return true;
  });
  return {
    viewport,
    platform: { os: { mac: false } },
    flowInstance: {
      screenToFlowPosition,
      fitView,
      setViewport,
      getNodesBounds: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    },
    screenToFlowPosition,
    fitView,
  };
});

vi.mock("@base-ui/utils/platform", () => ({ platform: mocks.platform }));
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  Background: () => null,
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
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
    nodes: readonly { id: string; type: string; parentId?: string; className?: string }[];
    onEdgeClick?: (event: MouseEvent<Element>, edge: { id: string }) => void;
    onInit: (instance: unknown) => void;
    onNodeClick?: (event: MouseEvent<Element>, node: { id: string; type: string }) => void;
    onPaneClick?: (event: MouseEvent<Element>) => void;
  }) => {
    useEffect(() => {
      onInit(mocks.flowInstance);
    }, [onInit]);
    const renderNode = (node: { id: string; type: string; parentId?: string; className?: string }): ReactNode => (
      <span
        aria-label={`React Flow node ${node.id}`}
        className={`react-flow__node ${node.className ?? ""}`}
        data-id={node.id}
        key={node.id}
        onClick={(event) => onNodeClick?.(event, node)}
      >
        {nodes.filter((child) => child.parentId === node.id).map(renderNode)}
      </span>
    );
    return (
      <div
        aria-label="React Flow pane"
        onClick={(event) => {
          if (event.target === event.currentTarget) onPaneClick?.(event);
        }}
      >
        {nodes.filter((node) => !node.parentId).map(renderNode)}
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
    mocks.platform.os.mac = false;
    mocks.screenToFlowPosition.mockClear();
    mocks.fitView.mockClear();
  });

  it("keeps a user's camera choice when projection styling changes, but reframes a new request", async () => {
    vi.useFakeTimers();
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    try {
      const requestKey = {};
      const bounds = { x: 1000, y: 1000, width: 100, height: 100 };
      const overlays = (camera: { focusNodes: (ids: readonly string[]) => Promise<void> }) => (
        <button onClick={() => void camera.focusNodes(["search-result"])}>Focus search result</button>
      );
      const { rerender } = render(
        <DiagramCanvas
          edges={[]}
          nodes={[]}
          reserveRight={360}
          focusFrame={{ mode: "bounds", bounds }}
          focusRequestKey={requestKey}
          renderOverlays={overlays}
        />,
      );
      await act(async () => vi.advanceTimersByTimeAsync(50));
      const requestedViewport = { ...mocks.viewport };
      fireEvent.click(screen.getByRole("button", { name: "Focus search result" }));
      const userViewport = { ...mocks.viewport };
      expect(userViewport).not.toEqual(requestedViewport);

      rerender(
        <DiagramCanvas
          edges={[]}
          nodes={[]}
          reserveRight={360}
          focusFrame={{ mode: "bounds", bounds: { ...bounds } }}
          focusRequestKey={requestKey}
          renderOverlays={overlays}
        />,
      );
      await act(async () => vi.advanceTimersByTimeAsync(50));
      expect(mocks.viewport).toEqual(userViewport);

      rerender(
        <DiagramCanvas
          edges={[]}
          nodes={[]}
          reserveRight={360}
          focusFrame={{ mode: "bounds", bounds }}
          focusRequestKey={{}}
          renderOverlays={overlays}
        />,
      );
      await act(async () => vi.advanceTimersByTimeAsync(50));
      expect(mocks.viewport).toEqual(requestedViewport);
    } finally {
      width.mockRestore();
      height.mockRestore();
      vi.useRealTimers();
    }
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
            type: "connection",
            data: { path: "M 0 0 L 100 100", labelPosition: { x: 50, y: 50 } },
          },
        ]}
        nodes={[
          { id: "checkout-page", type: "rectangle", position: { x: 0, y: 0 }, data: { label: "Checkout page" } },
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

  it("annotates authored diamonds and bounding groups but ignores derived outlines", async () => {
    const onCanvasClick = vi.fn();
    render(
      <DiagramCanvas
        edges={[]}
        nodes={[
          { id: "choice", type: "diamond", position: { x: 0, y: 0 }, data: { label: "Continue?" } },
          {
            id: "boundary",
            type: "bounding-group",
            position: { x: 0, y: 0 },
            data: { label: "Boundary", hideTitle: true },
          },
          { id: "derived", type: "bounding-group", position: { x: 0, y: 0 }, data: {} },
        ]}
        onCanvasClick={onCanvasClick}
      />,
    );
    await screen.findByLabelText("React Flow pane");
    fireEvent.click(screen.getByLabelText("React Flow node choice"));
    fireEvent.click(screen.getByLabelText("React Flow node boundary"));
    fireEvent.click(screen.getByLabelText("React Flow node derived"));
    expect(onCanvasClick.mock.calls).toEqual([
      [
        { x: 12, y: 34 },
        { type: "node", id: "choice" },
      ],
      [
        { x: 12, y: 34 },
        { type: "group", id: "boundary" },
      ],
    ]);
  });

  it("focuses node and group shapes, and clears focus on the blank pane", async () => {
    const onNodeActivate = vi.fn();
    const onGroupActivate = vi.fn();
    const onPaneActivate = vi.fn();
    render(
      <DiagramCanvas
        edges={[]}
        nodes={[
          { id: "file", type: "rectangle", position: { x: 0, y: 0 }, data: { label: "File" } },
          { id: "group", type: "labeled-group", position: { x: 0, y: 0 }, data: { label: "Group" } },
        ]}
        onGroupActivate={onGroupActivate}
        onNodeActivate={onNodeActivate}
        onPaneActivate={onPaneActivate}
      />,
    );
    const pane = await screen.findByLabelText("React Flow pane");
    fireEvent.click(screen.getByLabelText("React Flow node file"));
    fireEvent.click(screen.getByLabelText("React Flow node group"));
    fireEvent.click(pane);
    expect(onNodeActivate).toHaveBeenCalledExactlyOnceWith("file");
    expect(onGroupActivate).toHaveBeenCalledExactlyOnceWith("group");
    expect(onPaneActivate).toHaveBeenCalledOnce();
  });

  it("lets child nodes and child groups take precedence over their parent group", async () => {
    const onGroupActivate = vi.fn();
    const onNodeActivate = vi.fn();
    render(
      <DiagramCanvas
        edges={[]}
        nodes={[
          { id: "parent", type: "labeled-group", position: { x: 0, y: 0 }, data: { label: "Parent" } },
          {
            id: "child-group",
            type: "labeled-group",
            parentId: "parent",
            position: { x: 0, y: 0 },
            data: { label: "Child group" },
          },
          {
            id: "child-node",
            type: "rectangle",
            parentId: "parent",
            position: { x: 0, y: 0 },
            data: { label: "Child node" },
          },
        ]}
        onGroupActivate={onGroupActivate}
        onNodeActivate={onNodeActivate}
      />,
    );
    await screen.findByLabelText("React Flow pane");
    fireEvent.click(screen.getByLabelText("React Flow node child-node"));
    fireEvent.click(screen.getByLabelText("React Flow node child-group"));
    expect(onNodeActivate).toHaveBeenCalledExactlyOnceWith("child-node");
    expect(onGroupActivate).toHaveBeenCalledExactlyOnceWith("child-group");
  });

  it("does not forward clicks on interactive elements as canvas clicks", async () => {
    const onCanvasClick = vi.fn();
    render(
      <DiagramCanvas
        edges={[]}
        nodes={[]}
        onCanvasClick={onCanvasClick}
        renderOverlays={() => <button type="button">Node action</button>}
      />,
    );
    const button = await screen.findByRole("button", { name: "Node action" });
    await act(async () => undefined);
    fireEvent.click(button, { clientX: 120, clientY: 80 });
    expect(mocks.screenToFlowPosition).not.toHaveBeenCalled();
    expect(onCanvasClick).not.toHaveBeenCalled();
  });
});
