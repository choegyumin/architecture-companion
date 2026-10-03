import { cn } from "@/shared/react/class-name";

type ConditionalEdgeLabelProps = Readonly<{
  label: string;
  checked: boolean;
  description?: string;
  className?: string;
  onChange: (checked: boolean) => void;
}>;

export function ConditionalEdgeLabel({ label, checked, description, className, onChange }: ConditionalEdgeLabelProps) {
  return (
    <label
      className={cn(
        "flex w-max cursor-pointer items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-xs shadow-sm",
        className,
      )}
    >
      <span className="whitespace-nowrap">{label}</span>
      <input
        aria-description={description}
        checked={checked}
        className="peer sr-only"
        onChange={(event) => onChange(event.currentTarget.checked)}
        role="switch"
        type="checkbox"
      />
      <span
        aria-hidden="true"
        className="relative h-5 w-9 shrink-0 rounded-full border bg-muted peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
      >
        <span
          className={cn("absolute top-0.5 left-0.5 size-3.5 rounded-full bg-background", checked && "translate-x-4")}
        />
      </span>
    </label>
  );
}
