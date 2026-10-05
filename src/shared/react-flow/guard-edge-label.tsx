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

// UML edge guard: the pills naming the conditions under which an edge applies.
// One AND clause renders as one unit — several conditions share a tinted box,
// a lone condition stays bare — and OR clauses sit side by side. Inside each
// pill the leading state icon separates the control kinds: a splitting arrow
// names a branch case choice, a check mark names a conditional toggle, and
// both dim until their state holds. Icons are decorative — the pill itself
// stays the button carrying the selection.
function GuardPillButton({ pill }: Readonly<{ pill: GuardPill }>) {
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
}

export function GuardEdgeLabel({ clauses }: Readonly<{ clauses: readonly (readonly GuardPill[])[] }>) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {clauses.map((clause, clauseIndex) =>
        clause.length > 1 ? (
          <div className="flex items-center gap-1 rounded-md bg-muted/60 px-1 py-0.5" key={clauseIndex}>
            {clause.map((pill) => (
              <GuardPillButton key={pill.id} pill={pill} />
            ))}
          </div>
        ) : (
          <GuardPillButton key={`${clauseIndex}:${clause.at(0)?.id}`} pill={clause.at(0)!} />
        ),
      )}
    </div>
  );
}
