import { z } from "zod";

/* === ID === */

export const diagramIdSchema = z.string().min(1);

/* === Link === */

export const diagramLinkSchema = z
  .object({
    text: z.string().min(1).optional(),
    href: z.string().min(1),
  })
  .strict();
export type DiagramLink = z.infer<typeof diagramLinkSchema>;

/* === Node === */

const diagramNodeBaseShape = {
  id: diagramIdSchema,
  kind: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  details: z.array(z.string().min(1)).optional(),
  groupId: diagramIdSchema.optional(),
};

export const defaultDiagramNodeSchema = z
  .object({
    ...diagramNodeBaseShape,
    type: z.literal("default"),
    links: z.array(diagramLinkSchema).optional(),
  })
  .strict();
export type DefaultDiagramNode = z.infer<typeof defaultDiagramNodeSchema>;

const activationEndpointSchema = z
  .object({
    messageId: diagramIdSchema,
    endpoint: z.enum(["source", "target"]),
  })
  .strict();
const activationSchema = z
  .object({
    id: diagramIdSchema,
    startsAt: activationEndpointSchema,
    endsAt: activationEndpointSchema,
  })
  .strict();
export const lifelineDiagramNodeSchema = z
  .object({
    ...diagramNodeBaseShape,
    type: z.literal("lifeline"),
    links: z.array(diagramLinkSchema).optional(),
    activations: z.array(activationSchema),
  })
  .strict();
export type LifelineDiagramNode = z.infer<typeof lifelineDiagramNodeSchema>;

const fragmentBranchSchema = z
  .object({
    id: diagramIdSchema,
    guard: z.string().min(1),
    startMessageId: diagramIdSchema,
    endMessageId: diagramIdSchema,
  })
  .strict();
export const fragmentDiagramNodeSchema = z
  .object({
    ...diagramNodeBaseShape,
    type: z.literal("fragment"),
    operator: z.enum(["alt", "opt", "loop", "par", "break", "critical", "assert", "neg"]),
    branches: z.array(fragmentBranchSchema).min(1),
  })
  .strict();
export type FragmentDiagramNode = z.infer<typeof fragmentDiagramNodeSchema>;

export const diagramNodeSchema = z.discriminatedUnion("type", [
  defaultDiagramNodeSchema,
  lifelineDiagramNodeSchema,
  fragmentDiagramNodeSchema,
]);
export type DiagramNode = z.infer<typeof diagramNodeSchema>;

/* === Edge === */

export const defaultDiagramEdgeSchema = z
  .object({
    id: diagramIdSchema,
    type: z.literal("default"),
    source: diagramIdSchema,
    target: diagramIdSchema,
    kind: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    href: z.string().min(1).optional(),
  })
  .strict();
export type DefaultDiagramEdge = z.infer<typeof defaultDiagramEdgeSchema>;

export const messageDiagramEdgeSchema = z
  .object({
    id: diagramIdSchema,
    type: z.literal("message"),
    source: diagramIdSchema,
    target: diagramIdSchema,
    kind: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    href: z.string().min(1).optional(),
    messageType: z.enum(["sync", "async", "return"]).default("sync"),
  })
  .strict();
export type MessageDiagramEdge = z.infer<typeof messageDiagramEdgeSchema>;

export const diagramEdgeSchema = z.discriminatedUnion("type", [defaultDiagramEdgeSchema, messageDiagramEdgeSchema]);
export type DiagramEdge = z.infer<typeof diagramEdgeSchema>;

/* === Group === */

export const diagramGroupSchema = z
  .object({
    id: diagramIdSchema,
    title: z.string().min(1),
    description: z.string().min(1).optional(),
    parentId: diagramIdSchema.optional(),
  })
  .strict();
export type DiagramGroup = z.infer<typeof diagramGroupSchema>;

/* === Graph === */

export const diagramGraphSchema = z
  .object({
    groups: z.array(diagramGroupSchema).readonly(),
    nodes: z.array(diagramNodeSchema).min(1).readonly(),
    edges: z.array(diagramEdgeSchema).readonly(),
  })
  .strict();
export type DiagramGraph = z.infer<typeof diagramGraphSchema>;
