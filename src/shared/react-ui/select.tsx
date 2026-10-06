import { Select as SelectPrimitive } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { cn } from "@/shared/react/class-name";

function Select<Value extends string | null>(props: SelectPrimitive.Root.Props<Value>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectTrigger({ className, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-6 max-w-full items-center justify-between gap-1 rounded-md border bg-background px-2 text-xs whitespace-nowrap text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function SelectValue({ ...props }: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" className="truncate" {...props} />;
}

function SelectIcon({ ...props }: SelectPrimitive.Icon.Props) {
  return (
    <SelectPrimitive.Icon data-slot="select-icon" {...props}>
      <ChevronDownIcon aria-hidden="true" className="size-3 opacity-50" />
    </SelectPrimitive.Icon>
  );
}

function SelectPortal({ ...props }: SelectPrimitive.Portal.Props) {
  return <SelectPrimitive.Portal data-slot="select-portal" {...props} />;
}

function SelectPositioner({ className, ...props }: SelectPrimitive.Positioner.Props) {
  return (
    <SelectPrimitive.Positioner
      data-slot="select-positioner"
      className={cn("z-50 min-w-(--anchor-width) outline-none", className)}
      {...props}
    />
  );
}

function SelectPopup({ className, ...props }: SelectPrimitive.Popup.Props) {
  return (
    <SelectPrimitive.Popup
      data-slot="select-popup"
      className={cn(
        "max-h-(--available-height) overflow-y-auto rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-md",
        className,
      )}
      {...props}
    />
  );
}

function SelectItem({ className, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "flex cursor-default items-center gap-1.5 rounded-sm px-2 py-1 outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

function SelectItemText({ ...props }: SelectPrimitive.ItemText.Props) {
  return <SelectPrimitive.ItemText data-slot="select-item-text" className="truncate" {...props} />;
}

function SelectItemIndicator({ ...props }: SelectPrimitive.ItemIndicator.Props) {
  return (
    <SelectPrimitive.ItemIndicator data-slot="select-item-indicator" {...props}>
      <CheckIcon aria-hidden="true" className="size-3 opacity-50" />
    </SelectPrimitive.ItemIndicator>
  );
}

export {
  Select,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
};
