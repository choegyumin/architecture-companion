import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import type { ConsumerScope } from "@/server/consumer-scope";

export type SourceLocation = Readonly<{
  relativePath: string;
  line?: number;
  endLine?: number;
}>;

export type OpenSourceLocation = Readonly<{
  path: string;
  line?: number;
  endLine?: number;
}>;

export type OpenPath = (location: OpenSourceLocation) => Promise<void>;

export type OpenSourceReferenceResult =
  Readonly<{ status: 200; href: string }> | Readonly<{ status: 400 | 403 | 404 | 422 | 500; message: string }>;

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isOutsideScope(scopePath: string, sourcePath: string): boolean {
  const relativePath = relative(scopePath, sourcePath);
  return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

export function parseSourceHref(href: string): SourceLocation {
  let url: URL;
  try {
    url = new URL(href);
  } catch (error) {
    throw new Error("Source href must be a valid URL.", { cause: error });
  }

  if (url.protocol !== "source:" || url.hostname || url.username || url.password || url.search) {
    throw new Error("Source href must use the source: protocol and a relative reviewed path.");
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch (error) {
    throw new Error("Source href path is not valid URL encoding.", { cause: error });
  }

  if (!decodedPath.startsWith("/") || decodedPath.startsWith("//") || decodedPath.includes("\\")) {
    throw new Error("Source href path must be relative to the review scope.");
  }

  const relativePath = decodedPath.slice(1);
  if (!relativePath || relativePath.split("/").includes("..")) {
    throw new Error("Source href path must stay within the review scope.");
  }

  let line: number | undefined;
  let endLine: number | undefined;
  if (url.hash) {
    const match = /^#L([1-9]\d*)(?:-L?([1-9]\d*))?$/.exec(url.hash);
    if (!match) throw new Error("Source href line fragment must use #L42 or #L42-L60.");
    line = Number(match.at(1));
    endLine = match.at(2) ? Number(match.at(2)) : undefined;
    if (endLine !== undefined && endLine < line) {
      throw new Error("Source href line range must end at or after its start.");
    }
  }

  return { relativePath, ...(line !== undefined ? { line } : {}), ...(endLine !== undefined ? { endLine } : {}) };
}

export async function openSourceReference(
  scope: ConsumerScope,
  href: string,
  openPath: OpenPath,
): Promise<OpenSourceReferenceResult> {
  let source: SourceLocation;
  try {
    source = parseSourceHref(href);
  } catch (error) {
    return { status: 400, message: error instanceof Error ? error.message : "Source href is invalid." };
  }

  const canonicalScopePath = await realpath(scope.path);
  let sourcePath: string;

  try {
    sourcePath = await realpath(join(canonicalScopePath, source.relativePath));
  } catch (error) {
    if (isMissingPathError(error)) {
      return { status: 404, message: `Source file does not exist: ${source.relativePath}` };
    }
    throw error;
  }

  if (isOutsideScope(canonicalScopePath, sourcePath)) {
    return { status: 403, message: "Source path resolves outside the review scope." };
  }

  if (!(await stat(sourcePath)).isFile()) {
    return { status: 422, message: `Source path is not a file: ${source.relativePath}` };
  }

  try {
    await openPath({
      path: sourcePath,
      ...(source.line !== undefined ? { line: source.line } : {}),
      ...(source.endLine !== undefined ? { endLine: source.endLine } : {}),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown operating system error";
    return { status: 500, message: `Could not open source file: ${source.relativePath}. ${detail}` };
  }

  return { status: 200, href };
}
