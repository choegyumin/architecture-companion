import type { DiagramControlPaths } from "@/features/diagram/diagram-graph";

/** Unions control paths into disjunctive normal form, dropping duplicate clauses. */
export function unionControlPaths(...sets: DiagramControlPaths[]): DiagramControlPaths {
  const paths = new Map<string, DiagramControlPaths[number]>();
  for (const path of sets.flat()) paths.set(JSON.stringify(path), path);
  return [...paths.values()];
}

/** Crosses two path sets: every surviving clause requires a prefix and a suffix. */
export function combineControlPaths(left: DiagramControlPaths, right: DiagramControlPaths): DiagramControlPaths {
  return unionControlPaths(
    left.flatMap((prefix) =>
      right.flatMap((suffix) => {
        const path = [...prefix];
        for (const requirement of suffix) {
          const existing = path.find(({ controlId }) => controlId === requirement.controlId);
          if (existing && existing.value !== requirement.value) return [];
          if (!existing) path.push(requirement);
        }
        return [path];
      }),
    ),
  );
}
