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

export type NodeSearchProps<NodeType extends Node = Node> = Readonly<{
  className?: string;
  getNodeLabel?: (node: NodeType) => string;
  inputRef?: Ref<HTMLInputElement>;
  placeholder?: string;
  startInputAddon?: ReactNode;
  endInputAddon?: ReactNode;
  onSearch?: (searchString: string) => NodeType[];
  /** Visits a match during navigation or confirmation. Defaults to fitting the viewport to the node. */
  onSelectNode?: (node: NodeType) => void;
  /** Visible matches and the visited match, for presentation without viewport movement. */
  onMatchesChange?: (nodes: readonly NodeType[], currentNode: NodeType | null) => void;
  /** Controlled query — the URL mirror. When given, typing reports through onSearchQueryChange and an external change arrives as if typed here. */
  searchQuery?: string;
  onSearchQueryChange?: (searchString: string) => void;
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
  searchQuery,
  onSearchQueryChange,
  open,
  onOpenChange,
}: NodeSearchProps<NodeType>) {
  const [typedQuery, setTypedQuery] = useState<string | null>(null);
  const [externalQuery, setExternalQuery] = useState(searchQuery);
  const [internalOpen, setInternalOpen] = useState(Boolean(searchQuery));
  const [currentId, setCurrentId] = useState<string | null>(null);
  const hasWarnedInvalidLabel = useRef(false);
  const arrowKeyRef = useRef<"ArrowDown" | "ArrowUp" | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputElementRef = useRef<HTMLInputElement>(null);
  const { getNodes, fitView } = useReactFlow<NodeType>();
  // useReactFlow gives no identity guarantee for its members: an unstable
  // getNodes in the results memo below would recompute the results on every
  // render and loop the match reporting. The mount-time getter is held
  // instead — it still reads the live node store when invoked.
  const [stableGetNodes] = useState(() => getNodes);
  // An external query change (a URL navigation) replaces whatever was typed
  // and arrives as if it were typed here; adjusting state during render keeps
  // the mirror immediate without an effect pass.
  if (searchQuery !== externalQuery) {
    setExternalQuery(searchQuery);
    setTypedQuery(null);
    setInternalOpen(Boolean(searchQuery));
  }
  const searchString = typedQuery ?? externalQuery ?? "";
  const search = useMemo<Readonly<{ results: SearchResult<NodeType>[]; invalidIds: string[] }>>(() => {
    if (!searchString) return { results: [], invalidIds: [] };

    // A broken label getter is a caller bug; computing during render means
    // its error must not take the render down, so it is reported the way
    // event-handler errors surface instead of thrown.
    try {
      const nodes = onSearch ? onSearch(searchString) : stableGetNodes();
      const invalidIds: string[] = [];
      const results: SearchResult<NodeType>[] = [];
      const query = searchString.toLowerCase();

      for (const node of nodes) {
        const label: unknown = (getNodeLabel ?? defaultGetNodeLabel)(node);
        if (typeof label !== "string" && getNodeLabel) {
          throw new TypeError(`NodeSearch: getNodeLabel must return a string for node ${node.id}.`);
        }
        if (typeof label !== "string") invalidIds.push(node.id);

        const resolvedLabel = typeof label === "string" ? label : node.id;
        if (onSearch || resolvedLabel.toLowerCase().includes(query)) results.push({ node, label: resolvedLabel });
      }

      return { results, invalidIds };
    } catch (error) {
      console.error(error);
      return { results: [], invalidIds: [] };
    }
  }, [searchString, getNodeLabel, onSearch, stableGetNodes]);
  const searchResults = search.results;
  const isOpen = (open ?? internalOpen) && Boolean(searchString);
  const currentIndex = searchResults.findIndex(({ node }) => node.id === currentId);
  const matchingNodes = useMemo(() => searchResults.map(({ node }) => node), [searchResults]);
  const currentNode = currentIndex === -1 ? null : searchResults[currentIndex].node;

  useEffect(() => {
    if (search.invalidIds.length === 0 || hasWarnedInvalidLabel.current) return;
    hasWarnedInvalidLabel.current = true;
    console.warn(
      `NodeSearch: Could not resolve a string label for ${search.invalidIds.length} ${search.invalidIds.length === 1 ? "node" : "nodes"}.`,
      { nodeIds: search.invalidIds },
    );
  }, [search]);

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
      setTypedQuery(value);
      onSearchQueryChange?.(value);
      setCurrentId(null);
      if (!value) changeOpen(false);
      else if (open === undefined) setInternalOpen(true);
    },
    [changeOpen, onSearchQueryChange, open],
  );

  const close = () => {
    setCurrentId(null);
    changeOpen(false);
  };

  // Every navigation gesture uses this path: arrow keys, pointer highlighting, buttons, Enter, and clicks.
  const visit = (node: NodeType) => {
    setCurrentId(node.id);
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
              event.stopPropagation();
              changeSearchString("");
            } else if (event.key === "Enter") {
              // A plain Enter with a highlighted match presses it through the
              // combobox (single confirm path via the item's onClick). The two
              // cases the combobox ignores are confirmed here instead.
              if (currentIndex === -1 || event.shiftKey) {
                event.preventDefault();
                event.stopPropagation();
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
