import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Node } from "@xyflow/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NodeSearch } from "@/shared/react-flow/node-search";

const mocks = vi.hoisted(() => {
  const state = { nodes: [] as Node[] };
  return {
    state,
    getNodes: vi.fn(() => state.nodes),
    setNodes: vi.fn((change: (nodes: Node[]) => Node[]) => {
      state.nodes = change(state.nodes);
    }),
    fitView: vi.fn(),
  };
});

vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  useReactFlow: () => mocks,
}));

const alpha: Node = { id: "alpha", type: "card", position: { x: 0, y: 0 }, data: { label: "Alpha" } };
const beta: Node = { id: "beta", type: "card", position: { x: 0, y: 0 }, data: { label: "Beta" } };
type TitledNode = Node<{ label: string; title: string }, "card">;
const titled: TitledNode = { ...alpha, type: "card", data: { label: "Hidden", title: "Readable title" } };

describe("NodeSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.nodes = [alpha, beta];
  });

  it("searches data.label without regard to case and selects and fits the chosen node by default", async () => {
    const user = userEvent.setup();
    render(<NodeSearch />);

    await user.type(screen.getByRole("combobox", { name: "Search nodes" }), "ALP");
    expect(screen.getByRole("option", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Beta" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "Alpha" }));
    expect(mocks.state.nodes.find((node) => node.id === "alpha")?.selected).toBe(true);
    expect(mocks.fitView).toHaveBeenCalledExactlyOnceWith({ nodes: [alpha], duration: 500 });
    expect(screen.getByRole("combobox", { name: "Search nodes" })).toHaveValue("");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("uses getNodeLabel for both default search and result text", async () => {
    const user = userEvent.setup();
    mocks.state.nodes = [titled];
    render(<NodeSearch<TitledNode> getNodeLabel={(node) => node.data.title} />);

    await user.type(screen.getByRole("combobox", { name: "Search nodes" }), "readable");
    expect(screen.getByRole("option", { name: "Readable title" })).toBeInTheDocument();

    await user.clear(screen.getByRole("combobox", { name: "Search nodes" }));
    await user.type(screen.getByRole("combobox", { name: "Search nodes" }), "hidden");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByText("No results found.")).toBeInTheDocument();
  });

  it("lets onSearch and onSelectNode replace the defaults while retaining the display label", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn(() => [titled]);
    const onSelectNode = vi.fn((title: string) => title);
    render(
      <NodeSearch
        getNodeLabel={(node) => `Result: ${node.data.title.toUpperCase()}`}
        onSearch={onSearch}
        onSelectNode={(node) => onSelectNode(node.data.title)}
      />,
    );

    await user.type(screen.getByRole("combobox", { name: "Search nodes" }), "unrelated");
    expect(onSearch).toHaveBeenLastCalledWith("unrelated");
    await user.click(screen.getByRole("option", { name: "Result: READABLE TITLE" }));

    expect(onSelectNode).toHaveBeenCalledExactlyOnceWith("Readable title");
    expect(mocks.setNodes).not.toHaveBeenCalled();
    expect(mocks.fitView).not.toHaveBeenCalled();
  });
});
