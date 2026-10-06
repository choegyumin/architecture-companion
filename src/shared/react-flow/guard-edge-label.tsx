import { Check, Split } from "lucide-react";

import { cn } from "@/shared/react/class-name";

export type GuardPill = Readonly<{
  id: string;
  /** Branch pills select a case; conditional pills toggle a requirement. */
  kind: "branch" | "conditional";
  label: string;
  pressed: boolean;
  onSelect: () => void;
}>;

// UML edge guard: the pills naming the route requirements under which an edge applies.
// One AND rule renders as one unit — several requirements share a tinted box,
// a lone requirement stays bare — and OR rules stack top to bottom. Inside each
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

// A multi-requirement rule box reads like a nested checkbox: a solid tinted
// border when every requirement holds, a dashed one when only some hold, and a
// plain box when none do. The border stays present in every state so the box
// does not shift as the selection changes.
const RULE_BOX_STATE_CLASS = {
  satisfied: "border-primary/40 bg-primary/10",
  partial: "border-dashed border-primary/40 bg-muted/60",
  off: "border-transparent bg-muted/60",
} as const;

const ruleState = (pills: readonly GuardPill[]): keyof typeof RULE_BOX_STATE_CLASS =>
  pills.every((pill) => pill.pressed) ? "satisfied" : pills.some((pill) => pill.pressed) ? "partial" : "off";

export function GuardEdgeLabel({ rules }: Readonly<{ rules: readonly (readonly GuardPill[])[] }>) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      {rules.map((rule, ruleIndex) =>
        rule.length > 1 ? (
          <div
            className={cn(
              "flex items-center gap-1 rounded-md border px-1 py-0.5",
              RULE_BOX_STATE_CLASS[ruleState(rule)],
            )}
            key={ruleIndex}
          >
            {rule.map((pill) => (
              <GuardPillButton key={pill.id} pill={pill} />
            ))}
          </div>
        ) : (
          <GuardPillButton key={`${ruleIndex}:${rule.at(0)?.id}`} pill={rule.at(0)!} />
        ),
      )}
    </div>
  );
}
