import { createHash } from "node:crypto";
import { readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import micromatch from "micromatch";
import ts from "typescript";

import type { DefaultDiagramEdge, DefaultDiagramNode, DiagramGraph } from "@/features/diagram/diagram-graph";

/* eslint-disable no-use-before-define -- Recursive AST walkers use mutually recursive function declarations. */

const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const defaultAnalysisExcludeFilePatterns = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.output/**",
  "**/out/**",
  "**/__tests__/**",
  "**/*.test.{js,jsx,ts,tsx}",
  "**/*.spec.{js,jsx,ts,tsx}",
  "**/*.d.ts",
  "**/*.generated.{js,jsx,ts,tsx}",
  "**/*.gen.{js,jsx,ts,tsx}",
] as const;

export type ReactComponentRelationshipKind = "direct-render" | "node-prop" | "render-prop" | "component-prop";

export type GenerateReactComponentStructureOptions = Readonly<{
  scopePath: string;
  sourcePaths: readonly string[];
  tsconfigPath?: string;
  excludeFilePatterns?: readonly string[];
  excludeComponentPatterns?: readonly string[];
}>;

type FunctionLike = ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;

type ComponentDefinition = Readonly<{
  id: string;
  name: string;
  filePath: string;
  relativePath: string;
  declaration: ts.Node;
  symbol?: ts.Symbol;
  parameters: readonly ts.ParameterDeclaration[];
  renderRoots: readonly ts.Expression[];
  body?: ts.ConciseBody;
  classComponent: boolean;
}>;

type ComponentTarget = Readonly<{
  id: string;
  title: string;
  externalPackage?: string;
  definition?: ComponentDefinition;
}>;

type SuppliedValueKind = Exclude<ReactComponentRelationshipKind, "direct-render">;

type DirectRenderRelationship = Readonly<{
  source: string;
  target: string;
  kind: "direct-render";
}>;

type SuppliedRenderRelationship = Readonly<{
  source: string;
  target: string;
  kind: SuppliedValueKind;
  propName: string;
  supplierIds: readonly string[];
}>;

type Relationship = DirectRenderRelationship | SuppliedRenderRelationship;

type SuppliedValue = Readonly<{
  propName: string;
  kind: SuppliedValueKind;
  targetUseIds: readonly string[];
}>;

type ComponentUse = Readonly<{
  id: string;
  ownerId: string;
  target: ComponentTarget;
  suppliedValues: SuppliedValue[];
}>;

type TerminalRule = Readonly<{
  type: "terminal";
  kind: SuppliedValueKind;
}>;

type ForwardRule = Readonly<{
  type: "forward";
  targetUseId: string;
  targetPropName: string;
}>;

type ConsumerRule = TerminalRule | ForwardRule;

type ConsumerRules = Readonly<{
  exact: Map<string, ConsumerRule[]>;
  spreads: ReadonlyArray<Readonly<{ excludedProps: ReadonlySet<string>; targetUseId: string }>>;
}>;

type ConsumerRouteStep = Readonly<{
  useId: string;
  componentId: string;
  propName: string;
}>;

type ConsumerRoute = Readonly<{
  kind: SuppliedValueKind;
  steps: readonly ConsumerRouteStep[];
}>;

type ComponentVisibility = Readonly<{
  boundaryVisible: boolean;
  implementationAnalyzed: boolean;
}>;

type PropBindings = Readonly<{
  propsObjects: ReadonlySet<ts.Symbol>;
  restObjects: ReadonlyMap<ts.Symbol, ReadonlySet<string>>;
  propSymbols: ReadonlyMap<ts.Symbol, string>;
  classComponent: boolean;
}>;

type AnalysisContext = Readonly<{
  checker: ts.TypeChecker;
  definitionsBySymbol: ReadonlyMap<ts.Symbol, ComponentDefinition>;
  definitionsByDeclaration: ReadonlyMap<ts.Node, ComponentDefinition>;
  externalTargets: Map<string, ComponentTarget>;
  uses: Map<string, ComponentUse>;
  directUseIdsByOwner: Map<string, string[]>;
  analyzedUseIds: Set<string>;
}>;

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const childPath = relative(parentPath, candidatePath);
  return childPath === "" || (childPath !== ".." && !childPath.startsWith(`..${sep}`) && !isAbsolute(childPath));
}

function matchesAny(value: string, patterns: readonly string[]): boolean {
  return patterns.length > 0 && micromatch.isMatch(value, patterns, { dot: true });
}

async function collectSourceFiles(
  scopePath: string,
  sourcePaths: readonly string[],
  excludeFilePatterns: readonly string[],
): Promise<readonly string[]> {
  const files = new Set<string>();

  async function visit(candidatePath: string): Promise<void> {
    const resolvedPath = await realpath(candidatePath);
    if (!isPathInside(scopePath, resolvedPath)) {
      throw new Error(`Source path must stay inside the scope: ${candidatePath}`);
    }

    const relativePath = toPosixPath(relative(scopePath, resolvedPath));
    if (relativePath && matchesAny(relativePath, excludeFilePatterns)) return;

    const candidateStat = await stat(resolvedPath);
    if (candidateStat.isDirectory()) {
      const entries = await readdir(resolvedPath, { withFileTypes: true });
      for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
        if (entry.isDirectory() || entry.isFile()) await visit(join(resolvedPath, entry.name));
      }
      return;
    }

    if (!candidateStat.isFile()) return;
    if (!sourceExtensions.has(extname(resolvedPath))) return;
    files.add(resolvedPath);
  }

  for (const sourcePath of sourcePaths) {
    await visit(isAbsolute(sourcePath) ? sourcePath : resolve(scopePath, sourcePath));
  }

  return [...files].toSorted();
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

function readCompilerOptions(scopePath: string, tsconfigPath?: string): ts.CompilerOptions {
  const configPath = tsconfigPath
    ? isAbsolute(tsconfigPath)
      ? tsconfigPath
      : resolve(scopePath, tsconfigPath)
    : ts.findConfigFile(scopePath, ts.sys.fileExists, "tsconfig.json");

  let options: ts.CompilerOptions = {};
  if (configPath) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) throw new Error(`Cannot read ${configPath}: ${formatDiagnostic(config.error)}`);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve(configPath, ".."));
    if (parsed.errors.length > 0) {
      throw new Error(`Cannot parse ${configPath}: ${parsed.errors.map(formatDiagnostic).join("\n")}`);
    }
    options = parsed.options;
  }

  return {
    ...options,
    allowJs: true,
    checkJs: false,
    composite: false,
    incremental: false,
    jsx: options.jsx ?? ts.JsxEmit.Preserve,
    module: options.module ?? ts.ModuleKind.ESNext,
    moduleResolution: options.moduleResolution ?? ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    target: options.target ?? ts.ScriptTarget.ESNext,
  };
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function collectReturnExpressions(body: ts.ConciseBody): readonly ts.Expression[] {
  if (!ts.isBlock(body)) return [body];
  const expressions: ts.Expression[] = [];

  function visit(node: ts.Node): void {
    if (node !== body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) {
      if (node.expression) expressions.push(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(body);
  return expressions;
}

function getImportModuleSpecifier(symbol: ts.Symbol | undefined): string | undefined {
  for (const declaration of symbol?.declarations ?? []) {
    const candidate = ts.isImportSpecifier(declaration)
      ? declaration.parent.parent.parent
      : ts.isNamespaceImport(declaration)
        ? declaration.parent.parent
        : ts.isImportClause(declaration)
          ? declaration.parent
          : undefined;
    if (candidate && ts.isImportDeclaration(candidate) && ts.isStringLiteral(candidate.moduleSpecifier)) {
      return candidate.moduleSpecifier.text;
    }
  }
  return undefined;
}

function getImportedName(symbol: ts.Symbol | undefined): string | undefined {
  for (const declaration of symbol?.declarations ?? []) {
    if (ts.isImportSpecifier(declaration)) return (declaration.propertyName ?? declaration.name).text;
    if (ts.isImportClause(declaration)) return "default";
    if (ts.isNamespaceImport(declaration)) return "*";
  }
  return undefined;
}

function isCreateElementCall(node: ts.Node, checker: ts.TypeChecker): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = unwrapExpression(node.expression);
  if (ts.isPropertyAccessExpression(callee)) {
    if (callee.name.text !== "createElement") return false;
    const receiver = leftmostIdentifier(callee.expression) ?? callee.expression;
    return isReactSymbol(checker.getSymbolAtLocation(receiver), checker);
  }
  if (!ts.isIdentifier(callee)) return false;
  const symbol = checker.getSymbolAtLocation(callee);
  return getImportModuleSpecifier(symbol) === "react" && getImportedName(symbol) === "createElement";
}

function isArrayRenderingMethodCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const callee = unwrapExpression(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || !["flatMap", "map"].includes(callee.name.text)) return false;
  const declaration = checker.getResolvedSignature(call)?.getDeclaration();
  if (!declaration) return false;
  return /^lib\..*\.d\.ts$/.test(basename(declaration.getSourceFile().fileName));
}

function containsReactOutput(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  const unwrapped = unwrapExpression(expression);
  if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped) || ts.isJsxFragment(unwrapped)) return true;
  if (ts.isCallExpression(unwrapped)) {
    if (isCreateElementCall(unwrapped, checker)) return true;
    if (!isArrayRenderingMethodCall(unwrapped, checker)) return false;
    return unwrapped.arguments.some(
      (argument) =>
        (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) &&
        collectReturnExpressions(argument.body).some((returned) => containsReactOutput(returned, checker)),
    );
  }
  if (ts.isConditionalExpression(unwrapped)) {
    return containsReactOutput(unwrapped.whenTrue, checker) || containsReactOutput(unwrapped.whenFalse, checker);
  }
  if (ts.isBinaryExpression(unwrapped)) return containsReactOutput(unwrapped.right, checker);
  if (ts.isArrayLiteralExpression(unwrapped)) {
    return unwrapped.elements.some((element) => ts.isExpression(element) && containsReactOutput(element, checker));
  }
  return false;
}

function isReactWrapperCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const callee = unwrapExpression(call.expression);
  if (ts.isIdentifier(callee)) {
    const symbol = checker.getSymbolAtLocation(callee);
    return (
      getImportModuleSpecifier(symbol) === "react" && ["forwardRef", "memo"].includes(getImportedName(symbol) ?? "")
    );
  }
  if (!ts.isPropertyAccessExpression(callee) || !["forwardRef", "memo"].includes(callee.name.text)) return false;
  const receiver = leftmostIdentifier(callee.expression) ?? callee.expression;
  return isReactSymbol(checker.getSymbolAtLocation(receiver), checker);
}

function unwrapFunction(initializer: ts.Expression, checker: ts.TypeChecker): FunctionLike | undefined {
  const expression = unwrapExpression(initializer);
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression;
  if (
    !ts.isCallExpression(expression) ||
    expression.arguments.length === 0 ||
    !isReactWrapperCall(expression, checker)
  ) {
    return undefined;
  }
  return unwrapFunction(expression.arguments.at(0) as ts.Expression, checker);
}

function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function defaultExportName(sourceFile: ts.SourceFile): string {
  const fileName = basename(sourceFile.fileName, extname(sourceFile.fileName));
  const words = fileName.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const name = words.map((word) => `${word.at(0)?.toUpperCase()}${word.slice(1)}`).join("");
  return name || "DefaultExport";
}

function createComponentId(relativePath: string, identityName: string): string {
  return `component:${relativePath}#${identityName}`;
}

function isDefaultExportDeclaration(declaration: ts.FunctionDeclaration | ts.ClassDeclaration): boolean {
  return declaration.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

function defaultExportSymbol(sourceFile: ts.SourceFile, checker: ts.TypeChecker): ts.Symbol | undefined {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  return moduleSymbol
    ? checker.getExportsOfModule(moduleSymbol).find((candidate) => candidate.name === "default")
    : undefined;
}

function collectComponentDefinitions(
  sourceFiles: readonly ts.SourceFile[],
  scopePath: string,
  checker: ts.TypeChecker,
): readonly ComponentDefinition[] {
  const definitions: ComponentDefinition[] = [];
  const definitionIds = new Set<string>();

  function addDefinition(
    sourceFile: ts.SourceFile,
    declaration: ts.Node,
    name: string,
    symbol: ts.Symbol | undefined,
    functionLike: FunctionLike | undefined,
    renderRoots: readonly ts.Expression[],
    body: ts.ConciseBody | undefined,
    classComponent: boolean,
    identityName = name,
  ): void {
    if (!isComponentName(name)) return;
    if (renderRoots.length === 0 || !renderRoots.some((root) => containsReactOutput(root, checker))) return;
    const relativePath = toPosixPath(relative(scopePath, sourceFile.fileName));
    const id = createComponentId(relativePath, identityName);
    if (definitionIds.has(id)) throw new Error(`Duplicate React component identity: ${id}`);
    definitionIds.add(id);
    definitions.push({
      id,
      name,
      filePath: sourceFile.fileName,
      relativePath,
      declaration,
      symbol,
      parameters: functionLike?.parameters ?? [],
      renderRoots,
      body,
      classComponent,
    });
  }

  for (const sourceFile of sourceFiles) {
    for (const statement of sourceFile.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.body) {
        const anonymousDefault = !statement.name && isDefaultExportDeclaration(statement);
        const name = statement.name?.text ?? (anonymousDefault ? defaultExportName(sourceFile) : undefined);
        if (!name) continue;
        const roots = collectReturnExpressions(statement.body);
        addDefinition(
          sourceFile,
          statement,
          name,
          statement.name ? checker.getSymbolAtLocation(statement.name) : defaultExportSymbol(sourceFile, checker),
          statement,
          roots,
          statement.body,
          false,
          anonymousDefault ? "default" : name,
        );
        continue;
      }

      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
          const functionLike = unwrapFunction(declaration.initializer, checker);
          if (!functionLike || !functionLike.body) continue;
          addDefinition(
            sourceFile,
            declaration,
            declaration.name.text,
            checker.getSymbolAtLocation(declaration.name),
            functionLike,
            collectReturnExpressions(functionLike.body),
            functionLike.body,
            false,
          );
        }
        continue;
      }

      if (ts.isClassDeclaration(statement)) {
        const anonymousDefault = !statement.name && isDefaultExportDeclaration(statement);
        const name = statement.name?.text ?? (anonymousDefault ? defaultExportName(sourceFile) : undefined);
        if (!name) continue;
        const renderMethod = statement.members.find(
          (member): member is ts.MethodDeclaration =>
            ts.isMethodDeclaration(member) &&
            ts.isIdentifier(member.name) &&
            member.name.text === "render" &&
            !!member.body,
        );
        if (!renderMethod?.body) continue;
        addDefinition(
          sourceFile,
          statement,
          name,
          statement.name ? checker.getSymbolAtLocation(statement.name) : defaultExportSymbol(sourceFile, checker),
          undefined,
          collectReturnExpressions(renderMethod.body),
          renderMethod.body,
          true,
          anonymousDefault ? "default" : name,
        );
        continue;
      }

      if (ts.isExportAssignment(statement)) {
        const functionLike = unwrapFunction(statement.expression, checker);
        if (!functionLike?.body) continue;
        const name = defaultExportName(sourceFile);
        addDefinition(
          sourceFile,
          statement,
          name,
          defaultExportSymbol(sourceFile, checker),
          functionLike,
          collectReturnExpressions(functionLike.body),
          functionLike.body,
          false,
          "default",
        );
      }
    }
  }

  return definitions.toSorted((left, right) => left.id.localeCompare(right.id));
}

function canonicalSymbol(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): ts.Symbol | undefined {
  if (!symbol) return undefined;
  if ((symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol;
  return checker.getAliasedSymbol(symbol);
}

function resolveDefinition(
  symbol: ts.Symbol | undefined,
  checker: ts.TypeChecker,
  definitionsBySymbol: ReadonlyMap<ts.Symbol, ComponentDefinition>,
  definitionsByDeclaration: ReadonlyMap<ts.Node, ComponentDefinition>,
  visited: ReadonlySet<ts.Symbol> = new Set(),
): ComponentDefinition | undefined {
  if (!symbol || visited.has(symbol)) return undefined;
  const nextVisited = new Set(visited).add(symbol);
  const canonical = canonicalSymbol(symbol, checker);
  const direct = canonical ? definitionsBySymbol.get(canonical) : undefined;
  if (direct) return direct;
  for (const declaration of canonical?.declarations ?? symbol.declarations ?? []) {
    const definition = definitionsByDeclaration.get(declaration);
    if (definition) return definition;
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      const initializer = unwrapExpression(declaration.initializer);
      if (ts.isIdentifier(initializer) || ts.isPropertyAccessExpression(initializer)) {
        const aliasedDefinition = resolveDefinition(
          checker.getSymbolAtLocation(initializer),
          checker,
          definitionsBySymbol,
          definitionsByDeclaration,
          nextVisited,
        );
        if (aliasedDefinition) return aliasedDefinition;
      }
    }
  }
  return undefined;
}

function leftmostIdentifier(expression: ts.Expression | ts.JsxTagNameExpression): ts.Identifier | undefined {
  if (ts.isIdentifier(expression)) return expression;
  if (ts.isPropertyAccessExpression(expression)) return leftmostIdentifier(expression.expression);
  if (ts.isJsxNamespacedName(expression)) return leftmostIdentifier(expression.namespace);
  return undefined;
}

function externalPackageName(moduleSpecifier: string): string | undefined {
  if (moduleSpecifier.startsWith(".") || moduleSpecifier.startsWith("/") || moduleSpecifier.startsWith("#")) {
    return undefined;
  }
  if (moduleSpecifier.startsWith("@")) return moduleSpecifier.split("/").slice(0, 2).join("/");
  return moduleSpecifier.split("/").at(0);
}

function externalPackageNameFromFile(fileName: string): string | undefined {
  const normalized = toPosixPath(fileName);
  const marker = "/node_modules/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  const modulePath = normalized.slice(markerIndex + marker.length);
  if (modulePath.startsWith("@")) return modulePath.split("/").slice(0, 2).join("/");
  const packageName = modulePath.split("/").at(0);
  return packageName && !packageName.startsWith(".") ? packageName : undefined;
}

function hasExternalDeclaration(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): boolean {
  const canonical = canonicalSymbol(symbol, checker);
  return (canonical?.declarations ?? symbol?.declarations ?? []).some((declaration) =>
    externalPackageNameFromFile(declaration.getSourceFile().fileName),
  );
}

function isReactSymbol(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): boolean {
  if (getImportModuleSpecifier(symbol) === "react") return true;
  const canonical = canonicalSymbol(symbol, checker);
  return (canonical?.declarations ?? symbol?.declarations ?? []).some((declaration) => {
    const fileName = toPosixPath(declaration.getSourceFile().fileName);
    return fileName.includes("/node_modules/react/") || fileName.includes("/node_modules/@types/react/");
  });
}

function declarationName(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): string | undefined {
  const canonical = canonicalSymbol(symbol, checker);
  for (const declaration of canonical?.declarations ?? []) {
    if (
      (ts.isClassDeclaration(declaration) ||
        ts.isFunctionDeclaration(declaration) ||
        ts.isVariableDeclaration(declaration)) &&
      declaration.name &&
      ts.isIdentifier(declaration.name)
    ) {
      return declaration.name.text;
    }
  }
  return canonical && canonical.name !== "default" && !canonical.name.startsWith('"') ? canonical.name : undefined;
}

type ModuleBinding = Readonly<{
  moduleSpecifier: string;
  importedName: string;
}>;

type ExternalSymbolOrigin = Readonly<{
  packageName: string;
  importedName?: string;
  symbol: ts.Symbol;
}>;

type ExternalReference = Readonly<{
  packageName: string;
  title: string;
}>;

function moduleBinding(symbol: ts.Symbol): ModuleBinding | undefined {
  for (const declaration of symbol.declarations ?? []) {
    const candidate = ts.isImportSpecifier(declaration)
      ? declaration.parent.parent.parent
      : ts.isNamespaceImport(declaration)
        ? declaration.parent.parent
        : ts.isImportClause(declaration)
          ? declaration.parent
          : ts.isExportSpecifier(declaration)
            ? declaration.parent.parent
            : ts.isNamespaceExport(declaration)
              ? declaration.parent
              : undefined;
    if (
      !candidate ||
      (!ts.isImportDeclaration(candidate) && !ts.isExportDeclaration(candidate)) ||
      !candidate.moduleSpecifier ||
      !ts.isStringLiteral(candidate.moduleSpecifier)
    ) {
      continue;
    }

    const importedName =
      ts.isImportSpecifier(declaration) || ts.isExportSpecifier(declaration)
        ? (declaration.propertyName ?? declaration.name).text
        : ts.isImportClause(declaration)
          ? "default"
          : "*";
    return { moduleSpecifier: candidate.moduleSpecifier.text, importedName };
  }
  return undefined;
}

function symbolAliasChain(symbol: ts.Symbol, checker: ts.TypeChecker): readonly ts.Symbol[] {
  const chain: ts.Symbol[] = [];
  const visited = new Set<ts.Symbol>();
  let current: ts.Symbol | undefined = symbol;
  while (current && !visited.has(current)) {
    chain.push(current);
    visited.add(current);
    current = (current.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getImmediateAliasedSymbol(current) : undefined;
  }
  return chain;
}

function externalPackageForSymbol(symbol: ts.Symbol, checker: ts.TypeChecker): string | undefined {
  const canonical = canonicalSymbol(symbol, checker);
  for (const declaration of canonical?.declarations ?? symbol.declarations ?? []) {
    const packageName = externalPackageNameFromFile(declaration.getSourceFile().fileName);
    if (packageName) return packageName;
  }
  return undefined;
}

function externalSymbolOrigin(symbol: ts.Symbol, checker: ts.TypeChecker): ExternalSymbolOrigin | undefined {
  const chain = symbolAliasChain(symbol, checker);
  const externalSymbol = chain.at(-1);
  if (!externalSymbol || !hasExternalDeclaration(externalSymbol, checker)) return undefined;

  for (const candidate of chain) {
    const binding = moduleBinding(candidate);
    const packageName = binding ? externalPackageName(binding.moduleSpecifier) : undefined;
    if (packageName) {
      return { packageName, importedName: binding.importedName, symbol: externalSymbol };
    }
  }

  const packageName = externalPackageForSymbol(externalSymbol, checker);
  return packageName ? { packageName, symbol: externalSymbol } : undefined;
}

function externalReferenceSuffix(expression: ts.Expression | ts.JsxTagNameExpression): string {
  const localRoot = leftmostIdentifier(expression);
  const sourceText = expression.getText();
  return localRoot && sourceText.startsWith(localRoot.text) ? sourceText.slice(localRoot.text.length) : "";
}

function resolveExternalReference(
  expression: ts.Expression | ts.JsxTagNameExpression,
  context: AnalysisContext,
  symbolOverride?: ts.Symbol,
  visitedSymbols: ReadonlySet<ts.Symbol> = new Set(),
): ExternalReference | undefined {
  const candidate = ts.isJsxNamespacedName(expression) ? expression : unwrapExpression(expression);
  const localRoot = leftmostIdentifier(candidate);
  const symbol = symbolOverride ?? (localRoot ? context.checker.getSymbolAtLocation(localRoot) : undefined);
  if (!symbol || visitedSymbols.has(symbol)) return undefined;
  const suffix = externalReferenceSuffix(candidate);
  const origin = externalSymbolOrigin(symbol, context.checker);
  if (origin) {
    const canonicalName = declarationName(origin.symbol, context.checker);
    const rootName =
      origin.importedName === "*"
        ? undefined
        : origin.importedName === "default"
          ? (canonicalName ?? "default")
          : (origin.importedName ?? canonicalName);
    const title = rootName
      ? `${rootName}${suffix}`
      : suffix.startsWith(".")
        ? suffix.slice(1)
        : (canonicalName ?? candidate.getText());
    return { packageName: origin.packageName, title };
  }

  if (!localRoot) return undefined;
  const reference = localVariableReference(localRoot, context, visitedSymbols, symbol);
  if (!reference) return undefined;
  const resolved = new Map<string, ExternalReference>();
  for (const initializer of reference.initializers) {
    const target = resolveExternalReference(initializer, context, undefined, reference.visitedSymbols);
    if (!target) continue;
    const next = { ...target, title: `${target.title}${suffix}` };
    resolved.set(`${next.packageName}\0${next.title}`, next);
  }
  return resolved.size === 1 ? [...resolved.values()].at(0) : undefined;
}

function isIntrinsicJsxTag(tagName: ts.JsxTagNameExpression): boolean {
  return ts.isIdentifier(tagName) && /^[a-z]/.test(tagName.text);
}

function targetForReference(
  expression: ts.Expression | ts.JsxTagNameExpression,
  context: AnalysisContext,
  symbolOverride?: ts.Symbol,
): ComponentTarget | undefined {
  const checker = context.checker;
  const symbol = symbolOverride ?? checker.getSymbolAtLocation(expression);
  const definition = resolveDefinition(symbol, checker, context.definitionsBySymbol, context.definitionsByDeclaration);
  if (definition) return { id: definition.id, title: definition.name, definition };

  const external = resolveExternalReference(expression, context, symbolOverride);
  if (!external) return undefined;
  if (external.packageName === "react" && /(?:^|\.)Fragment$/.test(external.title)) return undefined;
  const key = `${external.packageName}\0${external.title}`;
  const existing = context.externalTargets.get(key);
  if (existing) return existing;
  const target = {
    id: `external:${external.packageName}#${external.title}`,
    title: external.title,
    externalPackage: external.packageName,
  } satisfies ComponentTarget;
  context.externalTargets.set(key, target);
  return target;
}

function componentUseId(ownerId: string, node: ts.Node, targetId: string): string {
  return [ownerId, toPosixPath(node.getSourceFile().fileName), node.pos, node.end, targetId].join("\0");
}

function ensureComponentUse(
  ownerId: string,
  node: ts.Node,
  target: ComponentTarget,
  context: AnalysisContext,
): ComponentUse {
  const id = componentUseId(ownerId, node, target.id);
  const existing = context.uses.get(id);
  if (existing) return existing;
  const use = { id, ownerId, target, suppliedValues: [] } satisfies ComponentUse;
  context.uses.set(id, use);
  return use;
}

function addDirectUse(context: AnalysisContext, use: ComponentUse): void {
  const existing = context.directUseIdsByOwner.get(use.ownerId) ?? [];
  if (!existing.includes(use.id)) existing.push(use.id);
  context.directUseIdsByOwner.set(use.ownerId, existing);
}

function symbolForBindingName(name: ts.BindingName, checker: ts.TypeChecker): ts.Symbol | undefined {
  return ts.isIdentifier(name) ? checker.getSymbolAtLocation(name) : undefined;
}

function isThisPropsExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  return (
    ts.isPropertyAccessExpression(unwrapped) &&
    unwrapped.name.text === "props" &&
    unwrapped.expression.kind === ts.SyntaxKind.ThisKeyword
  );
}

function createPropBindings(definition: ComponentDefinition, checker: ts.TypeChecker): PropBindings {
  const propsObjects = new Set<ts.Symbol>();
  const restObjects = new Map<ts.Symbol, ReadonlySet<string>>();
  const propSymbols = new Map<ts.Symbol, string>();

  function addObjectBinding(pattern: ts.ObjectBindingPattern, inheritedExclusions: ReadonlySet<string>): void {
    const excluded = new Set(inheritedExclusions);
    for (const element of pattern.elements) {
      if (element.dotDotDotToken) {
        const restSymbol = symbolForBindingName(element.name, checker);
        if (restSymbol) restObjects.set(restSymbol, new Set(excluded));
        continue;
      }
      const propName = element.propertyName?.getText() ?? element.name.getText();
      excluded.add(propName);
      const symbol = symbolForBindingName(element.name, checker);
      if (symbol) propSymbols.set(symbol, propName);
    }
  }

  const firstParameter = definition.parameters.at(0);
  if (firstParameter) {
    if (ts.isIdentifier(firstParameter.name)) {
      const symbol = checker.getSymbolAtLocation(firstParameter.name);
      if (symbol) propsObjects.add(symbol);
    } else if (ts.isObjectBindingPattern(firstParameter.name)) {
      addObjectBinding(firstParameter.name, new Set());
    }
  }

  function sourceExclusions(expression: ts.Expression): ReadonlySet<string> | undefined {
    const unwrapped = unwrapExpression(expression);
    if (isThisPropsExpression(unwrapped)) return new Set();
    if (!ts.isIdentifier(unwrapped)) return undefined;
    const symbol = checker.getSymbolAtLocation(unwrapped);
    if (!symbol) return undefined;
    if (propsObjects.has(symbol)) return new Set();
    return restObjects.get(symbol);
  }

  function incomingProp(expression: ts.Expression): string | undefined {
    const unwrapped = unwrapExpression(expression);
    if (ts.isIdentifier(unwrapped)) {
      const symbol = checker.getSymbolAtLocation(unwrapped);
      return symbol ? propSymbols.get(symbol) : undefined;
    }
    if (ts.isPropertyAccessExpression(unwrapped)) {
      const baseExclusions = sourceExclusions(unwrapped.expression);
      if (baseExclusions && !baseExclusions.has(unwrapped.name.text)) return unwrapped.name.text;
    }
    if (
      ts.isElementAccessExpression(unwrapped) &&
      unwrapped.argumentExpression &&
      ts.isStringLiteralLike(unwrapped.argumentExpression)
    ) {
      const baseExclusions = sourceExclusions(unwrapped.expression);
      if (baseExclusions && !baseExclusions.has(unwrapped.argumentExpression.text)) {
        return unwrapped.argumentExpression.text;
      }
    }
    return undefined;
  }

  if (definition.body && ts.isBlock(definition.body)) {
    function visit(node: ts.Node): void {
      if (node !== definition.body && (ts.isFunctionLike(node) || ts.isClassLike(node))) return;
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const exclusions = sourceExclusions(node.initializer);
        if (ts.isObjectBindingPattern(node.name) && exclusions) {
          addObjectBinding(node.name, exclusions);
        } else if (ts.isIdentifier(node.name)) {
          const targetSymbol = checker.getSymbolAtLocation(node.name);
          const propName = incomingProp(node.initializer);
          if (targetSymbol && propName) propSymbols.set(targetSymbol, propName);
          if (targetSymbol && exclusions) {
            if (exclusions.size === 0) propsObjects.add(targetSymbol);
            else restObjects.set(targetSymbol, exclusions);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(definition.body);
  }

  return { propsObjects, restObjects, propSymbols, classComponent: definition.classComponent };
}

function getIncomingProp(
  expression: ts.Expression,
  bindings: PropBindings,
  checker: ts.TypeChecker,
): string | undefined {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    const symbol = checker.getSymbolAtLocation(unwrapped);
    return symbol ? bindings.propSymbols.get(symbol) : undefined;
  }

  function exclusionsFor(source: ts.Expression): ReadonlySet<string> | undefined {
    const candidate = unwrapExpression(source);
    if (bindings.classComponent && isThisPropsExpression(candidate)) return new Set();
    if (!ts.isIdentifier(candidate)) return undefined;
    const symbol = checker.getSymbolAtLocation(candidate);
    if (!symbol) return undefined;
    if (bindings.propsObjects.has(symbol)) return new Set();
    return bindings.restObjects.get(symbol);
  }

  if (ts.isPropertyAccessExpression(unwrapped)) {
    const exclusions = exclusionsFor(unwrapped.expression);
    if (exclusions && !exclusions.has(unwrapped.name.text)) return unwrapped.name.text;
  }
  if (
    ts.isElementAccessExpression(unwrapped) &&
    unwrapped.argumentExpression &&
    ts.isStringLiteralLike(unwrapped.argumentExpression)
  ) {
    const exclusions = exclusionsFor(unwrapped.expression);
    if (exclusions && !exclusions.has(unwrapped.argumentExpression.text)) return unwrapped.argumentExpression.text;
  }
  return undefined;
}

function getSpreadExclusions(
  expression: ts.Expression,
  bindings: PropBindings,
  checker: ts.TypeChecker,
): ReadonlySet<string> | undefined {
  const unwrapped = unwrapExpression(expression);
  if (bindings.classComponent && isThisPropsExpression(unwrapped)) return new Set();
  if (!ts.isIdentifier(unwrapped)) return undefined;
  const symbol = checker.getSymbolAtLocation(unwrapped);
  if (!symbol) return undefined;
  if (bindings.propsObjects.has(symbol)) return new Set();
  return bindings.restObjects.get(symbol);
}

function addExactRule(rules: ConsumerRules, propName: string, rule: ConsumerRule): void {
  const existing = rules.exact.get(propName) ?? [];
  const key = JSON.stringify(rule);
  if (!existing.some((candidate) => JSON.stringify(candidate) === key)) existing.push(rule);
  rules.exact.set(propName, existing);
}

function jsxAttributeExpression(attribute: ts.JsxAttribute): ts.Expression | undefined {
  if (!attribute.initializer) return undefined;
  if (ts.isJsxExpression(attribute.initializer)) return attribute.initializer.expression;
  if (ts.isJsxElement(attribute.initializer) || ts.isJsxSelfClosingElement(attribute.initializer)) {
    return attribute.initializer;
  }
  return undefined;
}

function isEffectiveJsxChild(child: ts.JsxChild): boolean {
  if (ts.isJsxText(child)) return !child.containsOnlyTriviaWhiteSpaces;
  if (ts.isJsxExpression(child)) return !!child.expression;
  return true;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isPrivateIdentifier(name) ||
    ts.isStringLiteralLike(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  return undefined;
}

type StaticObjectPropertyValue = Readonly<{
  propName: string;
  value: ts.Expression;
  valueSymbol?: ts.Symbol;
}>;

function localVariableReference(
  expression: ts.Expression,
  context: AnalysisContext,
  visitedSymbols: ReadonlySet<ts.Symbol>,
  symbolOverride?: ts.Symbol,
): Readonly<{ initializers: readonly ts.Expression[]; visitedSymbols: ReadonlySet<ts.Symbol> }> | undefined {
  const unwrapped = unwrapExpression(expression);
  if (!symbolOverride && !ts.isIdentifier(unwrapped) && !ts.isPropertyAccessExpression(unwrapped)) return undefined;
  const symbol = canonicalSymbol(symbolOverride ?? context.checker.getSymbolAtLocation(unwrapped), context.checker);
  if (!symbol || visitedSymbols.has(symbol)) return undefined;
  if (resolveDefinition(symbol, context.checker, context.definitionsBySymbol, context.definitionsByDeclaration)) {
    return undefined;
  }
  const initializers = (symbol.declarations ?? []).flatMap((declaration) => {
    if (
      !ts.isVariableDeclaration(declaration) ||
      !declaration.initializer ||
      !ts.isVariableDeclarationList(declaration.parent) ||
      (declaration.parent.flags & ts.NodeFlags.Const) === 0 ||
      toPosixPath(declaration.getSourceFile().fileName).includes("/node_modules/")
    ) {
      return [];
    }
    return [declaration.initializer];
  });
  if (initializers.length === 0) return undefined;
  return { initializers, visitedSymbols: new Set(visitedSymbols).add(symbol) };
}

function resolveAliasedValues(
  expression: ts.Expression,
  context: AnalysisContext,
  visitedSymbols: ReadonlySet<ts.Symbol> = new Set(),
  symbolOverride?: ts.Symbol,
): readonly ts.Expression[] {
  const unwrapped = unwrapExpression(expression);
  const property = symbolOverride ? undefined : staticObjectPropertyValue(unwrapped, context, visitedSymbols);
  if (property) {
    return resolveAliasedValues(property.value, context, visitedSymbols, property.valueSymbol);
  }
  const reference = localVariableReference(unwrapped, context, visitedSymbols, symbolOverride);
  if (!reference) return [unwrapped];
  return reference.initializers.flatMap((initializer) =>
    resolveAliasedValues(initializer, context, reference.visitedSymbols),
  );
}

type StaticObjectProperties = Readonly<{
  hasUnknownSpread: boolean;
  values: ReadonlyMap<string, StaticObjectPropertyValue>;
}>;

function collectStaticObjectProperties(
  expression: ts.Expression,
  context: AnalysisContext,
  visitedSymbols: ReadonlySet<ts.Symbol> = new Set(),
): StaticObjectProperties {
  const unwrapped = unwrapExpression(expression);
  if (ts.isObjectLiteralExpression(unwrapped)) {
    const values = new Map<string, StaticObjectPropertyValue>();
    let hasUnknownSpread = false;
    for (const property of unwrapped.properties) {
      if (ts.isPropertyAssignment(property)) {
        const propName = propertyNameText(property.name);
        if (propName) values.set(propName, { propName, value: property.initializer });
      } else if (ts.isShorthandPropertyAssignment(property)) {
        const propName = propertyNameText(property.name);
        if (propName) {
          values.set(propName, {
            propName,
            value: property.name,
            valueSymbol: context.checker.getShorthandAssignmentValueSymbol(property),
          });
        }
      } else if (ts.isSpreadAssignment(property)) {
        const spread = collectStaticObjectProperties(property.expression, context, visitedSymbols);
        if (spread.hasUnknownSpread) {
          values.clear();
          hasUnknownSpread = true;
        }
        for (const [propName, value] of spread.values) values.set(propName, value);
      }
    }
    return { hasUnknownSpread, values };
  }
  const reference = localVariableReference(unwrapped, context, visitedSymbols);
  if (!reference) return { hasUnknownSpread: true, values: new Map() };

  const values = new Map<string, StaticObjectPropertyValue>();
  let hasUnknownSpread = false;
  for (const initializer of reference.initializers) {
    const resolved = collectStaticObjectProperties(initializer, context, reference.visitedSymbols);
    if (resolved.hasUnknownSpread) {
      values.clear();
      hasUnknownSpread = true;
    }
    for (const [propName, value] of resolved.values) values.set(propName, value);
  }
  return { hasUnknownSpread, values };
}

function staticObjectPropertyValues(
  expression: ts.Expression,
  context: AnalysisContext,
  visitedSymbols: ReadonlySet<ts.Symbol> = new Set(),
): readonly StaticObjectPropertyValue[] {
  return [...collectStaticObjectProperties(expression, context, visitedSymbols).values.values()];
}

function staticObjectPropertyValue(
  expression: ts.Expression,
  context: AnalysisContext,
  visitedSymbols: ReadonlySet<ts.Symbol> = new Set(),
): StaticObjectPropertyValue | undefined {
  const unwrapped = unwrapExpression(expression);
  const property = ts.isPropertyAccessExpression(unwrapped)
    ? { name: unwrapped.name.text, source: unwrapped.expression }
    : ts.isElementAccessExpression(unwrapped) &&
        unwrapped.argumentExpression &&
        ts.isStringLiteralLike(unwrapped.argumentExpression)
      ? { name: unwrapped.argumentExpression.text, source: unwrapped.expression }
      : undefined;
  if (!property) return undefined;
  return staticObjectPropertyValues(property.source, context, visitedSymbols).find(
    ({ propName }) => propName === property.name,
  );
}

function analyzeConsumerRules(
  definition: ComponentDefinition,
  context: AnalysisContext,
  bindings: PropBindings,
): ConsumerRules {
  const rules: ConsumerRules = { exact: new Map(), spreads: [] };
  const mutableSpreads = rules.spreads as Array<Readonly<{ excludedProps: ReadonlySet<string>; targetUseId: string }>>;

  function terminal(propName: string, kind: TerminalRule["kind"]): void {
    addExactRule(rules, propName, { type: "terminal", kind });
  }

  function removeForwardingToProp(targetUseId: string, targetPropName: string): void {
    for (const [incomingPropName, existing] of rules.exact) {
      rules.exact.set(
        incomingPropName,
        existing.filter(
          (rule) =>
            rule.type !== "forward" || rule.targetUseId !== targetUseId || rule.targetPropName !== targetPropName,
        ),
      );
    }
    for (const [index, spread] of mutableSpreads.entries()) {
      if (spread.targetUseId !== targetUseId) continue;
      mutableSpreads[index] = {
        ...spread,
        excludedProps: new Set(spread.excludedProps).add(targetPropName),
      };
    }
  }

  function removeForwardingOverriddenBySpread(targetUseId: string, excludedProps: ReadonlySet<string>): void {
    for (const [incomingPropName, existing] of rules.exact) {
      rules.exact.set(
        incomingPropName,
        existing.filter(
          (rule) =>
            rule.type !== "forward" || rule.targetUseId !== targetUseId || excludedProps.has(rule.targetPropName),
        ),
      );
    }
  }

  function clearForwardingToTarget(targetUseId: string): void {
    for (const [incomingPropName, existing] of rules.exact) {
      rules.exact.set(
        incomingPropName,
        existing.filter((rule) => rule.type !== "forward" || rule.targetUseId !== targetUseId),
      );
    }
    for (let index = mutableSpreads.length - 1; index >= 0; index -= 1) {
      if (mutableSpreads[index]?.targetUseId === targetUseId) mutableSpreads.splice(index, 1);
    }
  }

  function collectInvokedRenderProps(expression: ts.Expression, traverseRootFunction: boolean): readonly string[] {
    const props = new Set<string>();
    function visit(node: ts.Node, isRoot: boolean): void {
      if (ts.isFunctionLike(node) && !(isRoot && traverseRootFunction)) return;
      if (ts.isCallExpression(node)) {
        const propName = getIncomingProp(node.expression, bindings, context.checker);
        if (propName) props.add(propName);
      }
      ts.forEachChild(node, (child) => visit(child, false));
    }
    visit(expression, true);
    return [...props];
  }

  function analyzeRenderPropInvocations(expression: ts.Expression): void {
    for (const propName of collectInvokedRenderProps(expression, false)) terminal(propName, "render-prop");
  }

  function collectForwardedProps(expression: ts.Expression, symbolOverride?: ts.Symbol): readonly string[] {
    const props = new Set<string>();

    function collect(
      candidate: ts.Expression,
      visitedSymbols: ReadonlySet<ts.Symbol>,
      candidateSymbol?: ts.Symbol,
    ): void {
      const unwrapped = unwrapExpression(candidate);
      const directProp = candidateSymbol
        ? bindings.propSymbols.get(candidateSymbol)
        : getIncomingProp(unwrapped, bindings, context.checker);
      if (directProp) {
        props.add(directProp);
        return;
      }
      const property = candidateSymbol ? undefined : staticObjectPropertyValue(unwrapped, context, visitedSymbols);
      if (property) {
        collect(property.value, visitedSymbols, property.valueSymbol);
        return;
      }
      if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
        for (const propName of collectInvokedRenderProps(unwrapped, true)) props.add(propName);
        return;
      }
      if (ts.isObjectLiteralExpression(unwrapped)) {
        for (const property of staticObjectPropertyValues(unwrapped, context)) {
          collect(property.value, visitedSymbols, property.valueSymbol);
        }
        return;
      }
      if (ts.isArrayLiteralExpression(unwrapped)) {
        for (const element of unwrapped.elements) {
          if (ts.isExpression(element)) collect(element, visitedSymbols);
        }
        return;
      }
      const reference = localVariableReference(unwrapped, context, visitedSymbols, candidateSymbol);
      if (!reference) return;
      for (const initializer of reference.initializers) collect(initializer, reference.visitedSymbols);
    }

    collect(expression, new Set(), symbolOverride);
    return [...props];
  }

  function collectForwardedSpreadExclusions(
    expression: ts.Expression,
    visitedSymbols: ReadonlySet<ts.Symbol> = new Set(),
  ): readonly ReadonlySet<string>[] {
    const unwrapped = unwrapExpression(expression);
    const direct = getSpreadExclusions(unwrapped, bindings, context.checker);
    if (direct) return [direct];
    if (ts.isObjectLiteralExpression(unwrapped)) {
      return unwrapped.properties.flatMap((property) =>
        ts.isSpreadAssignment(property) ? collectForwardedSpreadExclusions(property.expression, visitedSymbols) : [],
      );
    }
    const reference = localVariableReference(unwrapped, context, visitedSymbols);
    if (!reference) return [];
    return reference.initializers.flatMap((initializer) =>
      collectForwardedSpreadExclusions(initializer, reference.visitedSymbols),
    );
  }

  function analyzeJsxAttributes(
    attributes: ts.JsxAttributes,
    targetUseId: string | undefined,
    children: readonly ts.JsxChild[],
  ): void {
    for (const property of attributes.properties) {
      if (ts.isJsxAttribute(property)) {
        const targetPropName = property.name.getText();
        if (targetUseId) removeForwardingToProp(targetUseId, targetPropName);
        const expression = jsxAttributeExpression(property);
        if (!expression) continue;
        analyzeRenderPropInvocations(expression);
        if (!targetUseId) continue;
        for (const propName of new Set(collectForwardedProps(expression))) {
          addExactRule(rules, propName, {
            type: "forward",
            targetUseId,
            targetPropName,
          });
        }
      } else if (targetUseId) {
        const forwardedSpreads = collectForwardedSpreadExclusions(property.expression);
        const staticProperties = collectStaticObjectProperties(property.expression, context);
        if (forwardedSpreads.length === 0 && staticProperties.hasUnknownSpread) {
          clearForwardingToTarget(targetUseId);
        }
        for (const excludedProps of forwardedSpreads) {
          removeForwardingOverriddenBySpread(targetUseId, excludedProps);
          mutableSpreads.push({ excludedProps, targetUseId });
        }
        for (const forwarded of staticProperties.values.values()) {
          removeForwardingToProp(targetUseId, forwarded.propName);
          analyzeRenderPropInvocations(forwarded.value);
          for (const propName of collectForwardedProps(forwarded.value, forwarded.valueSymbol)) {
            addExactRule(rules, propName, {
              type: "forward",
              targetUseId,
              targetPropName: forwarded.propName,
            });
          }
        }
      }
    }

    const effectiveChildren = children.filter(isEffectiveJsxChild);
    if (targetUseId && effectiveChildren.length > 0) removeForwardingToProp(targetUseId, "children");
    for (const child of effectiveChildren) {
      if (ts.isJsxExpression(child) && child.expression) analyzeRenderPropInvocations(child.expression);
      if (!targetUseId || !ts.isJsxExpression(child) || !child.expression) continue;
      for (const propName of new Set(collectForwardedProps(child.expression))) {
        addExactRule(rules, propName, { type: "forward", targetUseId, targetPropName: "children" });
      }
    }
  }

  function analyzeRendered(expression: ts.Expression): void {
    const unwrapped = unwrapExpression(expression);
    const directProp = getIncomingProp(unwrapped, bindings, context.checker);
    if (directProp) {
      terminal(directProp, "node-prop");
      return;
    }

    if (ts.isCallExpression(unwrapped)) {
      const invokedProp = getIncomingProp(unwrapped.expression, bindings, context.checker);
      if (invokedProp) {
        terminal(invokedProp, "render-prop");
        return;
      }
      if (isCreateElementCall(unwrapped, context.checker)) {
        analyzeCreateElement(unwrapped);
        return;
      }
      if (isArrayRenderingMethodCall(unwrapped, context.checker)) {
        for (const argument of unwrapped.arguments) {
          if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
            for (const returned of collectReturnExpressions(argument.body)) analyzeRendered(returned);
          }
        }
      }
      return;
    }

    if (ts.isJsxFragment(unwrapped)) {
      for (const child of unwrapped.children) analyzeJsxChild(child);
      return;
    }

    if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped)) {
      const opening = ts.isJsxElement(unwrapped) ? unwrapped.openingElement : unwrapped;
      const componentProp = getIncomingProp(opening.tagName as ts.Expression, bindings, context.checker);
      if (componentProp) {
        terminal(componentProp, "component-prop");
        return;
      }
      if (isIntrinsicJsxTag(opening.tagName)) {
        if (ts.isJsxElement(unwrapped)) for (const child of unwrapped.children) analyzeJsxChild(child);
        return;
      }
      const target = targetForReference(opening.tagName, context);
      const targetUseId = target ? componentUseId(definition.id, unwrapped, target.id) : undefined;
      analyzeJsxAttributes(opening.attributes, targetUseId, ts.isJsxElement(unwrapped) ? unwrapped.children : []);
      return;
    }

    if (ts.isConditionalExpression(unwrapped)) {
      analyzeRendered(unwrapped.whenTrue);
      analyzeRendered(unwrapped.whenFalse);
      return;
    }
    if (ts.isBinaryExpression(unwrapped)) {
      analyzeRendered(unwrapped.right);
      return;
    }
    if (ts.isArrayLiteralExpression(unwrapped)) {
      for (const element of unwrapped.elements) {
        if (ts.isExpression(element)) analyzeRendered(element);
      }
      return;
    }
    if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
      for (const returned of collectReturnExpressions(unwrapped.body)) analyzeRendered(returned);
    }
  }

  function analyzeJsxChild(child: ts.JsxChild): void {
    if (ts.isJsxExpression(child) && child.expression) analyzeRendered(child.expression);
    else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child))
      analyzeRendered(child);
  }

  function analyzeCreateElement(call: ts.CallExpression): void {
    const [tagExpression, propsExpression, ...children] = call.arguments;
    if (!tagExpression) return;
    const componentProp = getIncomingProp(tagExpression, bindings, context.checker);
    if (componentProp) {
      terminal(componentProp, "component-prop");
      return;
    }
    if (ts.isStringLiteral(tagExpression)) {
      for (const child of children) analyzeRendered(child);
      return;
    }
    const target = targetForReference(tagExpression, context);
    const targetUseId = target ? componentUseId(definition.id, call, target.id) : undefined;
    if (propsExpression && targetUseId) {
      for (const excludedProps of collectForwardedSpreadExclusions(propsExpression)) {
        mutableSpreads.push({ excludedProps, targetUseId });
      }
      for (const forwarded of staticObjectPropertyValues(propsExpression, context)) {
        removeForwardingToProp(targetUseId, forwarded.propName);
        analyzeRenderPropInvocations(forwarded.value);
        for (const propName of collectForwardedProps(forwarded.value, forwarded.valueSymbol)) {
          addExactRule(rules, propName, {
            type: "forward",
            targetUseId,
            targetPropName: forwarded.propName,
          });
        }
      }
    }
    if (targetUseId && children.length > 0) removeForwardingToProp(targetUseId, "children");
    for (const child of children) {
      analyzeRenderPropInvocations(child);
      if (!targetUseId) continue;
      for (const propName of collectForwardedProps(child)) {
        addExactRule(rules, propName, { type: "forward", targetUseId, targetPropName: "children" });
      }
    }
  }

  for (const root of definition.renderRoots) analyzeRendered(root);
  return rules;
}

function relationshipKey(relationship: Relationship): string {
  return [
    relationship.source,
    relationship.target,
    relationship.kind,
    relationship.kind === "direct-render" ? "" : relationship.propName,
  ].join("\0");
}

function returnedUses(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  ownerId: string,
  context: AnalysisContext,
): readonly ComponentUse[] {
  return collectSuppliedUses(collectReturnExpressions(callback.body), ownerId, context);
}

function collectSuppliedUses(
  expressions: readonly ts.Expression[],
  ownerId: string,
  context: AnalysisContext,
): readonly ComponentUse[] {
  const uses = new Map<string, ComponentUse>();

  function collect(expression: ts.Expression, visitedSymbols: ReadonlySet<ts.Symbol> = new Set()): void {
    const unwrapped = unwrapExpression(expression);
    if (ts.isJsxFragment(unwrapped)) {
      for (const child of unwrapped.children) collectChild(child);
      return;
    }
    if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped)) {
      const opening = ts.isJsxElement(unwrapped) ? unwrapped.openingElement : unwrapped;
      if (isIntrinsicJsxTag(opening.tagName)) {
        if (ts.isJsxElement(unwrapped)) for (const child of unwrapped.children) collectChild(child);
        return;
      }
      const target = targetForReference(opening.tagName, context);
      if (target) {
        const use = ensureComponentUse(ownerId, unwrapped, target, context);
        analyzeJsxComponentUsage(unwrapped, use, context);
        uses.set(use.id, use);
      }
      return;
    }
    if (ts.isCallExpression(unwrapped) && isCreateElementCall(unwrapped, context.checker)) {
      const [tagExpression] = unwrapped.arguments;
      if (!tagExpression) return;
      if (ts.isStringLiteral(tagExpression)) {
        for (const child of unwrapped.arguments.slice(2)) collect(child);
        return;
      }
      const target = targetForReference(tagExpression, context);
      if (target) {
        const use = ensureComponentUse(ownerId, unwrapped, target, context);
        analyzeCreateElementUsage(unwrapped, use, context);
        uses.set(use.id, use);
      }
      return;
    }
    if (ts.isConditionalExpression(unwrapped)) {
      collect(unwrapped.whenTrue);
      collect(unwrapped.whenFalse);
      return;
    }
    if (ts.isBinaryExpression(unwrapped)) {
      collect(unwrapped.right);
      return;
    }
    if (ts.isArrayLiteralExpression(unwrapped)) {
      for (const element of unwrapped.elements) if (ts.isExpression(element)) collect(element, visitedSymbols);
      return;
    }
    const reference = localVariableReference(unwrapped, context, visitedSymbols);
    if (!reference) return;
    for (const initializer of reference.initializers) collect(initializer, reference.visitedSymbols);
  }

  function collectChild(child: ts.JsxChild): void {
    if (ts.isJsxExpression(child) && child.expression) collect(child.expression);
    else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) collect(child);
  }

  for (const expression of expressions) collect(expression);
  return [...uses.values()].toSorted((left, right) => left.id.localeCompare(right.id));
}

function componentReferenceUses(
  expression: ts.Expression,
  ownerId: string,
  context: AnalysisContext,
  symbolOverride?: ts.Symbol,
): readonly ComponentUse[] {
  const uses = new Map<string, ComponentUse>();

  function collect(
    candidate: ts.Expression,
    visitedSymbols: ReadonlySet<ts.Symbol>,
    candidateSymbol?: ts.Symbol,
  ): void {
    const unwrapped = unwrapExpression(candidate);
    if (ts.isObjectLiteralExpression(unwrapped)) {
      for (const property of unwrapped.properties) {
        if (ts.isPropertyAssignment(property)) collect(property.initializer, visitedSymbols);
        else if (ts.isShorthandPropertyAssignment(property)) {
          collect(property.name, visitedSymbols, context.checker.getShorthandAssignmentValueSymbol(property));
        } else if (ts.isSpreadAssignment(property)) collect(property.expression, visitedSymbols);
      }
      return;
    }
    if (ts.isArrayLiteralExpression(unwrapped)) {
      for (const element of unwrapped.elements) {
        if (ts.isExpression(element)) collect(element, visitedSymbols);
      }
      return;
    }
    if (!candidateSymbol && !ts.isIdentifier(unwrapped) && !ts.isPropertyAccessExpression(unwrapped)) return;

    const property = candidateSymbol ? undefined : staticObjectPropertyValue(unwrapped, context, visitedSymbols);
    if (property) {
      collect(property.value, visitedSymbols, property.valueSymbol);
      return;
    }

    const definition = resolveDefinition(
      candidateSymbol ?? context.checker.getSymbolAtLocation(unwrapped),
      context.checker,
      context.definitionsBySymbol,
      context.definitionsByDeclaration,
    );
    const target = definition
      ? { id: definition.id, title: definition.name, definition }
      : targetForReference(unwrapped, context, candidateSymbol);
    const valueSymbol = canonicalSymbol(
      candidateSymbol ?? context.checker.getSymbolAtLocation(unwrapped),
      context.checker,
    );
    const valueType = valueSymbol
      ? context.checker.getTypeOfSymbolAtLocation(valueSymbol, unwrapped)
      : context.checker.getTypeAtLocation(unwrapped);
    const callable = valueType.getCallSignatures().length + valueType.getConstructSignatures().length > 0;
    const externalName = target?.title.split(".").at(-1);
    if (target && (target.definition || (callable && !!externalName && /^[A-Z]/.test(externalName)))) {
      const use = ensureComponentUse(ownerId, unwrapped, target, context);
      uses.set(use.id, use);
      return;
    }

    const reference = localVariableReference(unwrapped, context, visitedSymbols, candidateSymbol);
    if (!reference) return;
    for (const initializer of reference.initializers) collect(initializer, reference.visitedSymbols);
  }

  collect(expression, new Set(), symbolOverride);
  return [...uses.values()].toSorted((left, right) => left.id.localeCompare(right.id));
}

function addSuppliedValue(
  receiver: ComponentUse,
  propName: string,
  kind: SuppliedValueKind,
  targets: readonly ComponentUse[],
): void {
  if (targets.length === 0) return;
  receiver.suppliedValues.push({
    propName,
    kind,
    targetUseIds: [...new Set(targets.map(({ id }) => id))].toSorted(),
  });
}

function analyzeSuppliedValue(
  receiver: ComponentUse,
  propName: string,
  expression: ts.Expression,
  context: AnalysisContext,
  symbolOverride?: ts.Symbol,
): void {
  const componentUses = componentReferenceUses(expression, receiver.ownerId, context, symbolOverride);
  if (componentUses.length > 0) {
    addSuppliedValue(receiver, propName, "component-prop", componentUses);
    return;
  }

  const values = resolveAliasedValues(expression, context, new Set(), symbolOverride);
  const renderUses = new Map<string, ComponentUse>();
  for (const value of values) {
    if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) continue;
    for (const use of returnedUses(value, receiver.ownerId, context)) renderUses.set(use.id, use);
  }
  if (renderUses.size > 0) {
    addSuppliedValue(receiver, propName, "render-prop", [...renderUses.values()]);
    return;
  }

  addSuppliedValue(receiver, propName, "node-prop", collectSuppliedUses(values, receiver.ownerId, context));
}

function analyzeJsxComponentUsage(
  element: ts.JsxElement | ts.JsxSelfClosingElement,
  receiver: ComponentUse,
  context: AnalysisContext,
): void {
  if (context.analyzedUseIds.has(receiver.id)) return;
  context.analyzedUseIds.add(receiver.id);

  const opening = ts.isJsxElement(element) ? element.openingElement : element;
  const valuesByProp = new Map<string, StaticObjectPropertyValue>();
  for (const property of opening.attributes.properties) {
    if (ts.isJsxAttribute(property)) {
      const expression = jsxAttributeExpression(property);
      if (expression)
        valuesByProp.set(property.name.getText(), { propName: property.name.getText(), value: expression });
      continue;
    }
    for (const value of staticObjectPropertyValues(property.expression, context)) {
      valuesByProp.set(value.propName, value);
    }
  }
  for (const { propName, value, valueSymbol } of valuesByProp.values()) {
    analyzeSuppliedValue(receiver, propName, value, context, valueSymbol);
  }

  if (ts.isJsxElement(element)) {
    for (const child of element.children) {
      const expression = ts.isJsxExpression(child)
        ? child.expression
        : ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)
          ? child
          : undefined;
      if (expression) analyzeSuppliedValue(receiver, "children", expression, context);
    }
  }
}

function analyzeCreateElementUsage(call: ts.CallExpression, receiver: ComponentUse, context: AnalysisContext): void {
  if (context.analyzedUseIds.has(receiver.id)) return;
  context.analyzedUseIds.add(receiver.id);

  const [, propsExpression, ...children] = call.arguments;
  if (propsExpression) {
    for (const { propName, value, valueSymbol } of staticObjectPropertyValues(propsExpression, context)) {
      analyzeSuppliedValue(receiver, propName, value, context, valueSymbol);
    }
  }
  for (const child of children) analyzeSuppliedValue(receiver, "children", child, context);
}

function analyzeDefinitionUsages(definition: ComponentDefinition, context: AnalysisContext): void {
  function analyzeRendered(expression: ts.Expression): void {
    const unwrapped = unwrapExpression(expression);
    if (ts.isJsxFragment(unwrapped)) {
      for (const child of unwrapped.children) analyzeChild(child);
      return;
    }
    if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped)) {
      const opening = ts.isJsxElement(unwrapped) ? unwrapped.openingElement : unwrapped;
      if (isIntrinsicJsxTag(opening.tagName)) {
        if (ts.isJsxElement(unwrapped)) for (const child of unwrapped.children) analyzeChild(child);
        return;
      }
      const target = targetForReference(opening.tagName, context);
      if (!target) return;
      const use = ensureComponentUse(definition.id, unwrapped, target, context);
      addDirectUse(context, use);
      analyzeJsxComponentUsage(unwrapped, use, context);
      return;
    }
    if (ts.isCallExpression(unwrapped) && isCreateElementCall(unwrapped, context.checker)) {
      const [tagExpression] = unwrapped.arguments;
      if (!tagExpression) return;
      if (ts.isStringLiteral(tagExpression)) {
        for (const child of unwrapped.arguments.slice(2)) analyzeRendered(child);
        return;
      }
      const target = targetForReference(tagExpression, context);
      if (!target) return;
      const use = ensureComponentUse(definition.id, unwrapped, target, context);
      addDirectUse(context, use);
      analyzeCreateElementUsage(unwrapped, use, context);
      return;
    }
    if (ts.isConditionalExpression(unwrapped)) {
      analyzeRendered(unwrapped.whenTrue);
      analyzeRendered(unwrapped.whenFalse);
      return;
    }
    if (ts.isBinaryExpression(unwrapped)) {
      analyzeRendered(unwrapped.right);
      return;
    }
    if (ts.isArrayLiteralExpression(unwrapped)) {
      for (const element of unwrapped.elements) if (ts.isExpression(element)) analyzeRendered(element);
      return;
    }
    if (ts.isCallExpression(unwrapped) && isArrayRenderingMethodCall(unwrapped, context.checker)) {
      for (const argument of unwrapped.arguments) {
        if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
          for (const returned of collectReturnExpressions(argument.body)) analyzeRendered(returned);
        }
      }
    }
  }

  function analyzeChild(child: ts.JsxChild): void {
    if (ts.isJsxExpression(child) && child.expression) analyzeRendered(child.expression);
    else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      analyzeRendered(child);
    }
  }

  for (const root of definition.renderRoots) analyzeRendered(root);
}

function resolveConsumerRoutes(
  receiverUse: ComponentUse,
  propName: string,
  kind: SuppliedValueKind,
  rulesByComponentId: ReadonlyMap<string, ConsumerRules>,
  context: AnalysisContext,
  visited: ReadonlySet<string> = new Set(),
): readonly ConsumerRoute[] {
  const visitKey = `${receiverUse.id}\0${propName}\0${kind}`;
  if (visited.has(visitKey)) return [];
  const nextVisited = new Set(visited).add(visitKey);
  const step = { useId: receiverUse.id, componentId: receiverUse.target.id, propName } satisfies ConsumerRouteStep;
  const rules = rulesByComponentId.get(receiverUse.target.id);
  if (!rules) {
    if (kind === "render-prop" && /^on[A-Z]/.test(propName)) return [];
    return [{ kind, steps: [step] }];
  }
  const candidates = [
    ...(rules.exact.get(propName) ?? []),
    ...rules.spreads
      .filter(({ excludedProps }) => !excludedProps.has(propName))
      .map(({ targetUseId }): ForwardRule => ({ type: "forward", targetUseId, targetPropName: propName })),
  ];
  const routes = new Map<string, ConsumerRoute>();

  for (const rule of candidates) {
    if (rule.type === "terminal") {
      if (rule.kind === kind) {
        const route = { kind, steps: [step] } satisfies ConsumerRoute;
        routes.set(JSON.stringify(route), route);
      }
      continue;
    }
    const targetUse = context.uses.get(rule.targetUseId);
    if (!targetUse) continue;
    for (const downstream of resolveConsumerRoutes(
      targetUse,
      rule.targetPropName,
      kind,
      rulesByComponentId,
      context,
      nextVisited,
    )) {
      const route = { kind, steps: [step, ...downstream.steps] } satisfies ConsumerRoute;
      routes.set(JSON.stringify(route), route);
    }
  }

  return [...routes.values()];
}

function relationshipKindLabel(relationship: Relationship): string {
  if (relationship.kind === "direct-render") return relationship.kind;
  const category =
    relationship.kind === "node-prop" ? "NODE" : relationship.kind === "render-prop" ? "RENDER" : "COMPONENT";
  return `${category} (${relationship.propName})`;
}

function relationshipLabel(
  relationship: Relationship,
  definitionsById: ReadonlyMap<string, ComponentDefinition>,
): string | undefined {
  if (relationship.kind === "direct-render") return undefined;
  const supplierNames = relationship.supplierIds
    .map((supplierId) => definitionsById.get(supplierId)?.name ?? supplierId)
    .toSorted();
  return `from ${supplierNames.join(", ")}`;
}

function edgeId(relationship: Relationship): string {
  return `edge:${createHash("sha256").update(relationshipKey(relationship)).digest("hex").slice(0, 16)}`;
}

function sourceHref(relativePath: string): string {
  return `source:///${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function matchesComponentPattern(id: string, title: string, patterns: readonly string[]): boolean {
  return matchesAny(title, patterns) || matchesAny(id, patterns);
}

function createVisibilityByTarget(
  definitions: readonly ComponentDefinition[],
  externalTargets: ReadonlyMap<string, ComponentTarget>,
  excludeFilePatterns: readonly string[],
  excludeComponentPatterns: readonly string[],
): ReadonlyMap<string, ComponentVisibility> {
  const visibility = new Map<string, ComponentVisibility>();
  for (const definition of definitions) {
    const hidden =
      matchesAny(definition.relativePath, excludeFilePatterns) ||
      matchesComponentPattern(definition.id, definition.name, excludeComponentPatterns);
    visibility.set(definition.id, {
      boundaryVisible: !hidden,
      implementationAnalyzed: !hidden,
    });
  }
  for (const target of externalTargets.values()) {
    visibility.set(target.id, {
      boundaryVisible: !matchesComponentPattern(target.id, target.title, excludeComponentPatterns),
      implementationAnalyzed: false,
    });
  }
  return visibility;
}

function sourceDefinitionIds(
  definitions: readonly ComponentDefinition[],
  uses: ReadonlyMap<string, ComponentUse>,
): readonly string[] {
  const definitionIds = new Set(definitions.map(({ id }) => id));
  const adjacency = new Map(definitions.map(({ id }) => [id, new Set<string>()]));
  for (const use of uses.values()) {
    if (definitionIds.has(use.ownerId) && use.target.definition) {
      adjacency.get(use.ownerId)?.add(use.target.id);
    }
  }

  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  function connect(componentId: string): void {
    indices.set(componentId, nextIndex);
    lowLinks.set(componentId, nextIndex);
    nextIndex += 1;
    stack.push(componentId);
    onStack.add(componentId);

    for (const targetId of [...(adjacency.get(componentId) ?? [])].toSorted()) {
      if (!indices.has(targetId)) {
        connect(targetId);
        lowLinks.set(componentId, Math.min(lowLinks.get(componentId)!, lowLinks.get(targetId)!));
      } else if (onStack.has(targetId)) {
        lowLinks.set(componentId, Math.min(lowLinks.get(componentId)!, indices.get(targetId)!));
      }
    }

    if (lowLinks.get(componentId) !== indices.get(componentId)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === componentId) break;
    }
    components.push(component.toSorted());
  }

  for (const definition of definitions) {
    if (!indices.has(definition.id)) connect(definition.id);
  }

  const componentIndexById = new Map<string, number>();
  components.forEach((component, index) => {
    for (const componentId of component) componentIndexById.set(componentId, index);
  });
  const incoming = new Set<number>();
  for (const [sourceId, targetIds] of adjacency) {
    const sourceIndex = componentIndexById.get(sourceId);
    for (const targetId of targetIds) {
      const targetIndex = componentIndexById.get(targetId);
      if (sourceIndex !== undefined && targetIndex !== undefined && sourceIndex !== targetIndex)
        incoming.add(targetIndex);
    }
  }

  return components
    .filter((_, index) => !incoming.has(index))
    .flat()
    .toSorted();
}

function collapseComponentStructure(
  definitions: readonly ComponentDefinition[],
  context: AnalysisContext,
  rulesByComponentId: ReadonlyMap<string, ConsumerRules>,
  visibility: ReadonlyMap<string, ComponentVisibility>,
): Readonly<{ visibleNodeIds: ReadonlySet<string>; relationships: readonly Relationship[] }> {
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
  const visibleNodeIds = new Set<string>();
  const relationships = new Map<string, Relationship>();
  const queuedDefinitions = new Set<string>();
  const processedDefinitions = new Set<string>();
  const definitionQueue: string[] = [];

  function targetVisibility(targetId: string): ComponentVisibility {
    return visibility.get(targetId) ?? { boundaryVisible: false, implementationAnalyzed: false };
  }

  function addFinalRelationship(relationship: Relationship): void {
    const key = relationshipKey(relationship);
    const existing = relationships.get(key);
    if (!existing || existing.kind === "direct-render" || relationship.kind === "direct-render") {
      relationships.set(key, relationship);
      return;
    }
    relationships.set(key, {
      ...relationship,
      supplierIds: [...new Set([...existing.supplierIds, ...relationship.supplierIds])].toSorted(),
    });
  }

  function makeVisible(target: ComponentTarget): void {
    const policy = targetVisibility(target.id);
    if (!policy.boundaryVisible) return;
    visibleNodeIds.add(target.id);
    if (
      target.definition &&
      policy.implementationAnalyzed &&
      !queuedDefinitions.has(target.id) &&
      !processedDefinitions.has(target.id)
    ) {
      queuedDefinitions.add(target.id);
      definitionQueue.push(target.id);
    }
  }

  function processSuppliedTarget(
    targetUse: ComponentUse,
    sourceId: string,
    kind: SuppliedValueKind,
    propName: string,
    trail: ReadonlySet<string>,
  ): void {
    const visitKey = [targetUse.id, sourceId, kind, propName].join("\0");
    if (trail.has(visitKey)) return;
    const nextTrail = new Set(trail).add(visitKey);
    const policy = targetVisibility(targetUse.target.id);
    if (!policy.boundaryVisible) {
      processUseSupplies(targetUse, sourceId, nextTrail, { kind, propName });
      return;
    }

    makeVisible(targetUse.target);
    addFinalRelationship({
      source: sourceId,
      target: targetUse.target.id,
      kind,
      propName,
      supplierIds: [targetUse.ownerId],
    });
    processUseSupplies(targetUse, targetUse.target.id, nextTrail);
  }

  function processUseSupplies(
    receiverUse: ComponentUse,
    fallbackSourceId: string,
    trail: ReadonlySet<string> = new Set(),
    inherited?: Readonly<{ kind: SuppliedValueKind; propName: string }>,
  ): void {
    const receiverVisible = targetVisibility(receiverUse.target.id).boundaryVisible;
    for (const supplied of receiverUse.suppliedValues) {
      const routes = resolveConsumerRoutes(receiverUse, supplied.propName, supplied.kind, rulesByComponentId, context);
      if (routes.length === 0) continue;

      if (!receiverVisible) {
        const relationship = inherited ?? { kind: supplied.kind, propName: supplied.propName };
        for (const targetUseId of supplied.targetUseIds) {
          const targetUse = context.uses.get(targetUseId);
          if (targetUse) {
            processSuppliedTarget(targetUse, fallbackSourceId, relationship.kind, relationship.propName, trail);
          }
        }
        continue;
      }

      for (const route of routes) {
        let lastVisibleStep: ConsumerRouteStep | undefined;
        for (const step of route.steps) {
          if (!targetVisibility(step.componentId).boundaryVisible) break;
          lastVisibleStep = step;
        }
        if (!lastVisibleStep) continue;
        for (const targetUseId of supplied.targetUseIds) {
          const targetUse = context.uses.get(targetUseId);
          if (targetUse) {
            processSuppliedTarget(targetUse, lastVisibleStep.componentId, route.kind, lastVisibleStep.propName, trail);
          }
        }
      }
    }
  }

  function processDirectUse(sourceId: string, use: ComponentUse): void {
    const policy = targetVisibility(use.target.id);
    if (policy.boundaryVisible) {
      makeVisible(use.target);
      addFinalRelationship({ source: sourceId, target: use.target.id, kind: "direct-render" });
    }
    processUseSupplies(use, sourceId);
  }

  for (const rootId of sourceDefinitionIds(definitions, context.uses)) {
    const definition = definitionsById.get(rootId);
    if (!definition || !targetVisibility(rootId).boundaryVisible) continue;
    makeVisible({ id: definition.id, title: definition.name, definition });
  }

  while (definitionQueue.length > 0) {
    const definitionId = definitionQueue.shift()!;
    queuedDefinitions.delete(definitionId);
    if (processedDefinitions.has(definitionId)) continue;
    processedDefinitions.add(definitionId);
    for (const useId of [...(context.directUseIdsByOwner.get(definitionId) ?? [])].toSorted()) {
      const use = context.uses.get(useId);
      if (use) processDirectUse(definitionId, use);
    }
  }

  return {
    visibleNodeIds,
    relationships: [...relationships.values()].toSorted((left, right) =>
      relationshipKey(left).localeCompare(relationshipKey(right)),
    ),
  };
}

function createGraph(
  definitions: readonly ComponentDefinition[],
  externalTargets: ReadonlyMap<string, ComponentTarget>,
  visibleNodeIds: ReadonlySet<string>,
  relationships: readonly Relationship[],
): DiagramGraph {
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
  const localNodes = definitions
    .filter(({ id }) => visibleNodeIds.has(id))
    .map((definition): DefaultDiagramNode => ({
      type: "default",
      id: definition.id,
      title: definition.name,
      description: definition.relativePath,
      links: [{ href: sourceHref(definition.relativePath) }],
    }));
  if (localNodes.length === 0) throw new Error("No React component definitions remain after filtering.");

  const externalNodes = [...externalTargets.values()]
    .filter(({ id }) => visibleNodeIds.has(id))
    .map((target): DefaultDiagramNode => ({
      type: "default",
      id: target.id,
      title: target.title,
      description: `${target.externalPackage} boundary`,
    }));
  const candidateNodeIds = new Set([...localNodes, ...externalNodes].map(({ id }) => id));
  const edges: DefaultDiagramEdge[] = relationships
    .filter(({ source, target }) => candidateNodeIds.has(source) && candidateNodeIds.has(target))
    .map((relationship): DefaultDiagramEdge => {
      const label = relationshipLabel(relationship, definitionsById);
      return {
        type: "default",
        id: edgeId(relationship),
        source: relationship.source,
        target: relationship.target,
        kind: relationshipKindLabel(relationship),
        ...(label ? { label } : {}),
      };
    })
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const nodes = [...localNodes, ...externalNodes].toSorted((left, right) => left.id.localeCompare(right.id));

  return { groups: [], nodes, edges };
}

export async function generateReactComponentStructureGraph(
  options: GenerateReactComponentStructureOptions,
): Promise<DiagramGraph> {
  if (options.sourcePaths.length === 0) throw new Error("At least one source path is required.");
  const scopePath = await realpath(options.scopePath);
  const sourceFilePaths = await collectSourceFiles(scopePath, options.sourcePaths, defaultAnalysisExcludeFilePatterns);
  if (sourceFilePaths.length === 0) throw new Error("No JS, JSX, TS, or TSX source files matched the selected paths.");

  const program = ts.createProgram({
    rootNames: sourceFilePaths,
    options: readCompilerOptions(scopePath, options.tsconfigPath),
  });
  const selectedPaths = new Set(sourceFilePaths);
  const sourceFiles = program
    .getSourceFiles()
    .filter((sourceFile) => selectedPaths.has(resolve(sourceFile.fileName)))
    .toSorted((left, right) => left.fileName.localeCompare(right.fileName));
  const syntaxErrors = sourceFiles.flatMap((sourceFile) => program.getSyntacticDiagnostics(sourceFile));
  if (syntaxErrors.length > 0) {
    throw new Error(`Cannot analyze selected source: ${syntaxErrors.map(formatDiagnostic).join("\n")}`);
  }

  const checker = program.getTypeChecker();
  const definitions = collectComponentDefinitions(sourceFiles, scopePath, checker);
  const definitionsBySymbol = new Map<ts.Symbol, ComponentDefinition>();
  const definitionsByDeclaration = new Map<ts.Node, ComponentDefinition>();
  for (const definition of definitions) {
    definitionsByDeclaration.set(definition.declaration, definition);
    const symbol = canonicalSymbol(definition.symbol, checker);
    if (symbol) definitionsBySymbol.set(symbol, definition);
  }

  const context: AnalysisContext = {
    checker,
    definitionsBySymbol,
    definitionsByDeclaration,
    externalTargets: new Map(),
    uses: new Map(),
    directUseIdsByOwner: new Map(),
    analyzedUseIds: new Set(),
  };
  for (const definition of definitions) analyzeDefinitionUsages(definition, context);

  const rulesByComponentId = new Map<string, ConsumerRules>();
  for (const definition of definitions) {
    const bindings = createPropBindings(definition, checker);
    rulesByComponentId.set(definition.id, analyzeConsumerRules(definition, context, bindings));
  }

  const visibility = createVisibilityByTarget(
    definitions,
    context.externalTargets,
    options.excludeFilePatterns ?? [],
    options.excludeComponentPatterns ?? [],
  );
  const collapsed = collapseComponentStructure(definitions, context, rulesByComponentId, visibility);
  return createGraph(definitions, context.externalTargets, collapsed.visibleNodeIds, collapsed.relationships);
}
