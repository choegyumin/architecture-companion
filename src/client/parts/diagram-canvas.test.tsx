import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, MouseEvent, ReactNode } from "react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DiagramCanvas } from "@/client/parts/diagram-canvas";

const mocks = vi.hoisted(() => {
  const screenToFlowPosition = vi.fn(() => ({ x: 12, y: 34 }));
  const fitView = vi.fn();
  return {
    platform: { os: { mac: false } },
    flowInstance: { screenToFlowPosition, fitView },
    nodes: [] as { id: string; type: string; parentId?: string; className?: string }[],
    screenToFlowPosition,
    fitView,
  };
});

vi.mock("@base-ui/utils/platform", () => ({ platform: mocks.platform }));

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  ControlButton: ({ children, ...props }: ComponentProps<"button">) => <button {...props}>{children}</button>,
  Controls: ({ children }: { children: ReactNode }) => <>{children}</>,
  Panel: ({ children }: { children: ReactNode }) => <>{children}</>,
  useReactFlow: () => ({ getNodes: () => mocks.nodes }),
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
    mocks.nodes = [...nodes];
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
            type: "route",
            data: { path: "M 0 0 L 100 100", labelPosition: { x: 50, y: 50 } },
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

  it("focuses node and group shapes, and clears focus on the blank pane", async () => {
    const onNodeActivate = vi.fn();
    const onGroupActivate = vi.fn();
    const onPaneActivate = vi.fn();
    render(
      <DiagramCanvas
        edges={[]}
        nodes={[
          { id: "file", type: "card", position: { x: 0, y: 0 }, data: { label: "File" } },
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
            type: "card",
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

  it("highlights all matches without moving, then fits each node or group on the first and subsequent navigation gestures", async () => {
    const user = userEvent.setup();
    const onNodeActivate = vi.fn();
    const onGroupActivate = vi.fn();
    const labels = new Map([
      ["file", "Render"],
      ["group", "Render"],
    ]);
    render(
      <DiagramCanvas
        edges={[]}
        getNodeLabel={(node) => labels.get(node.id) ?? ""}
        nodes={[
          {
            id: "file",
            type: "card",
            className: "existing-class",
            position: { x: 0, y: 0 },
            data: { label: "Render" },
          },
          { id: "group", type: "labeled-group", position: { x: 0, y: 0 }, data: { label: "Render" } },
          { id: "bounding-group:group", type: "bounding-group", position: { x: 0, y: 0 }, data: {} },
        ]}
        onGroupActivate={onGroupActivate}
        onNodeActivate={onNodeActivate}
      />,
    );
    const input = await screen.findByRole("combobox", { name: "Search nodes" });
    const file = screen.getByLabelText("React Flow node file");
    const group = screen.getByLabelText("React Flow node group");

    await user.type(input, "RENDER");
    expect(screen.getAllByRole("option", { name: "Render" })).toHaveLength(2);
    expect(file).toHaveClass("existing-class", "is-search-match");
    expect(group).toHaveClass("is-search-match");
    expect(file).not.toHaveClass("is-search-current");
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(onNodeActivate).not.toHaveBeenCalled();
    expect(onGroupActivate).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(onNodeActivate).toHaveBeenCalledExactlyOnceWith("file");
    expect(mocks.fitView).toHaveBeenLastCalledWith({
      nodes: [{ id: "file" }],
      minZoom: 0.01,
      maxZoom: 1,
      padding: "24px",
      duration: 500,
    });
    expect(file).toHaveClass("is-search-current");
    expect(group).not.toHaveClass("is-search-current");

    await user.keyboard("{Enter}");
    expect(onGroupActivate).toHaveBeenCalledExactlyOnceWith("group");
    expect(mocks.fitView).toHaveBeenLastCalledWith({
      nodes: [{ id: "group" }],
      minZoom: 0.01,
      maxZoom: 1,
      padding: "24px",
      duration: 500,
    });
    expect(group).toHaveClass("is-search-current");
    expect(file).not.toHaveClass("is-search-current");
    expect(input).toHaveValue("RENDER");

    const [firstOption] = screen.getAllByRole("option", { name: "Render" });
    await user.click(firstOption);
    expect(mocks.fitView).toHaveBeenLastCalledWith({
      nodes: [{ id: "file" }],
      minZoom: 0.01,
      maxZoom: 1,
      padding: "24px",
      duration: 500,
    });
    expect(screen.getByText("1/2")).toBeVisible();
    expect(input).toHaveFocus();
    expect(mocks.nodes.every((node) => !("selected" in node))).toBe(true);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(file).not.toHaveClass("is-search-match", "is-search-current");
    expect(group).not.toHaveClass("is-search-match", "is-search-current");
    expect(file).toHaveClass("existing-class");

    await user.clear(input);
    await user.type(input, "bounding-group");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(mocks.fitView).toHaveBeenCalledTimes(3);
  });

  it.each([
    {
      os: "macOS",
      mac: true,
      modifier: { metaKey: true },
      wrongModifier: { ctrlKey: true },
      shortcut: "⌘K",
    },
    {
      os: "Windows/Linux",
      mac: false,
      modifier: { ctrlKey: true },
      wrongModifier: { metaKey: true },
      shortcut: "Ctrl+K",
    },
  ])("focuses node search with the advertised shortcut on $os", async ({ mac, modifier, wrongModifier, shortcut }) => {
    mocks.platform.os.mac = mac;
    const { unmount } = render(<DiagramCanvas edges={[]} nodes={[]} getNodeLabel={(node) => node.id} />);
    const input = await screen.findByRole("combobox", { name: "Search nodes" });
    expect(input).toHaveAttribute("placeholder", "Search nodes...");
    expect(screen.getByText(shortcut)).toBeVisible();

    expect(fireEvent.keyDown(document, { key: "k", ...wrongModifier })).toBe(true);
    expect(input).not.toHaveFocus();

    expect(fireEvent.keyDown(document, { key: "k", ...modifier })).toBe(false);
    expect(input).toHaveFocus();

    unmount();
    expect(fireEvent.keyDown(document, { key: "k", ...modifier })).toBe(true);
  });

  it.each([
    { key: "k" },
    { key: "j", ctrlKey: true },
    { key: "k", ctrlKey: true, metaKey: true },
    { key: "k", ctrlKey: true, altKey: true },
    { key: "k", ctrlKey: true, shiftKey: true },
    { key: "k", ctrlKey: true, repeat: true },
    { key: "k", ctrlKey: true, isComposing: true },
  ])("does not intercept unrelated or conflicting key events: %j", async (event) => {
    render(<DiagramCanvas edges={[]} nodes={[]} getNodeLabel={(node) => node.id} />);
    const input = await screen.findByRole("combobox", { name: "Search nodes" });

    expect(fireEvent.keyDown(document, event)).toBe(true);
    expect(input).not.toHaveFocus();
  });

  it("stops intercepting the shortcut when search is unavailable", async () => {
    const { rerender } = render(<DiagramCanvas edges={[]} nodes={[]} getNodeLabel={(node) => node.id} />);
    await screen.findByRole("combobox", { name: "Search nodes" });

    rerender(<DiagramCanvas edges={[]} nodes={[]} />);

    expect(screen.queryByRole("combobox", { name: "Search nodes" })).not.toBeInTheDocument();
    expect(fireEvent.keyDown(document, { key: "k", ctrlKey: true })).toBe(true);
  });
});
