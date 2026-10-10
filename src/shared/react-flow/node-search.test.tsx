import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Node } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  afterEach(() => vi.restoreAllMocks());

  it("allows caller addons to replace or remove the default search icon", () => {
    const { container, rerender } = render(<NodeSearch />);
    expect(container.querySelector("svg")).toBeInTheDocument();

    rerender(
      <NodeSearch startInputAddon={<span>Scope</span>} endInputAddon={<button type="button">Search help</button>} />,
    );
    expect(screen.getByText("Scope")).toBeVisible();
    expect(screen.getByRole("button", { name: "Search help" })).toBeVisible();
    expect(container.querySelector("svg")).not.toBeInTheDocument();

    rerender(<NodeSearch startInputAddon={null} endInputAddon={null} />);
    expect(screen.queryByText("Scope")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search help" })).not.toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });

  it("highlights search results without moving, then fits the first match on Enter without closing search", async () => {
    const user = userEvent.setup();
    render(<NodeSearch />);
    const input = screen.getByRole("combobox", { name: "Search nodes" });

    await user.type(input, "ALP");
    expect(screen.getByRole("option", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Beta" })).not.toBeInTheDocument();
    expect(mocks.fitView).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(mocks.fitView).toHaveBeenCalledExactlyOnceWith({ nodes: [alpha], duration: 500 });
    expect(input).toHaveValue("ALP");
    expect(input).toHaveFocus();
    expect(screen.getByRole("option", { name: "Alpha", selected: true })).toBeInTheDocument();
    expect(screen.getByText("1/1")).toBeVisible();
  });

  it("cycles every matching node, including duplicate names, and keeps clicks and keyboard navigation in sync", async () => {
    const user = userEvent.setup();
    const first = { ...alpha, id: "render-first", data: { label: "Render" } };
    const second = { ...beta, id: "render-second", data: { label: "Render" } };
    const third = { ...alpha, id: "render-third", data: { label: "RenderPanel" } };
    mocks.state.nodes = [first, second, third];
    render(<NodeSearch />);
    const input = screen.getByRole("combobox", { name: "Search nodes" });

    await user.type(input, "render");
    expect(screen.getByText("0/3")).toBeVisible();
    expect(mocks.fitView).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(mocks.fitView).toHaveBeenLastCalledWith({ nodes: [first], duration: 500 });
    await user.keyboard("{Enter}");
    expect(mocks.fitView).toHaveBeenLastCalledWith({ nodes: [second], duration: 500 });
    expect(screen.getByText("2/3")).toBeVisible();

    await user.keyboard("{ArrowUp}{Shift>}{Enter}{/Shift}");
    expect(mocks.fitView).toHaveBeenLastCalledWith({ nodes: [third], duration: 500 });
    expect(screen.getByRole("option", { name: "RenderPanel", selected: true })).toBeVisible();

    const [, secondOption] = screen.getAllByRole("option", { name: "Render" });
    await user.click(secondOption);
    expect(mocks.fitView).toHaveBeenLastCalledWith({ nodes: [second], duration: 500 });
    expect(input).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(mocks.fitView).toHaveBeenLastCalledWith({ nodes: [third], duration: 500 });

    await user.click(screen.getByRole("button", { name: "Next match" }));
    expect(mocks.fitView).toHaveBeenLastCalledWith({ nodes: [first], duration: 500 });
    await user.click(screen.getByRole("button", { name: "Previous match" }));
    expect(mocks.fitView).toHaveBeenLastCalledWith({ nodes: [third], duration: 500 });
    expect(input).toHaveValue("render");
    expect(input).toHaveFocus();
  });

  it("closes on blur or Escape, retains the query, and restarts navigation from the first match", async () => {
    const user = userEvent.setup();
    render(
      <>
        <NodeSearch />
        <button type="button">Outside search</button>
      </>,
    );
    const input = screen.getByRole("combobox", { name: "Search nodes" });
    await user.type(input, "a");
    await user.keyboard("{Enter}{Enter}");
    expect(screen.getByText("2/2")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Outside search" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveValue("a");

    await user.click(input);
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByText("0/2")).toBeVisible();
    await user.keyboard("{Enter}");
    expect(mocks.fitView).toHaveBeenLastCalledWith({ nodes: [alpha], duration: 500 });

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveValue("a");
    await user.keyboard("{Enter}");
    expect(mocks.fitView).toHaveBeenLastCalledWith({ nodes: [alpha], duration: 500 });
    expect(screen.getByText("1/2")).toBeVisible();

    await user.clear(input);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(input).toHaveValue("");
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

  it("warns only once per instance when invalid default labels first appear", async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const missing: Node = { ...alpha, id: "missing", data: {} };
    const numeric: Node = { ...beta, id: "numeric", data: { label: 42 } };
    render(<NodeSearch />);
    const input = screen.getByRole("combobox", { name: "Search nodes" });

    await user.type(input, "alpha");
    expect(warn).not.toHaveBeenCalled();

    mocks.state.nodes = [missing, numeric, beta];
    await user.clear(input);
    await user.type(input, "missing");
    expect(screen.getByRole("option", { name: "missing" })).toBeInTheDocument();
    expect(warn).toHaveBeenCalledExactlyOnceWith("NodeSearch: Could not resolve a string label for 2 nodes.", {
      nodeIds: ["missing", "numeric"],
    });

    mocks.state.nodes = [{ ...missing, data: { label: "Fixed" } }, numeric, beta];
    await user.clear(input);
    await user.type(input, "fixed");
    expect(screen.getByRole("option", { name: "Fixed" })).toBeInTheDocument();

    mocks.state.nodes = [missing, numeric, { ...alpha, id: "new-missing", data: {} }];
    await user.clear(input);
    await user.type(input, "new-missing");
    expect(screen.getByRole("option", { name: "new-missing" })).toBeInTheDocument();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("includes every invalid node ID in a single expandable warning", async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nodes = Array.from({ length: 300 }, (_, index): Node => ({ ...alpha, id: `node-${index}`, data: {} }));
    mocks.state.nodes = nodes;
    render(<NodeSearch />);

    await user.type(screen.getByRole("combobox", { name: "Search nodes" }), "unmatched");

    expect(warn).toHaveBeenCalledExactlyOnceWith("NodeSearch: Could not resolve a string label for 300 nodes.", {
      nodeIds: nodes.map((node) => node.id),
    });
  });

  it("uses the default label fallback for custom search results without scanning other nodes", async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const missing: Node = { ...alpha, id: "missing", data: {} };
    const onSearch = vi.fn(() => [missing]);
    render(<NodeSearch onSearch={onSearch} />);

    await user.type(screen.getByRole("combobox", { name: "Search nodes" }), "unrelated");
    expect(screen.getByRole("option", { name: "missing" })).toBeInTheDocument();
    expect(mocks.getNodes).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledExactlyOnceWith("NodeSearch: Could not resolve a string label for 1 node.", {
      nodeIds: ["missing"],
    });
  });

  it("resolves labels during search without calling the getter again in render", () => {
    const getNodeLabel = vi.fn((node: TitledNode) => node.data.title);
    mocks.state.nodes = [titled];
    render(<NodeSearch<TitledNode> getNodeLabel={getNodeLabel} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Search nodes" }), { target: { value: "readable" } });

    expect(screen.getByRole("option", { name: "Readable title" })).toBeInTheDocument();
    expect(getNodeLabel).toHaveBeenCalledExactlyOnceWith(titled);
  });

  it("throws without warning for invalid custom labels even with custom search", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const getNodeLabel = (() => undefined) as unknown as (node: Node) => string;
    render(<NodeSearch getNodeLabel={getNodeLabel} onSearch={() => [alpha]} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Search nodes" }), { target: { value: "a" } });
    expect(
      report.mock.calls.some(
        ([error]) =>
          error instanceof TypeError &&
          error.message === "NodeSearch: getNodeLabel must return a string for node alpha.",
      ),
    ).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("propagates custom getter errors without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("Cannot read title");
    render(
      <NodeSearch
        getNodeLabel={() => {
          throw error;
        }}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Search nodes" }), { target: { value: "a" } });
    expect(report.mock.calls.some(([reported]) => reported === error)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
