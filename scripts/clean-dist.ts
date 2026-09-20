import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const distributionRoot = fileURLToPath(new URL("../skills/architecture-companion", import.meta.url));
const generatedDirectoryNames = ["schemas", "runtime"] as const;
const disposableMetadataNames = new Set([
  ".AppleDouble",
  ".DS_Store",
  ".LSOverride",
  ".directory",
  ".localized",
  "@eaDir",
  "Desktop.ini",
  "Icon\r",
  "Thumbs.db",
  "Thumbs.db:encryptable",
  "__MACOSX",
  "desktop.ini",
  "ehthumbs.db",
  "ehthumbs_vista.db",
]);

const distributionEntryNames = await readdir(distributionRoot);
const disposableMetadataEntryNames = distributionEntryNames.filter(
  (entryName) => disposableMetadataNames.has(entryName) || entryName.startsWith("._"),
);

await Promise.all(
  [...generatedDirectoryNames, ...disposableMetadataEntryNames].map((entryName) =>
    rm(join(distributionRoot, entryName), { force: true, recursive: true }),
  ),
);
