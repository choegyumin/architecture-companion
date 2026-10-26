import { type Node, useReactFlow } from "@xyflow/react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@/shared/react/class-name";
import {
  Combobox,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPositioner,
} from "@/shared/react-ui/combobox";

export type ElementSearchProps<NodeType extends Node = Node> = Readonly<{
  className?: string;
  getNodeLabel?: (node: NodeType) => string;
  inputRef?: Ref<HTMLInputElement>;
  placeholder?: string;
  /** When supplied, the caller owns the query, including restoration through navigation. */
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  startInputAddon?: ReactNode;
  endInputAddon?: ReactNode;
  onSearch?: (searchString: string) => NodeType[];
  /** Visits a match during navigation or confirmation. Defaults to fitting the viewport to the node. */
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

export function ElementSearch<NodeType extends Node = Node>({
  className,
  getNodeLabel,
  inputRef,
  placeholder = "Search nodes...",
  searchQuery,
  onSearchQueryChange,
  startInputAddon = <Search aria-hidden="true" className="size-4" />,
  endInputAddon,
  onSearch,
  onSelectNode,
  onMatchesChange,
  open,
  onOpenChange,
}: ElementSearchProps<NodeType>) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [internalSearchString, setInternalSearchString] = useState("");
  const searchString = searchQuery ?? internalSearchString;
  const [selection, setSelection] = useState<{ query: string; id: string | null }>({ query: "", id: null });
  if (selection.query !== searchString) setSelection({ query: searchString, id: null });
  const currentId = selection.query === searchString ? selection.id : null;
  const hasWarnedInvalidLabel = useRef(false);
  const arrowKeyRef = useRef<"ArrowDown" | "ArrowUp" | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputElementRef = useRef<HTMLInputElement>(null);
  const { getNodes, fitView } = useReactFlow<NodeType>();
  const { results: searchResults, invalidIds } = useMemo(() => {
    if (!searchString) return { results: [], invalidIds: [] };
    const nodes = onSearch ? onSearch(searchString) : getNodes();
    const invalidIds: string[] = [];
    const results: SearchResult<NodeType>[] = [];
    const search = searchString.toLowerCase();
    for (const node of nodes) {
      const label: unknown = (getNodeLabel ?? defaultGetNodeLabel)(node);
      if (typeof label !== "string" && getNodeLabel) {
        throw new TypeError(`ElementSearch: getNodeLabel must return a string for node ${node.id}.`);
      }
      if (typeof label !== "string") invalidIds.push(node.id);
      const resolvedLabel = typeof label === "string" ? label : node.id;
      if (onSearch || resolvedLabel.toLowerCase().includes(search)) results.push({ node, label: resolvedLabel });
    }
    return { results, invalidIds };
  }, [getNodeLabel, getNodes, onSearch, searchString]);
  useEffect(() => {
    if (hasWarnedInvalidLabel.current || invalidIds.length === 0) return;
    hasWarnedInvalidLabel.current = true;
    console.warn(
      `ElementSearch: Could not resolve a string label for ${invalidIds.length} ${invalidIds.length === 1 ? "node" : "nodes"}.`,
      { nodeIds: invalidIds },
    );
  }, [invalidIds]);
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

  const changeSearchString = useCallback(
    (value: string) => {
      if (searchQuery === undefined) setInternalSearchString(value);
      onSearchQueryChange?.(value);
      setSelection({ query: searchString, id: null });
      changeOpen(Boolean(value));
    },
    [changeOpen, onSearchQueryChange, searchQuery, searchString],
  );

  const close = () => {
    setSelection({ query: searchString, id: null });
    changeOpen(false);
  };

  // Every navigation gesture uses this path: arrow keys, pointer highlighting, buttons, Enter, and clicks.
  const visit = (node: NodeType) => {
    setSelection({ query: searchString, id: node.id });
    if (onSelectNode) onSelectNode(node);
    else void fitView({ nodes: [node], duration: 500 });
  };

  const confirm = (index: number) => {
    if (!isOpen || searchResults.length === 0) return;
    visit(searchResults[index].node);
    close();
  };

  // Expose the input element to the caller's ref without hand-merging refs
  // (React itself assigns it through useImperativeHandle).
  useImperativeHandle(inputRef, () => inputElementRef.current as HTMLInputElement, []);

  // The combobox owns keyboard traversal; move its highlight by dispatching the arrow key it listens for.
  const stepHighlight = (key: "ArrowDown" | "ArrowUp") => {
    // Set the direction first: the dispatch is processed synchronously, before
    // the keydown bubbles back through this component's own handler.
    arrowKeyRef.current = key;
    inputElementRef.current?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  };

  return (
    <Combobox<SearchResult<NodeType>>
      filter={null}
      highlightItemOnHover={false}
      inputValue={searchString}
      itemToStringLabel={({ label }) => label}
      onInputValueChange={(value, details) => {
        // Only typing changes the query: pressing a match syncs the input to the
        // item label ("item-press" / "none"), which must not replace the query.
        if (details.reason === "input-change") changeSearchString(value);
      }}
      onItemHighlighted={(result, details) => {
        if (!result) {
          // Wrapping passes through an unhighlighted gap; re-issuing the arrow
          // lands directly on the wrapped match.
          if (details.reason === "keyboard" && arrowKeyRef.current) stepHighlight(arrowKeyRef.current);
          return;
        }
        // Programmatic changes (list refresh) must not move the viewport; user navigation must.
        if (details.reason === "none") return;
        visit(result.node);
      }}
      onOpenChange={(nextOpen) => {
        if (nextOpen) changeOpen(true);
        else close();
      }}
      open={isOpen}
    >
      {/* The input group keeps the whole row — including the step buttons —
          inside the combobox's trigger area, so pressing a button never reads
          as an outside press that closes the popup. */}
      <ComboboxInputGroup
        className={cn(
          "flex h-10 w-[min(28rem,calc(100vw-2rem))] items-center gap-2 rounded-lg border bg-popover px-3 text-popover-foreground shadow-md",
          className,
        )}
        ref={cardRef}
      >
        {startInputAddon != null ? (
          <div className="flex shrink-0 items-center text-muted-foreground">{startInputAddon}</div>
        ) : null}
        <ComboboxInput
          aria-label="Search nodes"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              arrowKeyRef.current = event.key;
              return;
            }
            if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
              if (event.key === "Enter") event.preventDefault();
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              changeSearchString("");
            } else if (event.key === "Enter") {
              // A plain Enter with a highlighted match presses it through the
              // combobox (single confirm path via the item's onClick). The two
              // cases the combobox ignores are confirmed here instead.
              if (currentIndex === -1 || event.shiftKey) {
                event.preventDefault();
                confirm(currentIndex === -1 ? 0 : currentIndex);
              }
            }
          }}
          placeholder={placeholder}
          ref={inputElementRef}
          type="text"
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
              onClick={() => stepHighlight("ArrowUp")}
              onMouseDown={(event) => event.preventDefault()}
              title="Previous match (↑)"
              type="button"
            >
              <ChevronUp aria-hidden="true" className="size-4" />
            </button>
            <button
              aria-label="Next match"
              className="rounded-sm p-1 hover:bg-accent disabled:opacity-40"
              disabled={searchResults.length === 0}
              onClick={() => stepHighlight("ArrowDown")}
              onMouseDown={(event) => event.preventDefault()}
              title="Next match (↓)"
              type="button"
            >
              <ChevronDown aria-hidden="true" className="size-4" />
            </button>
          </>
        ) : endInputAddon != null ? (
          <div className="flex shrink-0 items-center text-muted-foreground">{endInputAddon}</div>
        ) : null}
      </ComboboxInputGroup>
      <ComboboxPositioner anchor={cardRef}>
        <ComboboxPopup>
          <ComboboxList>
            {searchResults.map((result, index) => (
              <ComboboxItem key={result.node.id} onClick={() => confirm(index)} value={result}>
                {result.label}
              </ComboboxItem>
            ))}
          </ComboboxList>
          {searchResults.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No results found.</p>
          ) : null}
        </ComboboxPopup>
      </ComboboxPositioner>
    </Combobox>
  );
}
