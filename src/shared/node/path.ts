import { isAbsolute, relative, sep } from "node:path";

export function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

export function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(parentPath, candidatePath);
  return (
    relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

export function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
