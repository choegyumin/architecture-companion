import { Check, Split } from "lucide-react";

import { cn } from "@/shared/react/class-name";

// The combined activation condition of one route, written once on the edge
// (the label is presentation only — the guards themselves are derived at
// display time, never stored). A leading icon separates the
// control kinds: a splitting arrow marks routes that carry a branch case, a
// check mark marks plain conditional gates, and the icon dims until the
// route holds. The label wraps at a fixed max width instead of growing an
// unbounded row; the consumer owns what a click or highlight means.
export function GuardEdgeLabel({
  active,
  includesBranch,
  onSelect,
  onHighlightChange,
  text,
}: Readonly<{
  active: boolean;
  includesBranch: boolean;
  onSelect: () => void;
  onHighlightChange?: (highlighted: boolean) => void;
  text: string;
}>) {
  const Icon = includesBranch ? Split : Check;
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
      onFocus={() => onHighlightChange?.(true)}
      onMouseEnter={() => onHighlightChange?.(true)}
      onMouseLeave={() => onHighlightChange?.(false)}
      type="button"
    >
      <Icon
        aria-hidden="true"
        className={cn("mr-1 inline size-3 shrink-0 align-[-2px]", !active && "opacity-25")}
        data-icon="inline-start"
      />
      <span className="wrap-break-word whitespace-pre-wrap">{text}</span>
    </button>
  );
}
