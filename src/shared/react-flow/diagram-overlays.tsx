import type { ComponentProps } from "react";

import { cn } from "@/shared/react/class-name";
import { Card } from "@/shared/react-ui/card";
import { Item } from "@/shared/react-ui/item";

/**
 * Status pill for the caller's currently active state. Content, actions,
 * and visibility belong to the parent; the diagram slot that mounts the pill
 * owns its placement.
 */
export function ActiveIndicator({ className, ...props }: ComponentProps<typeof Item>) {
  return (
    <Item
      aria-live="polite"
      className={cn("nodrag nopan nowheel w-fit rounded-full shadow-md", className)}
      role="status"
      size="sm"
      variant="muted"
      {...props}
    />
  );
}

/**
 * Card for caller-supplied explanations. Children arrive as ordinary
 * card content; the diagram slot that mounts the card owns its placement.
 */
export function ExplanationPanel({ className, ...props }: ComponentProps<typeof Card>) {
  return <Card className={cn("nodrag nopan nowheel w-80", className)} size="xs" variant="default" {...props} />;
}

/**
 * Aside for reference material beside the diagram; it stays interactive so
 * injected actions work (pass `pointer-events-none` for read-only content).
 * The diagram slot that mounts the aside owns its placement.
 */
export function ReferencePanel({ className, ...props }: ComponentProps<"aside">) {
  return (
    <aside
      className={cn(
        "nodrag nopan nowheel pointer-events-auto w-64 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg",
        className,
      )}
      {...props}
    />
  );
}
