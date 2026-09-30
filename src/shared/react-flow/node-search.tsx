import { type Node, useReactFlow } from "@xyflow/react";
import { useCallback, useState } from "react";

import { cn } from "@/shared/react/class-name";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/shared/react-ui/command";

export type NodeSearchProps<NodeType extends Node = Node> = Readonly<{
  className?: string;
  getNodeLabel?: (node: NodeType) => string;
  onSearch?: (searchString: string) => NodeType[];
  onSelectNode?: (node: NodeType) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}>;

function defaultGetNodeLabel(node: Node): string {
  return node.data.label as string;
}

// Based on https://ui.reactflow.dev/node-search; getNodeLabel drives both default search and result text.
function NodeSearchInternal<NodeType extends Node>({
  getNodeLabel = defaultGetNodeLabel,
  onSearch,
  onSelectNode,
  open,
  onOpenChange,
}: NodeSearchProps<NodeType>) {
  const [searchResults, setSearchResults] = useState<NodeType[]>([]);
  const [searchString, setSearchString] = useState("");
  const { getNodes, fitView, setNodes } = useReactFlow<NodeType>();

  const defaultOnSearch = useCallback(
    (searchString: string) =>
      getNodes().filter((node) => getNodeLabel(node).toLowerCase().includes(searchString.toLowerCase())),
    [getNodes, getNodeLabel],
  );

  const onChange = useCallback(
    (value: string) => {
      setSearchString(value);
      setSearchResults(value ? (onSearch ?? defaultOnSearch)(value) : []);
      onOpenChange?.(value.length > 0);
    },
    [defaultOnSearch, onOpenChange, onSearch],
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
        onFocus={() => onOpenChange?.(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onOpenChange?.(false);
        }}
        onValueChange={onChange}
        placeholder="Search nodes..."
        value={searchString}
      />
      {open && searchString ? (
        <CommandList>
          {searchResults.length === 0 ? (
            <CommandEmpty>No results found.</CommandEmpty>
          ) : (
            <CommandGroup heading="Nodes">
              {searchResults.map((node) => (
                <CommandItem key={node.id} onSelect={() => onSelect(node)} value={node.id}>
                  {getNodeLabel(node)}
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
