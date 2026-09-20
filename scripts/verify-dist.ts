import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { Dirent } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseDiagramGeneratorManifest } from "@/features/diagram-generator/diagram-generator-manifest";

import { assertSchemaFilesCurrent } from "./_schema-synchronization";

const processTimeoutMs = 10_000;
const shutdownTimeoutMs = 3_000;
const forbiddenEntryNames = [
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  "node_modules",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
] as const;
const expectedTopLevelEntries = [
  "README.md",
  "SKILL.md",
  "client",
  "diagram-generators",
  "references",
  "serve.js",
  "validate-schemas.js",
  "view-annotations.js",
  "view-generators.js",
] as const;
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const distributionRoot = join(packageRoot, "dist");
// Mirrors the static projections in compose-dist.ts. Generator bundles are verified separately.
const copiedProjections = [
  { source: join(packageRoot, "README.md"), destination: "README.md" },
  { source: join(packageRoot, "SKILL.md"), destination: "SKILL.md" },
  { source: join(packageRoot, "references"), destination: "references" },
] as const;
const sourceGeneratorsRoot = join(packageRoot, "src", "plugins", "diagram-generators");

type CompletedProcess = Readonly<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}>;

type InstalledProcess = ReturnType<typeof spawnInstalledScript>;

type ObservedProcess = Readonly<{
  completion: Promise<CompletedProcess>;
}>;

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(parentPath, candidatePath);
  return (
    relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

function withoutNodeResolutionOverrides(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => key !== "NODE_PATH" && key !== "NODE_OPTIONS"),
  );
}

async function findForbiddenEntries(rootPath: string): Promise<readonly string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const matches = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(rootPath, entry.name);
      if (forbiddenEntryNames.some((name) => name === entry.name)) return [entryPath];
      if (entry.isDirectory()) return findForbiddenEntries(entryPath);
      return [];
    }),
  );
  return matches.flat();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function readRequiredText(path: string): Promise<string> {
  const content = await readFile(path, "utf8");
  assert.notEqual(content.trim(), "", `${path} must not be empty.`);
  return content;
}

async function writeFixtureFile(rootPath: string, relativePath: string, content: string): Promise<void> {
  const filePath = join(rootPath, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function writeSpawnGuard(guardPath: string): Promise<void> {
  await writeFile(
    guardPath,
    `const childProcess = require("node:child_process");
const { writeFileSync } = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");

writeFileSync(process.env.ARCHITECTURE_COMPANION_SPAWN_GUARD_READY, "ready");
childProcess.spawn = (...args) => {
  writeFileSync(process.env.ARCHITECTURE_COMPANION_OPENER_MARKER, JSON.stringify(args.slice(0, 2)));
  throw new Error("Installed serve.js must not launch a child process during startup.");
};
syncBuiltinESMExports();
`,
  );
}

async function assertCopiedVerbatim(sourcePath: string, destinationPath: string): Promise<void> {
  const [sourceStat, destinationStat] = await Promise.all([stat(sourcePath), stat(destinationPath)]);
  assert.equal(destinationStat.isFile(), sourceStat.isFile(), `${destinationPath} must mirror ${sourcePath}.`);
  if (sourceStat.isFile()) {
    assert.deepEqual(
      await readFile(destinationPath),
      await readFile(sourcePath),
      `${destinationPath} must match ${sourcePath}.`,
    );
    return;
  }

  const [sourceEntries, destinationEntries] = await Promise.all([
    readdir(sourcePath, { withFileTypes: true }),
    readdir(destinationPath, { withFileTypes: true }),
  ]);
  const entryNames = (entries: readonly Dirent[]) => entries.map(({ name }) => name).toSorted();
  assert.deepEqual(
    entryNames(destinationEntries),
    entryNames(sourceEntries),
    `${destinationPath} must mirror ${sourcePath}.`,
  );

  for (const entry of sourceEntries) {
    const sourceEntryPath = join(sourcePath, entry.name);
    const destinationEntryPath = join(destinationPath, entry.name);
    if (entry.isDirectory()) {
      await assertCopiedVerbatim(sourceEntryPath, destinationEntryPath);
      continue;
    }
    assert.deepEqual(
      await readFile(destinationEntryPath),
      await readFile(sourceEntryPath),
      `${destinationEntryPath} must match ${sourceEntryPath}.`,
    );
  }
}

async function verifyGeneratorResources(rootPath: string): Promise<void> {
  const sourceEntries = await readdir(sourceGeneratorsRoot, { withFileTypes: true });

  for (const entry of sourceEntries.filter((candidate) => candidate.isDirectory())) {
    const sourceManifestPath = join(sourceGeneratorsRoot, entry.name, "GENERATOR.md");
    if (!(await pathExists(sourceManifestPath))) continue;
    await assertCopiedVerbatim(sourceManifestPath, join(rootPath, "diagram-generators", entry.name, "GENERATOR.md"));
  }

  await readRequiredText(join(rootPath, "diagram-generators", "js-module-dependency-graph", "generate.js"));
}

async function verifyDistributionResources(rootPath: string): Promise<void> {
  assert.deepEqual((await readdir(rootPath)).toSorted(), expectedTopLevelEntries);
  assert.deepEqual(await findForbiddenEntries(rootPath), []);

  await readRequiredText(join(rootPath, "README.md"));
  assert.match(await readRequiredText(join(rootPath, "SKILL.md")), /^---\nname: architecture-companion\n/);
  await readRequiredText(join(rootPath, "references", "artifact-writing.md"));
  await readRequiredText(join(rootPath, "references", "review-follow-up.md"));
  await assertSchemaFilesCurrent(join(rootPath, "references"));
  for (const { source, destination } of copiedProjections) {
    await assertCopiedVerbatim(source, join(rootPath, destination));
  }
  await verifyGeneratorResources(rootPath);
}

function spawnInstalledScript(
  scriptPath: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  workingDirectory: string,
  nodeOptions: readonly string[] = [],
) {
  return spawn(process.execPath, [...nodeOptions, scriptPath, ...args], {
    cwd: workingDirectory,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function observeProcess(child: InstalledProcess): ObservedProcess {
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  return {
    completion: new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, signal) => {
        resolve({ exitCode, signal, stdout, stderr });
      });
    }),
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function stopProcess(child: InstalledProcess, observed: ObservedProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    await withTimeout(observed.completion, shutdownTimeoutMs, "Installed process exited but did not close.");
    return;
  }

  child.kill("SIGTERM");
  try {
    await withTimeout(observed.completion, shutdownTimeoutMs, "Installed server did not close after SIGTERM.");
  } catch {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await withTimeout(observed.completion, shutdownTimeoutMs, "Installed server did not close after SIGKILL.");
  }
}

async function runInstalledScript(
  scriptPath: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  workingDirectory: string,
): Promise<CompletedProcess> {
  const child = spawnInstalledScript(scriptPath, args, environment, workingDirectory);
  const observed = observeProcess(child);

  try {
    return await withTimeout(observed.completion, processTimeoutMs, `Installed process timed out: ${scriptPath}`);
  } catch (error) {
    try {
      await stopProcess(child, observed);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Installed process failed and could not be stopped: ${scriptPath}`,
      );
    }
    throw error;
  }
}

async function waitForServerUrl(child: InstalledProcess, observed: ObservedProcess): Promise<string> {
  let stdout = "";

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Installed server did not print a URL after ${processTimeoutMs}ms.`));
    }, processTimeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const newlineIndex = stdout.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = stdout.slice(0, newlineIndex).trim();

      clearTimeout(timeout);
      if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(line)) {
        reject(new Error(`Installed server printed an invalid URL: ${line}`));
        return;
      }
      resolve(line);
    });
    void observed.completion.then(
      (result) => {
        clearTimeout(timeout);
        reject(
          new Error(
            `Installed server exited before printing a URL: ${result.exitCode ?? result.signal}. stderr: ${result.stderr}`,
          ),
        );
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function fetchRequired(url: string): Promise<Response> {
  const response = await fetch(url, { signal: AbortSignal.timeout(processTimeoutMs) });
  assert.equal(response.status, 200, `${url} must return 200.`);
  return response;
}

function createInstalledEnvironment(
  skillRoot: string,
  homeDirectory: string,
  spawnGuardReadyPath: string,
  openerMarkerPath: string,
): NodeJS.ProcessEnv {
  return {
    ...withoutNodeResolutionOverrides(process.env),
    ARCHITECTURE_COMPANION_OPENER_MARKER: openerMarkerPath,
    ARCHITECTURE_COMPANION_SPAWN_GUARD_READY: spawnGuardReadyPath,
    HOME: homeDirectory,
    PWD: skillRoot,
    USERPROFILE: homeDirectory,
  };
}

function assertSuccessfulCompletion(result: CompletedProcess, scriptPath: string): void {
  assert.deepEqual(
    { exitCode: result.exitCode, signal: result.signal, stderr: result.stderr },
    { exitCode: 0, signal: null, stderr: "" },
    `Installed script must complete successfully: ${scriptPath}`,
  );
}

async function readExpectedBuiltInGeneratorDescriptors(skillRoot: string): Promise<Readonly<readonly unknown[]>> {
  const childEntries = await readdir(sourceGeneratorsRoot, { withFileTypes: true });
  const descriptors: { description: string; id: string; path: string; source: "built-in" }[] = [];

  for (const { name } of childEntries.filter((entry) => entry.isDirectory())) {
    const manifestPath = join(sourceGeneratorsRoot, name, "GENERATOR.md");
    if (!(await pathExists(manifestPath))) continue;
    const manifest = parseDiagramGeneratorManifest(await readFile(manifestPath, "utf8"));
    descriptors.push({
      description: manifest.description,
      id: manifest.id,
      path: await realpath(join(skillRoot, "diagram-generators", name)),
      source: "built-in",
    });
  }

  assert.ok(descriptors.length > 0, "Built-in diagram generators must ship at least one manifest.");
  const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
  return descriptors.toSorted((left, right) => compareText(left.id, right.id) || compareText(left.path, right.path));
}

async function verifyInstalledGeneratorEntry(
  skillRoot: string,
  scopePath: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const scriptPath = join(skillRoot, "view-generators.js");
  const viewResult = await runInstalledScript(scriptPath, [scopePath], environment, skillRoot);

  assertSuccessfulCompletion(viewResult, scriptPath);
  const outputLine = /^([^\n]+)\n$/.exec(viewResult.stdout)?.at(1);
  assert.ok(outputLine, "Installed view-generators.js must print one JSON line.");
  assert.deepEqual(JSON.parse(outputLine), await readExpectedBuiltInGeneratorDescriptors(skillRoot));
}

async function verifyInstalledJsModuleDependencyGenerator(
  skillRoot: string,
  scopePath: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  await writeFixtureFile(scopePath, "package.json", '{"name":"installed-fixture","type":"module"}\n');
  await writeFixtureFile(
    scopePath,
    "tsconfig.json",
    `${JSON.stringify({ compilerOptions: { paths: { "@/*": ["src/*"] } } }, null, 2)}\n`,
  );
  await writeFixtureFile(
    scopePath,
    "src/index.ts",
    'import { value } from "@/value";\nimport feature from "installed-package/feature";\nexport { feature, value };\n',
  );
  await writeFixtureFile(scopePath, "src/value.ts", "export const value = true;\n");
  await writeFixtureFile(
    scopePath,
    "node_modules/installed-package/package.json",
    '{"name":"installed-package","type":"module","exports":{"./feature":"./feature.js"}}\n',
  );
  await writeFixtureFile(scopePath, "node_modules/installed-package/feature.js", "export default true;\n");

  const scriptPath = join(skillRoot, "diagram-generators", "js-module-dependency-graph", "generate.js");
  const result = await runInstalledScript(
    scriptPath,
    ["--scope", scopePath, "--ts-config", "tsconfig.json", "src"],
    environment,
    skillRoot,
  );
  assertSuccessfulCompletion(result, scriptPath);
  const outputLine = /^([^\n]+)\n$/.exec(result.stdout)?.at(1);
  assert.ok(outputLine, "Installed JavaScript module dependency generator must print one JSON line.");
  const output = JSON.parse(outputLine) as Readonly<{ graphPath?: unknown }>;
  assert.equal(typeof output.graphPath, "string");
  assert.ok(isAbsolute(output.graphPath as string));

  const graphPath = output.graphPath as string;
  const graph = JSON.parse(await readRequiredText(graphPath)) as Readonly<{
    groups?: readonly Readonly<{ id?: unknown }>[];
    nodes?: readonly Readonly<{ id?: unknown }>[];
    edges?: readonly Readonly<{ id?: unknown }>[];
  }>;
  assert.ok(!graph.groups?.some(({ id }) => id === "group:directory:src"));
  assert.ok(!graph.groups?.some(({ id }) => id === "group:package:."));
  assert.ok(graph.groups?.some(({ id }) => id === "group:external-packages"));
  assert.ok(graph.nodes?.some(({ id }) => id === "file:src/index.ts"));
  assert.ok(graph.nodes?.some(({ id }) => id === "external:installed-package"));
  assert.ok(graph.edges?.some(({ id }) => id === "dependency:file%3Asrc%2Findex.ts:file%3Asrc%2Fvalue.ts:runtime"));
  await rm(dirname(graphPath), { recursive: true });
}

async function verifyInstalledAnnotationEntry(
  skillRoot: string,
  scopePath: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const scriptPath = join(skillRoot, "view-annotations.js");
  const result = await runInstalledScript(scriptPath, [scopePath], environment, skillRoot);

  assertSuccessfulCompletion(result, scriptPath);
}

async function verifyInstalledValidationEntry(
  skillRoot: string,
  scopePath: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const artifactDirectory = join(scopePath, ".architecture-companion");
  await mkdir(join(artifactDirectory, "behaviors"), { recursive: true });
  await mkdir(join(artifactDirectory, "designs"), { recursive: true });

  const scriptPath = join(skillRoot, "validate-schemas.js");
  const result = await runInstalledScript(scriptPath, [scopePath], environment, skillRoot);
  assertSuccessfulCompletion(result, scriptPath);

  await rm(artifactDirectory, { recursive: true });
}

function startInstalledServer(
  skillRoot: string,
  scopePath: string,
  environment: NodeJS.ProcessEnv,
  spawnGuardPath: string,
): Readonly<{ child: InstalledProcess; observed: ObservedProcess; url: Promise<string> }> {
  const child = spawnInstalledScript(join(skillRoot, "serve.js"), [scopePath], environment, skillRoot, [
    "--require",
    spawnGuardPath,
  ]);
  const observed = observeProcess(child);
  return { child, observed, url: waitForServerUrl(child, observed) };
}

async function verifyInstalledClient(
  serverUrl: string,
  spawnGuardReadyPath: string,
  openerMarkerPath: string,
): Promise<void> {
  const parsedServerUrl = new URL(serverUrl);
  assert.equal(parsedServerUrl.hostname, "127.0.0.1");
  assert.notEqual(parsedServerUrl.port, "0");
  assert.equal(await readRequiredText(spawnGuardReadyPath), "ready");
  assert.equal(await pathExists(openerMarkerPath), false);

  const pageResponse = await fetchRequired(serverUrl);
  const pageHtml = await pageResponse.text();
  assert.match(pageHtml, /Architecture Companion/);
  const assetPath = pageHtml.match(/(?:src|href)="([^"]*\/assets\/[^"]+)"/)?.at(1);
  assert.ok(assetPath, "Built client HTML must reference an asset.");

  const assetUrl = new URL(assetPath, serverUrl);
  assert.equal(assetUrl.origin, parsedServerUrl.origin);
  assert.ok(assetUrl.pathname.startsWith("/assets/"));
  const assetResponse = await fetchRequired(assetUrl.href);
  assert.ok((await assetResponse.arrayBuffer()).byteLength > 0, "Built client asset must not be empty.");
  assert.equal(await pathExists(openerMarkerPath), false);
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "architecture-companion-dist-"));
const skillRoot = join(temporaryRoot, "skill");
const scopePath = join(temporaryRoot, "scope");
const homeDirectory = join(temporaryRoot, "home");
const spawnGuardPath = join(temporaryRoot, "spawn-guard.cjs");
const spawnGuardReadyPath = join(temporaryRoot, "spawn-guard-ready");
const openerMarkerPath = join(temporaryRoot, "opener-called");
let serverProcess: ReturnType<typeof startInstalledServer> | undefined;
let verificationFailure: Readonly<{ reason: unknown }> | undefined;

try {
  assert.equal(
    isPathInside(await realpath(repositoryRoot), await realpath(temporaryRoot)),
    false,
    "Distribution verification must run outside the repository.",
  );
  await verifyDistributionResources(distributionRoot);
  await cp(distributionRoot, skillRoot, { recursive: true });
  await Promise.all([mkdir(scopePath), mkdir(homeDirectory), writeSpawnGuard(spawnGuardPath)]);
  await verifyDistributionResources(skillRoot);

  const environment = createInstalledEnvironment(skillRoot, homeDirectory, spawnGuardReadyPath, openerMarkerPath);
  await verifyInstalledGeneratorEntry(skillRoot, scopePath, environment);
  await verifyInstalledJsModuleDependencyGenerator(skillRoot, scopePath, environment);
  await verifyInstalledAnnotationEntry(skillRoot, scopePath, environment);
  await verifyInstalledValidationEntry(skillRoot, scopePath, environment);
  serverProcess = startInstalledServer(skillRoot, scopePath, environment, spawnGuardPath);
  await verifyInstalledClient(await serverProcess.url, spawnGuardReadyPath, openerMarkerPath);
} catch (error) {
  verificationFailure = { reason: error };
}

const processCleanupResults = await Promise.allSettled([
  serverProcess ? stopProcess(serverProcess.child, serverProcess.observed) : Promise.resolve(),
]);
const filesystemCleanupResults = await Promise.allSettled([rm(temporaryRoot, { recursive: true })]);
const cleanupFailures = [...processCleanupResults, ...filesystemCleanupResults].flatMap((result) =>
  result.status === "rejected" ? [result.reason] : [],
);

if (verificationFailure && cleanupFailures.length > 0) {
  throw new AggregateError(
    [verificationFailure.reason, ...cleanupFailures],
    "Distribution verification and cleanup failed.",
  );
}
if (verificationFailure) throw verificationFailure.reason;
if (cleanupFailures.length > 0) throw new AggregateError(cleanupFailures, "Distribution verification cleanup failed.");
