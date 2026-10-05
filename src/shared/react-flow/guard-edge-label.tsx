import { Check, Split } from "lucide-react";

import { cn } from "@/shared/react/class-name";

export type GuardPill = Readonly<{
  id: string;
  /** Branch pills select a case; conditional pills toggle a condition. */
  kind: "branch" | "conditional";
  label: string;
  pressed: boolean;
  active: boolean;
  description: string;
  onSelect: () => void;
}>;

// UML edge guard: the pill naming the condition under which an edge applies.
// The leading state icon separates the two control kinds: a splitting arrow
// names a branch case choice, a check mark names a conditional toggle, and
// both dim until their state holds. The icon is decorative — the pill itself
// stays the button carrying the selection. One control may appear on many
// edges, but every pill of that control projects the same selection state.
export function GuardEdgeLabel({ pills }: Readonly<{ pills: readonly GuardPill[] }>) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {pills.map((pill) => {
        const Icon = pill.kind === "branch" ? Split : Check;
        return (
          <button
            aria-description={pill.description}
            aria-label={pill.label}
            aria-pressed={pill.pressed}
            className={cn(
              "nodrag nopan inline-flex cursor-pointer items-center gap-1 rounded-md border bg-background px-2 py-1 text-center text-xs shadow-sm [&_svg:not([class*='size-'])]:size-3",
              pill.pressed ? "border-primary/60" : "hover:border-primary/60",
              !pill.active && "opacity-60",
            )}
            onClick={(event) => {
              event.stopPropagation();
              pill.onSelect();
            }}
            key={pill.id}
            type="button"
          >
            <Icon aria-hidden="true" className={pill.pressed ? undefined : "opacity-25"} data-icon="inline-start" />
            {pill.label}
          </button>
        );
      })}
    </div>
  );
}
