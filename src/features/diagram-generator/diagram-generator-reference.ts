import { z } from "zod";

import type { DiagramGeneratorId } from "@/features/diagram-generator/diagram-generator-id";

export const diagramGeneratorReferenceSchema = z
  .string()
  .regex(/^(?:built-in|project|global):[a-z0-9]+(?:-[a-z0-9]+)*$/);

export type DiagramGeneratorSource = "built-in" | "project" | "global";
export type DiagramGeneratorReference = `${DiagramGeneratorSource}:${DiagramGeneratorId}`;
