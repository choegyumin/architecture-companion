import { type Node, useReactFlow } from "@xyflow/react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { type ReactNode, type Ref, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { cn } from "@/shared/react/class-name";

export type NodeSearchProps<NodeType extends Node = Node> = Readonly<{
  className?: string;
  getNodeLabel?: (node: NodeType) => string;
  inputRef?: Ref<HTMLInputElement>;
  placeholder?: string;
  startInputAddon?: ReactNode;
  endInputAddon?: ReactNode;
  onSearch?: (searchString: string) => NodeType[];
  /** Visits a match without ending the search. Defaults to fitting the viewport to the node. */
  onSelectNode?: (node: NodeType) => void;
  /** Visible matches and the visited match, for presentation without viewport movement. */
  onMatchesChange?: (nodes: readonly NodeType[], currentNode: NodeType | null) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}>;

type SearchResult<NodeType extends Node> = Readonly<{ node: NodeType; label: string }>;

function defaultGetNodeLabel(node: Node): unknown {
  return node.data?.label;
}

export function NodeSearch<NodeType extends Node = Node>({
  className,
  getNodeLabel,
  inputRef,
  placeholder = "Search nodes...",
  startInputAddon = <Search aria-hidden="true" className="size-4" />,
  endInputAddon,
  onSearch,
  onSelectNode,
  onMatchesChange,
  open,
  onOpenChange,
}: NodeSearchProps<NodeType>) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult<NodeType>[]>([]);
  const [searchString, setSearchString] = useState("");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const hasWarnedInvalidLabel = useRef(false);
  const currentOptionRef = useRef<HTMLLIElement>(null);
  const listId = useId();
  const { getNodes, fitView } = useReactFlow<NodeType>();
  const isOpen = (open ?? internalOpen) && Boolean(searchString);
  const currentIndex = searchResults.findIndex(({ node }) => node.id === currentId);
  const matchingNodes = useMemo(() => searchResults.map(({ node }) => node), [searchResults]);
  const currentNode = currentIndex === -1 ? null : searchResults[currentIndex].node;

  useEffect(() => {
    onMatchesChange?.(isOpen ? matchingNodes : [], isOpen ? currentNode : null);
  }, [currentNode, isOpen, matchingNodes, onMatchesChange]);

  const changeOpen = useCallback(
    (nextOpen: boolean) => {
      if (open === undefined) setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange, open],
  );

  const onChange = useCallback(
    (value: string) => {
      if (!value) {
        setSearchString("");
        setSearchResults([]);
        setCurrentId(null);
        changeOpen(false);
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
      setCurrentId(null);
      changeOpen(true);
    },
    [changeOpen, getNodeLabel, getNodes, onSearch],
  );

  const close = () => {
    setCurrentId(null);
    changeOpen(false);
  };

  // Every navigation gesture uses this path, including the first Enter and list clicks.
  const visit = (index: number) => {
    const { node } = searchResults[index];
    setCurrentId(node.id);
    changeOpen(true);
    if (onSelectNode) onSelectNode(node);
    else void fitView({ nodes: [node], duration: 500 });
  };

  const step = (direction: 1 | -1) => {
    if (searchResults.length === 0) return;
    const index =
      currentIndex === -1
        ? direction === 1
          ? 0
          : searchResults.length - 1
        : (currentIndex + direction + searchResults.length) % searchResults.length;
    visit(index);
  };

  useEffect(() => {
    currentOptionRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [currentId]);

  return (
    <div
      className={cn(
        "w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md",
        className,
      )}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <div className="flex h-10 items-center gap-2 px-3">
        {startInputAddon != null ? (
          <div className="flex shrink-0 items-center text-muted-foreground">{startInputAddon}</div>
        ) : null}
        <input
          aria-activedescendant={isOpen && currentIndex !== -1 ? `${listId}-${currentIndex}` : undefined}
          aria-autocomplete="list"
          aria-controls={isOpen ? listId : undefined}
          aria-expanded={isOpen}
          aria-label="Search nodes"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => {
            if (searchString) onChange(searchString);
            else changeOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            } else if (event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              event.stopPropagation();
              step(event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey) ? -1 : 1);
            }
          }}
          placeholder={placeholder}
          ref={inputRef}
          role="combobox"
          type="text"
          value={searchString}
        />
        {isOpen ? (
          <>
            <span aria-live="polite" className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {currentIndex + 1}/{searchResults.length}
            </span>
            <button
              aria-label="Previous match"
              className="rounded-sm p-1 hover:bg-accent disabled:opacity-40"
              disabled={searchResults.length === 0}
              onClick={() => step(-1)}
              onMouseDown={(event) => event.preventDefault()}
              title="Previous match (Shift+Enter)"
              type="button"
            >
              <ChevronUp aria-hidden="true" className="size-4" />
            </button>
            <button
              aria-label="Next match"
              className="rounded-sm p-1 hover:bg-accent disabled:opacity-40"
              disabled={searchResults.length === 0}
              onClick={() => step(1)}
              onMouseDown={(event) => event.preventDefault()}
              title="Next match (Enter)"
              type="button"
            >
              <ChevronDown aria-hidden="true" className="size-4" />
            </button>
          </>
        ) : endInputAddon != null ? (
          <div className="flex shrink-0 items-center text-muted-foreground">{endInputAddon}</div>
        ) : null}
      </div>
      {isOpen ? (
        <>
          <ul aria-label="Nodes" className="max-h-64 overflow-y-auto border-t p-1" id={listId} role="listbox">
            {searchResults.map(({ node, label }, index) => (
              <li
                aria-selected={index === currentIndex}
                className={cn(
                  "cursor-pointer rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                  index === currentIndex && "bg-accent text-accent-foreground",
                )}
                id={`${listId}-${index}`}
                key={node.id}
                onClick={() => visit(index)}
                onMouseDown={(event) => event.preventDefault()}
                ref={index === currentIndex ? currentOptionRef : undefined}
                role="option"
              >
                {label}
              </li>
            ))}
          </ul>
          {searchResults.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No results found.</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
