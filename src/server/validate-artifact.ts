import { type Artifact, parseArtifact } from "@/features/artifact/artifact";

export function validateArtifact(input: unknown): Artifact {
  return parseArtifact(input);
}
