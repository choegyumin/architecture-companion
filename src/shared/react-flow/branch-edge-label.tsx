import { ToggleGroup, ToggleGroupItem } from "@/shared/react-ui/toggle-group";

type BranchEdgeLabelProps = Readonly<{
  label: string;
  options: readonly Readonly<{ id: string; label: string; disabled?: boolean }>[];
  value: string;
  description: string;
  onSelect: (value: string) => void;
}>;

// Segmented control choosing between the mutually exclusive cases of a fork.
// Rendered through RouteEdge's labelControl slot at the fork point. Disabled
// options carry branch arms that render no component path.
export function BranchEdgeLabel({ label, options, value, description, onSelect }: BranchEdgeLabelProps) {
  return (
    <ToggleGroup
      aria-label={label}
      onValueChange={(groupValue) => {
        const next = groupValue.at(0);
        if (next != null) onSelect(next);
      }}
      size="sm"
      value={[value]}
      variant="outline"
    >
      {options.map((option) => (
        <ToggleGroupItem
          aria-description={option.disabled ? "No component render path" : description}
          disabled={option.disabled}
          key={option.id}
          // Re-selecting the pressed case still activates ancestors, which the
          // group's value change alone does not report.
          onClick={() => onSelect(option.id)}
          title={option.disabled ? "No component render path" : option.label}
          value={option.id}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
