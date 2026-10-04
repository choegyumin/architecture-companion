import { cn } from "@/shared/react/class-name";

export type GuardPill = Readonly<{
  id: string;
  label: string;
  pressed: boolean;
  active: boolean;
  description: string;
  onSelect: () => void;
}>;

// UML edge guard: the pill naming the condition under which an edge applies.
// Branch guards select their case; conditional guards toggle. Several guards
// on one edge render side by side — one control may still appear on many
// edges, but every pill of that control projects the same selection state.
export function GuardEdgeLabel({ pills }: Readonly<{ pills: readonly GuardPill[] }>) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {pills.map((pill) => (
        <button
          aria-description={pill.description}
          aria-label={pill.label}
          aria-pressed={pill.pressed}
          className={cn(
            "nodrag nopan cursor-pointer rounded-md border bg-background px-2 py-1 text-center text-xs shadow-sm",
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
          {pill.label}
        </button>
      ))}
    </div>
  );
}
