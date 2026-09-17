import type { MouseEvent, ReactNode } from "react";

export const EDGE_LABEL_Z_INDEX = 30;

export type BaseEdgeLabelProps = Readonly<{
  text?: ReactNode;
  href?: string;
  onActivate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}>;

export function BaseEdgeLabel({ text, href, onActivate }: BaseEdgeLabelProps) {
  if (text == null && !href) return null;
  const label = text ?? href;

  if (!href) return <span>{label}</span>;

  return (
    <a
      className="nodrag nopan pointer-events-auto text-primary underline-offset-4 hover:underline"
      href={href}
      onClick={(event) => onActivate?.(event, href)}
      rel="noreferrer"
      target="_blank"
    >
      {label}
    </a>
  );
}
