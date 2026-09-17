import { Handle, type Node, type NodeProps, Position, useUpdateNodeInternals } from "@xyflow/react";
import { ExternalLink } from "lucide-react";
import { type MouseEvent, type ReactNode, useEffect } from "react";

import { Button } from "@/shared/react-ui/button";

type LifelineHandle = Readonly<{
  id: string;
  side: "left" | "right";
  y: number;
}>;
type LifelineActivation = Readonly<{
  id: string;
  y: number;
  height: number;
}>;
type LinkActivationHandler = (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
type LifelineNodeLink = Readonly<{
  href: string;
  label?: ReactNode;
}>;

type LifelineNodeData = Readonly<{
  node: Readonly<{ kind: string; title: string; description?: string }>;
  links?: readonly LifelineNodeLink[];
  onLinkActivate?: LinkActivationHandler;
  layout?: Readonly<{
    handles?: readonly LifelineHandle[];
    activations?: readonly LifelineActivation[];
  }>;
}>;

export type LifelineReactFlowNode = Node<LifelineNodeData, "lifeline">;

export function LifelineNode({ id, data }: NodeProps<LifelineReactFlowNode>) {
  const updateNodeInternals = useUpdateNodeInternals();
  const handles = data.layout?.handles;
  const activations = data.layout?.activations;

  useEffect(() => {
    updateNodeInternals(id);
  }, [handles, id, updateNodeInternals]);

  return (
    <article className="relative h-full w-56 text-card-foreground" style={{ minHeight: 160, width: 224 }}>
      <header className="relative z-2 rounded-xl border bg-card p-4 shadow-sm">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{data.node.kind}</p>
        <h3 className="mt-1 font-heading text-sm font-semibold">{data.node.title}</h3>
        {data.node.description ? <p className="mt-2 text-xs text-muted-foreground">{data.node.description}</p> : null}
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
      </header>
      <div
        aria-hidden="true"
        className="absolute top-14 bottom-0 left-1/2 border-l border-dashed border-muted-foreground/70"
      />
      {(activations ?? []).map((activation) => (
        <div
          aria-hidden="true"
          className="absolute left-1/2 z-10 w-2 -translate-x-1/2 rounded-sm border border-foreground/50 bg-muted"
          key={activation.id}
          style={{ height: activation.height, top: activation.y }}
        />
      ))}
      {(handles ?? []).map((handle) => (
        <Handle
          className="size-2!"
          id={handle.id}
          isConnectable={false}
          key={handle.id}
          position={handle.side === "left" ? Position.Left : Position.Right}
          style={{ opacity: 0, top: handle.y }}
          type={handle.side === "left" ? "target" : "source"}
        />
      ))}
    </article>
  );
}
