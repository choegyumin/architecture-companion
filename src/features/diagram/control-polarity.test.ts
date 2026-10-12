import {
  calculateConditionPolarityPair,
  calculatePolarityPair,
  getPolarityPairCases,
  negateLabel,
  normalizedLabel,
  positiveLabel,
} from "./control-polarity";

describe("getPolarityPairCases", () => {
  const branch = {
    controlId: "gate",
    ownerNodeId: "root",
    type: "branch" as const,
    dependsOn: [[]],
    ...calculateConditionPolarityPair("!ready"),
  };

  it("reads the stored result without interpreting labels or source truth IDs", () => {
    expect(getPolarityPairCases(branch)).toEqual({
      onCase: { caseId: "false", label: "ready" },
      offCase: { caseId: "true", label: "!ready" },
    });
    expect(
      getPolarityPairCases({
        ...branch,
        cases: [
          { caseId: "a", label: "!opaque" },
          { caseId: "b", label: "opaque" },
        ],
      }),
    ).toEqual({
      onCase: { caseId: "a", label: "!opaque" },
      offCase: { caseId: "b", label: "opaque" },
    });
  });

  it("does not infer a switch from two cases or a flag on a non-pair", () => {
    expect(getPolarityPairCases({ ...branch, polarityPair: undefined })).toBeUndefined();
    expect(
      getPolarityPairCases({ ...branch, cases: [...branch.cases, { caseId: "other", label: "Other" }] }),
    ).toBeUndefined();
    expect(
      getPolarityPairCases({
        controlId: "gate",
        ownerNodeId: "root",
        type: "conditional",
        label: "!ready",
        dependsOn: [[]],
      }),
    ).toBeUndefined();
  });
});

describe("calculateConditionPolarityPair", () => {
  it.each([
    { label: "ready", onId: "true", onLabel: "ready", offId: "false", offLabel: "!ready" },
    { label: "!ready", onId: "false", onLabel: "ready", offId: "true", offLabel: "!ready" },
    { label: "!(ready)", onId: "false", onLabel: "(ready)", offId: "true", offLabel: "!(ready)" },
    { label: "!!ready", onId: "true", onLabel: "ready", offId: "false", offLabel: "!ready" },
  ])("derives ON/OFF from $label without changing source truth IDs", ({ label, onId, onLabel, offId, offLabel }) => {
    expect(calculateConditionPolarityPair(label)).toEqual({
      label: "ready",
      polarityPair: true,
      cases: [
        { caseId: onId, label: onLabel },
        { caseId: offId, label: offLabel },
      ],
    });
  });
});

describe("calculatePolarityPair", () => {
  it.each([
    { on: "count > 0", off: "count <= 0", subjectLabel: undefined, label: "count > 0" },
    { on: "children", off: "children == null", subjectLabel: "children", label: "children" },
    { on: "Available", off: "Unavailable", subjectLabel: "Availability", label: "Availability" },
    { on: "(ready)", off: "!(ready)", subjectLabel: "ready", label: "ready" },
  ])("orders $on before its supplied complement without changing IDs or labels", ({ on, off, subjectLabel, label }) => {
    const cases = [
      Object.freeze({ caseId: "original-first", label: off, positive: false }),
      Object.freeze({ caseId: "original-second", label: on, positive: true }),
    ] as const;
    Object.freeze(cases);
    const expected = {
      label,
      polarityPair: true,
      cases: [
        { caseId: "original-second", label: on },
        { caseId: "original-first", label: off },
      ],
    };
    expect(calculatePolarityPair({ cases, subjectLabel })).toEqual(expected);
    const [first, second] = cases;
    expect(calculatePolarityPair({ cases: [second, first], subjectLabel })).toEqual(expected);
  });
});

describe("condition display labels", () => {
  it.each([
    [" ready ", "ready", "!ready", "ready"],
    ["!ready", "!ready", "ready", "ready"],
    ["!!ready", "ready", "!ready", "ready"],
    ["!(!ready)", "ready", "!ready", "ready"],
    ["!(ready)", "!(ready)", "(ready)", "ready"],
    ["a || b", "a || b", "!(a || b)", "a || b"],
    ["!(a || b)", "!(a || b)", "(a || b)", "a || b"],
    ["x === false", "x === false", "!(x === false)", "x === false"],
  ])("preserves the existing ! notation for %s", (input, normalized, negated, positive) => {
    expect(normalizedLabel(input)).toBe(normalized);
    expect(negateLabel(input)).toBe(negated);
    expect(positiveLabel(input)).toBe(positive);
  });
});
