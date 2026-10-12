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

// These display rules use ! notation, not a source-language parser. Generators
// interpret their own syntax and can supply explicit polarity and labels instead.
export function normalizedLabel(label: string): string {
  let text = label.trim();
  for (;;) {
    if (text.startsWith("!(") && text.endsWith(")")) {
      const inner = text.slice(2, -1).trim();
      // Only a double negation folds; `!(a || b)` keeps its negation.
      if (!inner.startsWith("!") || inner.length === 1) return text;
      text = normalizedLabel(inner.slice(1).trim());
      continue;
    }
    if (text.startsWith("!!")) {
      text = text.slice(2).trim();
      continue;
    }
    return text;
  }
}

export function negateLabel(label: string): string {
  const text = normalizedLabel(label);
  if (text.startsWith("!") && !text.startsWith("!=")) return normalizedLabel(text.slice(1).trim());
  return /[<>=+\-*%&|?]|\s/.test(text) ? `!(${text})` : `!${text}`;
}

export function positiveLabel(label: string): string {
  let text = normalizedLabel(label);
  for (;;) {
    if (text.startsWith("!(") && text.endsWith(")")) {
      text = normalizedLabel(text.slice(2, -1).trim());
      continue;
    }
    if (text.startsWith("!") && !text.startsWith("!=") && text.length > 1) {
      text = normalizedLabel(text.slice(1).trim());
      continue;
    }
    return text;
  }
}

// Both cases describe the same subject with opposite polarity. Source-language
// interpretation belongs to the generator; case identity never follows sorting.
export function calculatePolarityPair({
  cases,
  subjectLabel,
}: Readonly<{
  cases: readonly [PolarityCase, PolarityCase];
  subjectLabel?: string;
}>) {
  const [first, second] = cases;
  const positiveCase = cases.find(({ positive }) => positive) ?? first;
  const ordered = positiveCase === first ? cases : [second, first];
  return {
    label: subjectLabel ?? positiveLabel(positiveCase.label),
    cases: ordered.map(({ id, label }) => ({ id, label })),
    polarityPair: true as const,
  };
}

// For !-notation conditions, true/false still mean the source gate as written,
// not the switch position. Other notations use calculatePolarityPair directly.
export function calculateConditionPolarityPair(condition: string) {
  const label = normalizedLabel(condition);
  const subjectLabel = positiveLabel(label);
  const positive = label === subjectLabel;
  return calculatePolarityPair({
    subjectLabel,
    cases: [
      { id: "true", label, positive },
      { id: "false", label: negateLabel(label), positive: !positive },
    ],
  });
}
