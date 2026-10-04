import { cn } from "@/shared/react/class-name";

type ConditionalEdgeLabelProps = Readonly<{
  label: string;
  pressed: boolean;
  active: boolean;
  description: string;
  onToggle: () => void;
}>;

// Switch chip for a conditional render guard. It marks the guarded
// connection only; conditional guards never fork, so the edge path stays as
// the layout routed it.
export function ConditionalEdgeLabel({ label, pressed, active, description, onToggle }: ConditionalEdgeLabelProps) {
  return (
    <button
      aria-description={description}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        "nodrag nopan cursor-pointer rounded-md border bg-background px-2 py-1 text-center text-xs shadow-sm",
        pressed ? "border-primary/60" : "hover:border-primary/60",
        !active && "opacity-60",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      type="button"
    >
      {label}
    </button>
  );
}
