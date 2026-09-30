import { type Node, useReactFlow } from "@xyflow/react";
import { type ReactNode, type Ref, useCallback, useRef, useState } from "react";

import { cn } from "@/shared/react/class-name";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/shared/react-ui/command";

export type NodeSearchProps<NodeType extends Node = Node> = Readonly<{
  className?: string;
  getNodeLabel?: (node: NodeType) => string;
  inputRef?: Ref<HTMLInputElement>;
  placeholder?: string;
  startInputAddon?: ReactNode;
  endInputAddon?: ReactNode;
  onSearch?: (searchString: string) => NodeType[];
  onSelectNode?: (node: NodeType) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}>;

type SearchResult<NodeType extends Node> = Readonly<{ node: NodeType; label: string }>;

function defaultGetNodeLabel(node: Node): unknown {
  return node.data?.label;
}

// Based on https://ui.reactflow.dev/node-search; getNodeLabel drives both default search and result text.
function NodeSearchInternal<NodeType extends Node>({
  getNodeLabel,
  inputRef,
  placeholder = "Search nodes...",
  startInputAddon,
  endInputAddon,
  onSearch,
  onSelectNode,
  open,
  onOpenChange,
}: NodeSearchProps<NodeType>) {
  const [searchResults, setSearchResults] = useState<SearchResult<NodeType>[]>([]);
  const [searchString, setSearchString] = useState("");
  const hasWarnedInvalidLabel = useRef(false);
  const { getNodes, fitView, setNodes } = useReactFlow<NodeType>();

  const onChange = useCallback(
    (value: string) => {
      if (!value) {
        setSearchString("");
        setSearchResults([]);
        onOpenChange?.(false);
        return;
      }

      const nodes = onSearch ? onSearch(value) : getNodes();
      const invalidIds: string[] = [];
      const results: SearchResult<NodeType>[] = [];
      const search = value.toLowerCase();

      for (const node of nodes) {
        const label: unknown = (getNodeLabel ?? defaultGetNodeLabel)(node);
        if (typeof label !== "string" && getNodeLabel) {
          throw new TypeError(`NodeSearch: getNodeLabel must return a string for node ${node.id}.`);
        }
        if (typeof label !== "string") invalidIds.push(node.id);

        const resolvedLabel = typeof label === "string" ? label : node.id;
        if (onSearch || resolvedLabel.toLowerCase().includes(search)) results.push({ node, label: resolvedLabel });
      }

      if (!hasWarnedInvalidLabel.current && invalidIds.length > 0) {
        hasWarnedInvalidLabel.current = true;
        console.warn(
          `NodeSearch: Could not resolve a string label for ${invalidIds.length} ${invalidIds.length === 1 ? "node" : "nodes"}.`,
          { nodeIds: invalidIds },
        );
      }
      setSearchString(value);
      setSearchResults(results);
      onOpenChange?.(true);
    },
    [getNodeLabel, getNodes, onOpenChange, onSearch],
  );

  const defaultOnSelectNode = useCallback(
    (node: NodeType) => {
      setNodes((nodes) =>
        nodes.map((candidate) => (candidate.id === node.id ? { ...candidate, selected: true } : candidate)),
      );
      void fitView({ nodes: [node], duration: 500 });
    },
    [fitView, setNodes],
  );

  const onSelect = useCallback(
    (node: NodeType) => {
      (onSelectNode ?? defaultOnSelectNode)(node);
      setSearchString("");
      setSearchResults([]);
      onOpenChange?.(false);
    },
    [defaultOnSelectNode, onOpenChange, onSelectNode],
  );

  return (
    <>
      <CommandInput
        aria-label="Search nodes"
        startAddon={startInputAddon}
        endAddon={endInputAddon}
        onFocus={() => onOpenChange?.(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onOpenChange?.(false);
        }}
        onValueChange={onChange}
        placeholder={placeholder}
        ref={inputRef}
        value={searchString}
      />
      {open && searchString ? (
        <CommandList>
          {searchResults.length === 0 ? (
            <CommandEmpty>No results found.</CommandEmpty>
          ) : (
            <CommandGroup heading="Nodes">
              {searchResults.map(({ node, label }) => (
                <CommandItem key={node.id} onSelect={() => onSelect(node)} value={node.id}>
                  {label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      ) : null}
    </>
  );
}

export function NodeSearch<NodeType extends Node = Node>({
  className,
  open,
  onOpenChange,
  ...props
}: NodeSearchProps<NodeType>) {
  const [internalOpen, setInternalOpen] = useState(false);
  const changeOpen = useCallback(
    (nextOpen: boolean) => {
      if (open === undefined) setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange, open],
  );

  return (
    <Command
      className={cn("w-[min(28rem,calc(100vw-2rem))] border shadow-md", className)}
      label="Search nodes"
      shouldFilter={false}
    >
      <NodeSearchInternal<NodeType> {...props} onOpenChange={changeOpen} open={open ?? internalOpen} />
    </Command>
  );
}
