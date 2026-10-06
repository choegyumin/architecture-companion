import { Split } from "lucide-react";

import { cn } from "@/shared/react/class-name";

// The combined activation condition of one route, written once on the edge.
// A leading split icon marks routes that carry a branch case; plain
// conditional gates keep the bare text. The label wraps at a fixed max width
// instead of growing an unbounded row, and clicking it applies the route's
// whole rule (the inferred before/after diff hover previews).
export function RouteConditionLabel({
  includesBranch,
  onSelect,
  text,
}: Readonly<{
  includesBranch: boolean;
  onSelect: () => void;
  text: string;
}>) {
  return (
    <button
      aria-label={`Route condition: ${text}`}
      className={cn(
        "nodrag nopan max-w-72 cursor-pointer rounded-md border bg-background px-2 py-1 text-left text-xs shadow-sm",
        "hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      type="button"
    >
      {includesBranch ? (
        <Split aria-hidden="true" className="mr-1 inline size-3 shrink-0 align-[-2px]" data-icon="inline-start" />
      ) : null}
      <span className="wrap-break-word whitespace-pre-wrap">{text}</span>
    </button>
  );
}
