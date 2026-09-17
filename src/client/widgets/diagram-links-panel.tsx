import { Panel } from "@xyflow/react";
import { ExternalLink, FileCode2 } from "lucide-react";
import type { MouseEvent } from "react";

import type { DiagramLink } from "@/features/diagram/diagram-graph";
import { getDiagramLinkLabel, isSourceLinkHref } from "@/features/diagram/diagram-link";
import { Button } from "@/shared/react-ui/button";

type DiagramLinksPanelProps = Readonly<{
  links: readonly DiagramLink[];
  onOpenSource: (href: string) => void;
}>;

export function DiagramLinksPanel({ links, onOpenSource }: DiagramLinksPanelProps) {
  if (links.length === 0) return null;

  const onLinkActivate = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!isSourceLinkHref(href)) return;
    event.preventDefault();
    onOpenSource(href);
  };

  return (
    <Panel className="mb-8!" position="bottom-right">
      <nav aria-label="Diagram links" className="flex max-w-xs flex-col gap-1.5">
        {links.map((link, index) => {
          const Icon = isSourceLinkHref(link.href) ? FileCode2 : ExternalLink;
          const label = getDiagramLinkLabel(link);

          return (
            <Button
              className="nodrag nopan justify-start"
              key={`${link.href}:${index}`}
              nativeButton={false}
              render={
                <a
                  href={link.href}
                  onClick={(event) => onLinkActivate(event, link.href)}
                  rel="noreferrer"
                  target="_blank"
                />
              }
              size="xs"
              title={label}
              variant="outline"
            >
              <Icon aria-hidden="true" data-icon="inline-start" />
              <span className="min-w-0 truncate">Open {label}</span>
            </Button>
          );
        })}
      </nav>
    </Panel>
  );
}
