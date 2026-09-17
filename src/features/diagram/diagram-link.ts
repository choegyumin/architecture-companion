import type { DiagramLink } from "@/features/diagram/diagram-graph";

export function isSourceLinkHref(href: string): boolean {
  return href.startsWith("source:");
}

export function getDiagramLinkLabel(link: DiagramLink): string {
  if (link.text) return link.text;
  if (!isSourceLinkHref(link.href)) return link.href;

  try {
    const path = new URL(link.href).pathname;
    return path.split(/[\\/]/).at(-1) || link.href;
  } catch {
    return link.href;
  }
}
