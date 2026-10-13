import { createPolarityPair, getPolarityPairCases } from "./control-polarity";

describe("getPolarityPairCases", () => {
  const branch = {
    controlId: "gate",
    ownerNodeId: "root",
    type: "branch" as const,
    dependsOn: [[]],
    label: "ready",
    polarityPair: true,
    cases: [
      { caseId: "false", label: "ready" },
      { caseId: "true", label: "!ready" },
    ],
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
    expect(getPolarityPairCases({ ...branch, polarityPair: false })).toBeUndefined();
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

describe("createPolarityPair", () => {
  it.each([
    { on: "count > 0", off: "count <= 0", subjectLabel: "count > 0" },
    { on: "children", off: "children == null", subjectLabel: "children" },
    { on: "Available", off: "Unavailable", subjectLabel: "Availability" },
    { on: "(ready)", off: "!(ready)", subjectLabel: "ready" },
    { on: "!opaque", off: "opaque", subjectLabel: "!Subject as supplied" },
  ])("orders $on before its supplied complement without changing IDs or labels", ({ on, off, subjectLabel }) => {
    const cases = [
      Object.freeze({ caseId: "original-first", label: off, positive: false }),
      Object.freeze({ caseId: "original-second", label: on, positive: true }),
    ] as const;
    Object.freeze(cases);
    const expected = {
      label: subjectLabel,
      polarityPair: true,
      cases: [
        { caseId: "original-second", label: on },
        { caseId: "original-first", label: off },
      ],
    };
    expect(createPolarityPair({ cases, subjectLabel })).toEqual(expected);
    const [first, second] = cases;
    expect(createPolarityPair({ cases: [second, first], subjectLabel })).toEqual(expected);
  });
});
