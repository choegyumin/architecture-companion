import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { Dirent } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, sep } from "node:path";
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
// Mirrors the non-executable projections in compose-dist.ts: each destination must reproduce its source verbatim.
const copiedProjections = [
  { source: join(packageRoot, "README.md"), destination: "README.md" },
  { source: join(packageRoot, "SKILL.md"), destination: "SKILL.md" },
  { source: join(packageRoot, "references"), destination: "references" },
] as const;
const diagramGeneratorSourceRoot = join(packageRoot, "src", "plugins", "diagram-generators");
const reactComponentGeneratorRelativePath = join("diagram-generators", "react-component-structure", "cli", "run.js");

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

async function collectRelativeFiles(
  rootPath: string,
  include: (path: string) => boolean,
  currentPath: string = rootPath,
): Promise<readonly string[]> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(currentPath, entry.name);
      if (entry.isDirectory()) return collectRelativeFiles(rootPath, include, entryPath);
      return entry.isFile() && include(entryPath) ? [relative(rootPath, entryPath)] : [];
    }),
  );
  return files.flat().toSorted();
}

async function assertGeneratorResources(rootPath: string): Promise<void> {
  const destinationRoot = join(rootPath, "diagram-generators");
  const resourcePaths = await collectRelativeFiles(
    diagramGeneratorSourceRoot,
    (path) => ![".ts", ".tsx"].includes(extname(path)),
  );
  assert.ok(resourcePaths.length > 0, "Built-in generators must include resources.");
  for (const resourcePath of resourcePaths) {
    assert.deepEqual(
      await readFile(join(destinationRoot, resourcePath)),
      await readFile(join(diagramGeneratorSourceRoot, resourcePath)),
      `${join(destinationRoot, resourcePath)} must match its source resource.`,
    );
  }
  assert.deepEqual(
    await collectRelativeFiles(destinationRoot, (path) => [".ts", ".tsx"].includes(extname(path))),
    [],
    "Installed generators must not contain TypeScript source files.",
  );
  await readRequiredText(join(rootPath, reactComponentGeneratorRelativePath));
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
  await assertGeneratorResources(rootPath);
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
  const sourceRoot = join(packageRoot, "src", "plugins", "diagram-generators");
  const childEntries = await readdir(sourceRoot, { withFileTypes: true });
  const descriptors: { description: string; id: string; path: string; source: "built-in" }[] = [];

  for (const { name } of childEntries.filter((entry) => entry.isDirectory())) {
    const manifestPath = join(sourceRoot, name, "GENERATOR.md");
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

async function verifyInstalledReactComponentGenerator(
  skillRoot: string,
  scopePath: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const sourceRoot = join(scopePath, "src");
  await mkdir(sourceRoot, { recursive: true });
  await Promise.all([
    writeFile(
      join(sourceRoot, "app.tsx"),
      `import { Content } from "./content";\nimport { Layout } from "./layout";\nexport function App() { return <Layout><Content /></Layout>; }\n`,
    ),
    writeFile(join(sourceRoot, "content.tsx"), `export function Content() { return <main />; }\n`),
    writeFile(
      join(sourceRoot, "layout.tsx"),
      `export function Header() { return <header />; }\nexport function Layout({ children }: { children: unknown }) { return <section><Header />{children}</section>; }\n`,
    ),
  ]);

  type InstalledGraph = Readonly<{
    edges: ReadonlyArray<{ kind?: string; label?: string; source: string; target: string }>;
    groups: readonly unknown[];
    nodes: ReadonlyArray<{ id: string; title: string }>;
  }>;

  const scriptPath = join(skillRoot, reactComponentGeneratorRelativePath);
  async function generateGraph(extraArguments: readonly string[] = []): Promise<InstalledGraph> {
    const result = await runInstalledScript(
      scriptPath,
      ["--scope", scopePath, "--source", "src", ...extraArguments],
      environment,
      skillRoot,
    );
    assertSuccessfulCompletion(result, scriptPath);
    const graphPath = /^([^\n]+)\n$/.exec(result.stdout)?.at(1);
    assert.ok(graphPath && isAbsolute(graphPath), "Installed React generator must print one absolute graph path.");
    const graphDirectory = dirname(graphPath);
    assert.match(graphDirectory, /architecture-companion-react-components-/);

    try {
      return JSON.parse(await readFile(graphPath, "utf8")) as InstalledGraph;
    } finally {
      await rm(graphDirectory, { recursive: true });
    }
  }

  function edgeFacts(graph: InstalledGraph) {
    const titlesById = new Map(graph.nodes.map(({ id, title }) => [id, title]));
    return graph.edges
      .map((edge) => ({
        kind: edge.kind,
        label: edge.label,
        source: titlesById.get(edge.source),
        target: titlesById.get(edge.target),
      }))
      .toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }

  const graph = await generateGraph();
  assert.deepEqual(Object.keys(graph).toSorted(), ["edges", "groups", "nodes"]);
  assert.deepEqual(graph.groups, []);
  assert.deepEqual(graph.nodes.map(({ title }) => title).toSorted(), ["App", "Content", "Header", "Layout"]);
  assert.deepEqual(edgeFacts(graph), [
    { kind: "direct-render", label: undefined, source: "App", target: "Layout" },
    { kind: "direct-render", label: undefined, source: "Layout", target: "Header" },
    { kind: "node-prop", label: "Node prop · children", source: "Layout", target: "Content" },
  ]);

  for (const filtered of [
    await generateGraph(["--exclude-component", "Layout"]),
    await generateGraph(["--exclude-file", "src/layout.tsx"]),
  ]) {
    assert.deepEqual(filtered.nodes.map(({ title }) => title).toSorted(), ["App", "Content"]);
    assert.deepEqual(edgeFacts(filtered), [
      { kind: "node-prop", label: "Node prop · children", source: "App", target: "Content" },
    ]);
  }
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
  await verifyInstalledReactComponentGenerator(skillRoot, scopePath, environment);
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
