import { Check, Split } from "lucide-react";

import { cn } from "@/shared/react/class-name";

export type GuardPill = Readonly<{
  id: string;
  /** Branch pills select a case; conditional pills toggle a condition. */
  kind: "branch" | "conditional";
  label: string;
  pressed: boolean;
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
      aria-label={pill.label}
      aria-pressed={pill.pressed}
      className={cn(
        "nodrag nopan inline-flex cursor-pointer items-center gap-1 rounded-md border bg-background px-2 py-1 text-center text-xs shadow-sm [&_svg:not([class*='size-'])]:size-3",
        pill.pressed ? "border-primary/60" : "hover:border-primary/60",
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

// A multi-condition clause box reads like a nested checkbox: a solid tinted
// border when every condition holds, a dashed one when only some hold, and a
// plain box when none do. The border stays present in every state so the box
// does not shift as the selection changes.
const CLAUSE_BOX_STATE_CLASS = {
  satisfied: "border-primary/40 bg-primary/10",
  partial: "border-dashed border-primary/40 bg-muted/60",
  off: "border-transparent bg-muted/60",
} as const;

const clauseState = (pills: readonly GuardPill[]): keyof typeof CLAUSE_BOX_STATE_CLASS =>
  pills.every((pill) => pill.pressed) ? "satisfied" : pills.some((pill) => pill.pressed) ? "partial" : "off";

export function GuardEdgeLabel({ clauses }: Readonly<{ clauses: readonly (readonly GuardPill[])[] }>) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {clauses.map((clause, clauseIndex) =>
        clause.length > 1 ? (
          <div
            className={cn(
              "flex items-center gap-1 rounded-md border px-1 py-0.5",
              CLAUSE_BOX_STATE_CLASS[clauseState(clause)],
            )}
            key={clauseIndex}
          >
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
