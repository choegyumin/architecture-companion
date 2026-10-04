import { z } from "zod";

export const artifactGeneratorIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export type BuiltInArtifactGeneratorId =
  "freeform" | "js-module-dependency-graph" | "react-component-structure" | "sequence";
export type ArtifactGeneratorId = BuiltInArtifactGeneratorId | (string & Record<never, never>);
