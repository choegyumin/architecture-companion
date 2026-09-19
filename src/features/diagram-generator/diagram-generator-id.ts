import { z } from "zod";

export const diagramGeneratorIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export type BuiltInDiagramGeneratorId = "freeform" | "react-component-structure";
export type DiagramGeneratorId = BuiltInDiagramGeneratorId | (string & Record<never, never>);
