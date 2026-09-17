import { createHash } from "node:crypto";

import { type Artifact, parseArtifact } from "@/features/artifact/artifact";
import { type ArtifactRevisionId, parseArtifactRevisionId } from "@/features/artifact/artifact-revision-id";

export function createArtifactRevisionId(artifact: Artifact): ArtifactRevisionId {
  const canonicalArtifact = parseArtifact(artifact);
  const digest = createHash("sha256").update(JSON.stringify(canonicalArtifact)).digest("hex");
  return parseArtifactRevisionId(digest);
}
