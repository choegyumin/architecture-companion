import { parseArtifactRevisionId } from "@/features/artifact/artifact-revision-id";

const revisionId = "a".repeat(64);

describe("Artifact revision ID", () => {
  test("accepts a 64-character lowercase hexadecimal digest", () => {
    expect(parseArtifactRevisionId(revisionId)).toBe(revisionId);
  });

  test.each(["a".repeat(63), "a".repeat(65), "A".repeat(64), "../artifact", "a/b", "a\\b", "%2e%2e"])(
    "rejects values that are unsafe as paths: %s",
    (input) => {
      expect(() => parseArtifactRevisionId(input)).toThrow("Invalid Artifact revision ID");
    },
  );
});
