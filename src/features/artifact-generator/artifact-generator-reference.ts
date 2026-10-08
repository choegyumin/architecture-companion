import { z } from "zod";

import type { ArtifactGeneratorId } from "@/features/artifact-generator/artifact-generator-id";

// The `id` doubles as the generated JSON Schema `$defs` name for this piece.
export const artifactGeneratorReferenceSchema = z
  .string()
  .regex(/^(?:built-in|project|global):[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .meta({ id: "Generator" });

export type ArtifactGeneratorSource = "built-in" | "project" | "global";
export type ArtifactGeneratorReference = `${ArtifactGeneratorSource}:${ArtifactGeneratorId}`;
