import { createHash } from "node:crypto";

import type { RevisionAnnotations } from "@/features/annotation/revision-annotations";

export function createAnnotationEtag(revisionAnnotations: RevisionAnnotations): string {
  const digest = createHash("sha256").update(JSON.stringify(revisionAnnotations)).digest("hex");
  return `"sha256:${digest}"`;
}
