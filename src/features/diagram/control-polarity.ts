import type { DiagramControl } from "./diagram-graph";

type BranchCase = Extract<DiagramControl, { type: "branch" }>["cases"][number];
type PolarityCase = Readonly<BranchCase & { positive: boolean }>;

// Stored pair order carries the calculation result. Consumers read it without
// parsing labels or confusing source case IDs (such as true/false) with ON/OFF.
export function getPolarityPairCases(control: DiagramControl): { onCase: BranchCase; offCase: BranchCase } | undefined {
  if (control.type !== "branch" || control.polarityPair !== true || control.cases.length !== 2) return undefined;
  const [onCase, offCase] = control.cases;
  return { onCase: onCase!, offCase: offCase! };
}

// Both cases describe the same subject with opposite polarity. Source-language
// interpretation belongs to the generator; case identity never follows sorting.
export function createPolarityPair({
  cases,
  subjectLabel,
}: Readonly<{
  cases: readonly [PolarityCase, PolarityCase];
  subjectLabel: string;
}>) {
  const [first, second] = cases;
  const positiveCase = cases.find(({ positive }) => positive) ?? first;
  const ordered = positiveCase === first ? cases : [second, first];
  return {
    label: subjectLabel,
    cases: ordered.map(({ caseId, label }) => ({ caseId, label })),
    polarityPair: true as const,
  };
}
