export function getDependencyNodeBundleIds(
  groupIds: Iterable<string>,
  reservedIds: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const used = new Set(reservedIds);
  return new Map(
    [...groupIds].sort().map((groupId) => {
      let id = `bundle:${groupId}`;
      while (used.has(id)) id += ":";
      used.add(id);
      return [groupId, id];
    }),
  );
}
