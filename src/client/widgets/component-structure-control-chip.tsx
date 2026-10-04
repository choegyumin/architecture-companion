import type { ComponentSelection } from "@/client/widgets/component-structure-path-selection";
import type { ComponentControl } from "@/features/diagram/diagram-graph";
import { cn } from "@/shared/react/class-name";
import { ToggleGroup, ToggleGroupItem } from "@/shared/react-ui/toggle-group";

type ComponentControlChipProps = Readonly<{
  control: ComponentControl;
  selection: ComponentSelection;
  activeControls: ReadonlySet<string>;
  onSelect: (controlId: string, value: string) => void;
}>;

export function ComponentControlChip({ control, selection, activeControls, onSelect }: ComponentControlChipProps) {
  const active = activeControls.has(control.id);
  const description = active ? "Active path" : "Inactive path; selecting activates ancestors";
  if (control.kind === "branch") {
    return (
      <ToggleGroup
        aria-label={control.label}
        onValueChange={(groupValue) => {
          const value = groupValue.at(0);
          if (value != null) onSelect(control.id, value);
        }}
        size="sm"
        value={[selection[control.id] ?? control.alternatives.at(0)!.id]}
        variant="outline"
      >
        {control.alternatives.map((alternative) => (
          <ToggleGroupItem
            aria-description={description}
            key={alternative.id}
            // Re-selecting the pressed alternative still activates ancestors,
            // which the group's value change alone does not report.
            onClick={() => onSelect(control.id, alternative.id)}
            title={alternative.label}
            value={alternative.id}
          >
            {alternative.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    );
  }
  const pressed = selection[control.id] === "on";
  return (
    <button
      aria-description={description}
      aria-label={control.label}
      aria-pressed={pressed}
      className={cn(
        "nodrag nopan cursor-pointer rounded-md border bg-background px-2 py-1 text-center text-xs shadow-sm",
        pressed ? "border-primary/60" : "hover:border-primary/60",
        !active && "opacity-60",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(control.id, pressed ? "off" : "on");
      }}
      type="button"
    >
      {control.label}
    </button>
  );
}
