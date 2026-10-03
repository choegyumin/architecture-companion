import { parseCatalogRevisionId } from "@/features/catalog/catalog-revision-id";

const revisionId = "a".repeat(64);

describe("Catalog revision ID", () => {
  test("accepts a 64-character lowercase hexadecimal digest", () => {
    expect(parseCatalogRevisionId(revisionId)).toBe(revisionId);
  });

  test.each(["a".repeat(63), "a".repeat(65), "A".repeat(64), "../catalog", "a/b", "a\\b", "%2e%2e"])(
    "rejects values that are unsafe as paths: %s",
    (input) => {
      expect(() => parseCatalogRevisionId(input)).toThrow("Invalid Catalog revision ID");
    },
  );
});
