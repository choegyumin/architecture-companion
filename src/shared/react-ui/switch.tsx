import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/shared/react/class-name";

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      // The primitive keeps its checkbox input visually hidden, so the root
      // itself carries the switch semantics for assistive tech and tests.
      {...props}
      aria-checked={props.checked}
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        "data-checked:bg-primary data-unchecked:bg-input",
        className,
      )}
      role="switch"
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
          "data-checked:translate-x-4 data-unchecked:translate-x-0",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
