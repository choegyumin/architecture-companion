import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

await rm(join(packageRoot, "dist"), { force: true, recursive: true });
