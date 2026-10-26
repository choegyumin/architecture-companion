import type { CSSProperties, MouseEvent, ReactNode } from "react";

import { cn } from "@/shared/react/class-name";

export const EDGE_LABEL_Z_INDEX = 30;

export type BaseEdgeLabelProps = Readonly<{
  text?: ReactNode;
  className?: string;
  style?: CSSProperties;
  icon?: ReactNode;
  active?: boolean;
  ariaLabel?: string;
  href?: string;
  onActivate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  onSelect?: () => void;
  onHighlightChange?: (highlighted: boolean) => void;
}>;

export function BaseEdgeLabel({
  text,
  className,
  style,
  icon,
  active = true,
  ariaLabel,
  href,
  onActivate,
  onSelect,
  onHighlightChange,
}: BaseEdgeLabelProps) {
  if (text == null && !href && icon == null) return null;
  const label = text ?? href;
  const content = (
    <>
      {icon != null ? (
        <span
          aria-hidden="true"
          className={cn("mr-1 inline-block align-[-2px] [&>svg]:size-3", !active && "opacity-25")}
        >
          {icon}
        </span>
      ) : null}
      <span className={onSelect ? "wrap-break-word whitespace-pre-wrap" : undefined}>{label}</span>
    </>
  );

  if (onSelect) {
    return (
      <button
        aria-label={ariaLabel}
        className={cn(
          "nodrag nopan max-w-72 cursor-pointer rounded-md border bg-background px-2 py-1 text-left text-xs shadow-sm",
          "hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          className,
        )}
        onClick={onSelect}
        onBlur={() => onHighlightChange?.(false)}
        onFocus={() => onHighlightChange?.(true)}
        onMouseEnter={() => onHighlightChange?.(true)}
        onMouseLeave={() => onHighlightChange?.(false)}
        style={style}
        type="button"
      >
        {content}
      </button>
    );
  }

  if (!href)
    return (
      <span aria-label={ariaLabel} className={className} style={style}>
        {content}
      </span>
    );

  return (
    <a
      aria-label={ariaLabel}
      className={cn("nodrag nopan pointer-events-auto text-primary underline-offset-4 hover:underline", className)}
      href={href}
      onClick={(event) => onActivate?.(event, href)}
      style={style}
      rel="noreferrer"
      target="_blank"
    >
      {content}
    </a>
  );
}
