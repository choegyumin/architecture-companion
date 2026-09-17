import type { Node, NodeProps } from "@xyflow/react";

type FragmentNodeData = Readonly<{
  operator: string;
  branches: readonly Readonly<{ id: string; guard: string }>[];
}>;

type FragmentBranchLayout = Readonly<{
  id: string;
  y: number;
  height: number;
}>;

type FragmentNodeFlowData = Readonly<{
  node: FragmentNodeData;
  layout?: Readonly<{ branches?: readonly FragmentBranchLayout[] }>;
}>;

export type FragmentReactFlowNode = Node<FragmentNodeFlowData, "fragment">;

export function FragmentNode({ data }: NodeProps<FragmentReactFlowNode>) {
  const branches = data.layout?.branches ?? [];
  const firstBranch = branches.reduce<FragmentBranchLayout | undefined>(
    (first, branch) => (!first || branch.y < first.y ? branch : first),
    undefined,
  );
  const getGuard = (branchId: string) => data.node.branches.find(({ id }) => id === branchId)?.guard ?? branchId;

  return (
    <section
      aria-label={`${data.node.operator} fragment`}
      className="relative size-full rounded-xl border-2 border-dashed border-muted-foreground/60 bg-muted/10"
    >
      <div className="absolute top-0 left-0 z-40 flex items-start">
        <span className="rounded-tl-xl rounded-br-md border-r border-b bg-background px-3 py-1 text-xs font-semibold uppercase">
          {data.node.operator}
        </span>
        {firstBranch ? (
          <span className="mt-1 ml-2 bg-background px-1 text-xs text-muted-foreground">
            [{getGuard(firstBranch.id)}]
          </span>
        ) : null}
      </div>
      {branches
        .filter(({ id }) => id !== firstBranch?.id)
        .map((branch) => (
          <div
            className="absolute inset-x-0 border-t border-dashed border-muted-foreground/50"
            key={branch.id}
            style={{ top: branch.y }}
          >
            <span className="absolute top-1 left-3 bg-background px-1 text-xs text-muted-foreground">
              [{getGuard(branch.id)}]
            </span>
          </div>
        ))}
    </section>
  );
}
