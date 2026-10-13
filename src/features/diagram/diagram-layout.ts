import z from "zod";

import { elkOptionMapSchema } from "@/features/diagram/elk-core";

export const generalDiagramLayoutConfigSchema = z
  .object({
    layoutId: z.literal("general"),
    options: z
      .object({
        nudgeObstacleNodes: z.boolean().default(false),
        bezierEdges: z.boolean().default(false),
        elk: elkOptionMapSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type GeneralDiagramLayoutConfig = z.infer<typeof generalDiagramLayoutConfigSchema>;

export const sequenceDiagramLayoutConfigSchema = z.object({ layoutId: z.literal("sequence") }).strict();
export type SequenceDiagramLayoutConfig = z.infer<typeof sequenceDiagramLayoutConfigSchema>;

export const dependencyGraphLayoutConfigSchema = z.object({ layoutId: z.literal("dependency-graph") }).strict();
export type DependencyGraphLayoutConfig = z.infer<typeof dependencyGraphLayoutConfigSchema>;

// Decision ports and split segments require the component structure routing
// policy; obstacle nudging and polyline routing are not authorable here.
export const componentStructureDiagramLayoutConfigSchema = z
  .object({
    layoutId: z.literal("component-structure"),
    options: z.object({ elk: elkOptionMapSchema.optional() }).strict().optional(),
  })
  .strict();
export type ComponentStructureDiagramLayoutConfig = z.infer<typeof componentStructureDiagramLayoutConfigSchema>;

export const diagramLayoutConfigSchema = z.discriminatedUnion("layoutId", [
  generalDiagramLayoutConfigSchema,
  sequenceDiagramLayoutConfigSchema,
  dependencyGraphLayoutConfigSchema,
  componentStructureDiagramLayoutConfigSchema,
]);
export type DiagramLayoutConfig = z.infer<typeof diagramLayoutConfigSchema>;
