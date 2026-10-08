import { z } from "zod";

import type { ArtifactGeneratorId } from "@/features/artifact-generator/artifact-generator-id";

export const artifactGeneratorReferenceSchema = z
  .string()
  .regex(/^(?:built-in|project|global):[a-z0-9]+(?:-[a-z0-9]+)*$/);

export type ArtifactGeneratorSource = "built-in" | "project" | "global";
export type ArtifactGeneratorReference = `${ArtifactGeneratorSource}:${ArtifactGeneratorId}`;
