import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";

import { cn } from "@/shared/react/class-name";

function Combobox<Value>(props: ComboboxPrimitive.Root.Props<Value>) {
  return <ComboboxPrimitive.Root data-slot="combobox" {...props} />;
}

function ComboboxInputGroup({ className, ...props }: ComboboxPrimitive.InputGroup.Props) {
  return <ComboboxPrimitive.InputGroup className={className} data-slot="combobox-input-group" {...props} />;
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      className={cn(
        "min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground",
        className,
      )}
      data-slot="combobox-input"
      {...props}
    />
  );
}

function ComboboxPositioner({ className, ...props }: ComboboxPrimitive.Positioner.Props) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        className={cn("z-50 outline-none", className)}
        data-slot="combobox-positioner"
        {...props}
      />
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxPopup({ className, ...props }: ComboboxPrimitive.Popup.Props) {
  return (
    <ComboboxPrimitive.Popup
      className={cn(
        "max-h-(--available-height) w-(--anchor-width) overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md",
        className,
      )}
      data-slot="combobox-popup"
      {...props}
    />
  );
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      className={cn("max-h-64 overflow-y-auto overscroll-contain p-1", className)}
      data-slot="combobox-list"
      {...props}
    />
  );
}

function ComboboxItem({ className, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      className={cn(
        "cursor-default rounded-sm px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        className,
      )}
      data-slot="combobox-item"
      {...props}
    />
  );
}

export { Combobox, ComboboxInput, ComboboxInputGroup, ComboboxItem, ComboboxList, ComboboxPopup, ComboboxPositioner };
