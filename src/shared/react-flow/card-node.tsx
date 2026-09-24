import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { ExternalLink } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import { cn } from "@/shared/react/class-name";
import { Button } from "@/shared/react-ui/button";

type LinkActivationHandler = (event: MouseEvent<HTMLAnchorElement>, href: string) => void;

type CardNodeLink = Readonly<{
  href: string;
  label?: ReactNode;
}>;

type CardNodeData = Readonly<{
  label: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  details?: readonly ReactNode[];
  links?: readonly CardNodeLink[];
  onLinkActivate?: LinkActivationHandler;
  activatable?: boolean;
}>;

export type CardReactFlowNode = Node<CardNodeData, "card">;

export function CardNode({
  data,
  isConnectable,
  sourcePosition = Position.Right,
  targetPosition = Position.Left,
}: NodeProps<CardReactFlowNode>) {
  const accessibleLabel = [data.eyebrow, data.label]
    .filter((content): content is string => typeof content === "string")
    .join(": ");

  return (
    <article
      aria-label={accessibleLabel || "Card"}
      className={cn(
        "w-72 rounded-xl border bg-card p-4 text-card-foreground shadow-sm",
        data.activatable && "cursor-pointer hover:border-primary/60",
      )}
    >
      <Handle isConnectable={isConnectable} position={targetPosition} style={{ opacity: 0 }} type="target" />
      {data.eyebrow != null ? (
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{data.eyebrow}</p>
      ) : null}
      <h3 className="font-heading text-base font-semibold">{data.label}</h3>
      {data.description != null ? <p className="mt-2 text-sm text-muted-foreground">{data.description}</p> : null}
      {data.details?.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-4 text-xs/relaxed">
          {data.details.map((detail, index) => (
            <li key={index}>{detail}</li>
          ))}
        </ul>
      ) : null}
      {data.links?.length ? (
        <div className="mt-3 flex min-w-0 flex-col gap-1.5">
          {data.links.map((link, index) => (
            <Button
              className="nodrag nopan w-full max-w-full min-w-0 justify-start overflow-hidden"
              key={`${link.href}:${index}`}
              nativeButton={false}
              render={
                <a
                  href={link.href}
                  onClick={(event) => data.onLinkActivate?.(event, link.href)}
                  rel="noreferrer"
                  target="_blank"
                />
              }
              size="xs"
              title={typeof link.label === "string" ? link.label : link.href}
              variant="outline"
            >
              {link.label ?? (
                <>
                  <ExternalLink aria-hidden="true" data-icon="inline-start" />
                  <span className="min-w-0 truncate">{link.href}</span>
                </>
              )}
            </Button>
          ))}
        </div>
      ) : null}
      <Handle isConnectable={isConnectable} position={sourcePosition} style={{ opacity: 0 }} type="source" />
    </article>
  );
}
