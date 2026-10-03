import { useId } from "react";

import type { ComponentSelection } from "@/client/widgets/component-structure-path-selection";
import type { ComponentControl } from "@/features/diagram/diagram-graph";
import { cn } from "@/shared/react/class-name";

type ComponentStructureControlsProps = Readonly<{
  controls: readonly ComponentControl[];
  activeControls: ReadonlySet<string>;
  selection: ComponentSelection;
  onSelect: (controlId: string, value: string) => void;
}>;

export function ComponentStructureControls({
  controls,
  activeControls,
  selection,
  onSelect,
}: ComponentStructureControlsProps) {
  const groupId = useId();
  const localControls = new Set(controls.map((control) => control.id));
  return (
    <div className="nodrag nopan nowheel mt-3 space-y-3 border-t pt-3">
      {controls.map((control) => {
        const active = activeControls.has(control.id);
        const depth = Math.min(
          ...control.when.map((path) => path.filter(({ controlId }) => localControls.has(controlId)).length),
        );
        const description = active ? "Active path" : "Inactive path; selecting activates ancestors";
        return (
          <div
            className={cn("space-y-1.5", !active && "text-muted-foreground")}
            key={control.id}
            style={{ paddingLeft: depth * 8 }}
          >
            {control.kind === "conditional" ? (
              <label className="flex min-h-7 cursor-pointer items-center justify-between gap-2 text-xs">
                <span className="min-w-0 wrap-break-word">{control.label}</span>
                <input
                  aria-description={description}
                  checked={selection[control.id] === "on"}
                  className="peer sr-only"
                  onChange={(event) => onSelect(control.id, event.currentTarget.checked ? "on" : "off")}
                  role="switch"
                  type="checkbox"
                />
                <span
                  aria-hidden="true"
                  className="relative h-5 w-9 shrink-0 rounded-full border bg-muted peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
                >
                  <span
                    className={cn(
                      "absolute top-0.5 left-0.5 size-3.5 rounded-full bg-background",
                      selection[control.id] === "on" && "translate-x-4",
                    )}
                  />
                </span>
              </label>
            ) : (
              <fieldset aria-description={description} className="min-w-0" role="radiogroup">
                <legend className="mb-1.5 text-xs wrap-break-word">{control.label}</legend>
                <div className="flex min-w-0 gap-1 rounded-md bg-muted p-1">
                  {control.alternatives.map((alternative) => (
                    <label className="min-w-0 flex-1 cursor-pointer" key={alternative.id}>
                      <input
                        checked={selection[control.id] === alternative.id}
                        className="peer sr-only"
                        name={`${groupId}:${control.id}`}
                        onChange={() => onSelect(control.id, alternative.id)}
                        onClick={() => {
                          if (selection[control.id] === alternative.id) onSelect(control.id, alternative.id);
                        }}
                        type="radio"
                        value={alternative.id}
                      />
                      <span className="block rounded-sm px-2 py-1.5 text-center text-xs wrap-break-word peer-checked:bg-background peer-checked:text-foreground peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
                        {alternative.label}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        );
      })}
    </div>
  );
}
