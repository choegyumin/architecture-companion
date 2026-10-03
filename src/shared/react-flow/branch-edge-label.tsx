import { useId } from "react";

import { cn } from "@/shared/react/class-name";

type BranchEdgeLabelProps = Readonly<{
  label: string;
  alternatives: readonly Readonly<{ id: string; label: string }>[];
  value: string;
  description?: string;
  className?: string;
  onSelect: (value: string) => void;
}>;

export function BranchEdgeLabel({
  label,
  alternatives,
  value,
  description,
  className,
  onSelect,
}: BranchEdgeLabelProps) {
  const groupId = useId();
  return (
    <fieldset
      aria-description={description}
      className={cn("w-max rounded-md border bg-background p-1 text-xs shadow-sm", className)}
      role="radiogroup"
    >
      <legend className="sr-only">{label}</legend>
      <div className="flex gap-1">
        {alternatives.map((alternative) => (
          <label className="cursor-pointer" key={alternative.id}>
            <input
              checked={value === alternative.id}
              className="peer sr-only"
              name={groupId}
              onChange={() => onSelect(alternative.id)}
              onClick={() => {
                if (value === alternative.id) onSelect(alternative.id);
              }}
              type="radio"
              value={alternative.id}
            />
            <span className="block rounded-sm px-2 py-1.5 whitespace-nowrap peer-checked:bg-primary/10 peer-checked:text-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
              {alternative.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
