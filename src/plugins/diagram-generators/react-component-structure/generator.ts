import { createHash } from "node:crypto";
import { readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import micromatch from "micromatch";
import ts from "typescript";

import type { DefaultDiagramEdge, DefaultDiagramNode, DiagramGraph } from "@/features/diagram/diagram-graph";

/* eslint-disable no-use-before-define -- Recursive AST walkers use mutually recursive function declarations. */

const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const defaultExcludeFilePatterns = [
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

type Relationship = Readonly<{
  source: string;
  target: string;
  kind: ReactComponentRelationshipKind;
  propName?: string;
}>;

type TerminalRule = Readonly<{
  type: "terminal";
  kind: Exclude<ReactComponentRelationshipKind, "direct-render">;
  rendererId: string;
  propName: string;
}>;

type ForwardRule = Readonly<{
  type: "forward";
  targetComponentId: string;
  targetPropName: string;
}>;

type ConsumerRule = TerminalRule | ForwardRule;

type ConsumerRules = Readonly<{
  exact: Map<string, ConsumerRule[]>;
  spreads: ReadonlyArray<Readonly<{ excludedProps: ReadonlySet<string>; targetComponentId: string }>>;
}>;

type SuppliedRelationship = Readonly<{
  receiverId: string;
  propName: string;
  kind: Exclude<ReactComponentRelationshipKind, "direct-render">;
  targets: readonly ComponentTarget[];
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
  relationships: Map<string, Relationship>;
  suppliedRelationships: SuppliedRelationship[];
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

function createComponentId(relativePath: string, name: string): string {
  return `component:${relativePath}#${name}`;
}

function collectComponentDefinitions(
  sourceFiles: readonly ts.SourceFile[],
  scopePath: string,
  checker: ts.TypeChecker,
): readonly ComponentDefinition[] {
  const definitions: ComponentDefinition[] = [];

  function addDefinition(
    sourceFile: ts.SourceFile,
    declaration: ts.Node,
    name: string,
    symbol: ts.Symbol | undefined,
    functionLike: FunctionLike | undefined,
    renderRoots: readonly ts.Expression[],
    body: ts.ConciseBody | undefined,
    classComponent: boolean,
  ): void {
    if (!isComponentName(name)) return;
    if (renderRoots.length === 0 || !renderRoots.some((root) => containsReactOutput(root, checker))) return;
    const relativePath = toPosixPath(relative(scopePath, sourceFile.fileName));
    definitions.push({
      id: createComponentId(relativePath, name),
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
      if (ts.isFunctionDeclaration(statement) && statement.body && statement.name) {
        const roots = collectReturnExpressions(statement.body);
        addDefinition(
          sourceFile,
          statement,
          statement.name.text,
          checker.getSymbolAtLocation(statement.name),
          statement,
          roots,
          statement.body,
          false,
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

      if (ts.isClassDeclaration(statement) && statement.name) {
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
          statement.name.text,
          checker.getSymbolAtLocation(statement.name),
          undefined,
          collectReturnExpressions(renderMethod.body),
          renderMethod.body,
          true,
        );
        continue;
      }

      if (ts.isExportAssignment(statement)) {
        const functionLike = unwrapFunction(statement.expression, checker);
        if (!functionLike?.body) continue;
        const name = defaultExportName(sourceFile);
        const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
        const symbol = moduleSymbol
          ? checker.getExportsOfModule(moduleSymbol).find((candidate) => candidate.name === "default")
          : undefined;
        addDefinition(
          sourceFile,
          statement,
          name,
          symbol,
          functionLike,
          collectReturnExpressions(functionLike.body),
          functionLike.body,
          false,
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

function hasExternalDeclaration(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): boolean {
  const canonical = canonicalSymbol(symbol, checker);
  return (canonical?.declarations ?? symbol?.declarations ?? []).some((declaration) =>
    toPosixPath(declaration.getSourceFile().fileName).includes("/node_modules/"),
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

function importedBindingName(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): string | undefined {
  for (const declaration of symbol?.declarations ?? []) {
    if (ts.isImportSpecifier(declaration)) return (declaration.propertyName ?? declaration.name).text;
    if (ts.isImportClause(declaration)) return declarationName(symbol, checker) ?? "default";
  }
  return undefined;
}

function canonicalExternalTitle(
  expression: ts.Expression | ts.JsxTagNameExpression,
  symbol: ts.Symbol | undefined,
  importSymbol: ts.Symbol | undefined,
  checker: ts.TypeChecker,
): string {
  const localRoot = leftmostIdentifier(expression);
  const sourceText = expression.getText();
  const suffix = localRoot && sourceText.startsWith(localRoot.text) ? sourceText.slice(localRoot.text.length) : "";
  const rootName = importedBindingName(importSymbol, checker);
  if (rootName) return `${rootName}${suffix}`;
  return declarationName(symbol, checker) ?? (suffix.startsWith(".") ? suffix.slice(1) : sourceText);
}

function isIntrinsicJsxTag(tagName: ts.JsxTagNameExpression): boolean {
  return ts.isIdentifier(tagName) && /^[a-z]/.test(tagName.text);
}

function targetForReference(
  expression: ts.Expression | ts.JsxTagNameExpression,
  context: AnalysisContext,
): ComponentTarget | undefined {
  const checker = context.checker;
  const symbol = checker.getSymbolAtLocation(expression);
  const definition = resolveDefinition(symbol, checker, context.definitionsBySymbol, context.definitionsByDeclaration);
  if (definition) return { id: definition.id, title: definition.name, definition };

  const importIdentifier = leftmostIdentifier(expression);
  const importSymbol = importIdentifier ? checker.getSymbolAtLocation(importIdentifier) : symbol;
  const moduleSpecifier = getImportModuleSpecifier(importSymbol);
  const packageName = moduleSpecifier ? externalPackageName(moduleSpecifier) : undefined;
  if (!packageName || (!hasExternalDeclaration(symbol, checker) && !hasExternalDeclaration(importSymbol, checker))) {
    return undefined;
  }

  const title = canonicalExternalTitle(expression, symbol, importSymbol, checker);
  if (packageName === "react" && /(?:^|\.)Fragment$/.test(title)) return undefined;
  const key = `${packageName}\0${title}`;
  const existing = context.externalTargets.get(key);
  if (existing) return existing;
  const target = {
    id: `external:${packageName}#${title}`,
    title,
    externalPackage: packageName,
  } satisfies ComponentTarget;
  context.externalTargets.set(key, target);
  return target;
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

function collectIncomingProps(
  expression: ts.Expression,
  bindings: PropBindings,
  checker: ts.TypeChecker,
): readonly string[] {
  const props = new Set<string>();
  const direct = getIncomingProp(expression, bindings, checker);
  if (direct) props.add(direct);
  return [...props];
}

function analyzeConsumerRules(
  definition: ComponentDefinition,
  context: AnalysisContext,
  bindings: PropBindings,
): ConsumerRules {
  const rules: ConsumerRules = { exact: new Map(), spreads: [] };
  const mutableSpreads = rules.spreads as Array<
    Readonly<{ excludedProps: ReadonlySet<string>; targetComponentId: string }>
  >;

  function terminal(propName: string, kind: TerminalRule["kind"]): void {
    addExactRule(rules, propName, { type: "terminal", kind, rendererId: definition.id, propName });
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

  function collectForwardedProps(expression: ts.Expression): readonly string[] {
    const unwrapped = unwrapExpression(expression);
    return [
      ...collectIncomingProps(unwrapped, bindings, context.checker),
      ...(ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)
        ? collectInvokedRenderProps(unwrapped, true)
        : []),
    ];
  }

  function analyzeJsxAttributes(
    attributes: ts.JsxAttributes,
    target: ComponentTarget | undefined,
    children: readonly ts.JsxChild[],
  ): void {
    for (const property of attributes.properties) {
      if (ts.isJsxAttribute(property)) {
        const expression = jsxAttributeExpression(property);
        if (!expression) continue;
        analyzeRenderPropInvocations(expression);
        if (!target) continue;
        const targetPropName = property.name.getText();
        for (const propName of new Set(collectForwardedProps(expression))) {
          addExactRule(rules, propName, {
            type: "forward",
            targetComponentId: target.id,
            targetPropName,
          });
        }
      } else if (target) {
        const exclusions = getSpreadExclusions(property.expression, bindings, context.checker);
        if (exclusions) mutableSpreads.push({ excludedProps: exclusions, targetComponentId: target.id });
      }
    }

    for (const child of children) {
      if (ts.isJsxExpression(child) && child.expression) analyzeRenderPropInvocations(child.expression);
      if (!target || !ts.isJsxExpression(child) || !child.expression) continue;
      for (const propName of new Set(collectForwardedProps(child.expression))) {
        addExactRule(rules, propName, { type: "forward", targetComponentId: target.id, targetPropName: "children" });
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
      analyzeJsxAttributes(opening.attributes, target, ts.isJsxElement(unwrapped) ? unwrapped.children : []);
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
    if (propsExpression && ts.isObjectLiteralExpression(propsExpression)) {
      for (const property of propsExpression.properties) {
        if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
          const value = ts.isPropertyAssignment(property) ? property.initializer : property.name;
          const targetPropName = propertyNameText(property.name);
          const shorthandSymbol = ts.isShorthandPropertyAssignment(property)
            ? context.checker.getShorthandAssignmentValueSymbol(property)
            : undefined;
          const shorthandPropName = shorthandSymbol ? bindings.propSymbols.get(shorthandSymbol) : undefined;
          analyzeRenderPropInvocations(value);
          if (!target || !targetPropName) continue;
          const forwardedProps = [...collectForwardedProps(value), ...(shorthandPropName ? [shorthandPropName] : [])];
          for (const propName of new Set(forwardedProps)) {
            addExactRule(rules, propName, {
              type: "forward",
              targetComponentId: target.id,
              targetPropName,
            });
          }
        } else if (target && ts.isSpreadAssignment(property)) {
          const exclusions = getSpreadExclusions(property.expression, bindings, context.checker);
          if (exclusions) mutableSpreads.push({ excludedProps: exclusions, targetComponentId: target.id });
        }
      }
    }
    for (const child of children) {
      analyzeRenderPropInvocations(child);
      if (!target) continue;
      for (const propName of collectIncomingProps(child, bindings, context.checker)) {
        addExactRule(rules, propName, { type: "forward", targetComponentId: target.id, targetPropName: "children" });
      }
    }
  }

  for (const root of definition.renderRoots) analyzeRendered(root);
  return rules;
}

function relationshipKey(relationship: Relationship): string {
  return [relationship.source, relationship.target, relationship.kind, relationship.propName ?? ""].join("\0");
}

function addRelationship(context: AnalysisContext, relationship: Relationship): void {
  context.relationships.set(relationshipKey(relationship), relationship);
}

function returnedTargets(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  context: AnalysisContext,
): readonly ComponentTarget[] {
  return collectSuppliedTargets(collectReturnExpressions(callback.body), context);
}

function collectSuppliedTargets(
  expressions: readonly ts.Expression[],
  context: AnalysisContext,
): readonly ComponentTarget[] {
  const targets = new Map<string, ComponentTarget>();

  function collect(expression: ts.Expression): void {
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
        targets.set(target.id, target);
        analyzeJsxComponentUsage(unwrapped, target, context);
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
        targets.set(target.id, target);
        analyzeCreateElementUsage(unwrapped, target, context);
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
      for (const element of unwrapped.elements) if (ts.isExpression(element)) collect(element);
    }
  }

  function collectChild(child: ts.JsxChild): void {
    if (ts.isJsxExpression(child) && child.expression) collect(child.expression);
    else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) collect(child);
  }

  for (const expression of expressions) collect(expression);
  return [...targets.values()].toSorted((left, right) => left.id.localeCompare(right.id));
}

function componentReferenceTargets(
  expression: ts.Expression,
  context: AnalysisContext,
  visitedSymbols: ReadonlySet<ts.Symbol> = new Set(),
): readonly ComponentTarget[] {
  const targets = new Map<string, ComponentTarget>();

  function collect(candidate: ts.Expression, visited: ReadonlySet<ts.Symbol>): void {
    const unwrapped = unwrapExpression(candidate);
    if (ts.isObjectLiteralExpression(unwrapped)) {
      for (const property of unwrapped.properties) {
        if (ts.isPropertyAssignment(property)) collect(property.initializer, visited);
        else if (ts.isShorthandPropertyAssignment(property)) collect(property.name, visited);
        else if (ts.isSpreadAssignment(property)) collect(property.expression, visited);
      }
      return;
    }
    if (ts.isArrayLiteralExpression(unwrapped)) {
      for (const element of unwrapped.elements) if (ts.isExpression(element)) collect(element, visited);
      return;
    }
    if (!ts.isIdentifier(unwrapped) && !ts.isPropertyAccessExpression(unwrapped)) return;

    const target = targetForReference(unwrapped, context);
    if (target) {
      targets.set(target.id, target);
      return;
    }

    const symbol = canonicalSymbol(context.checker.getSymbolAtLocation(unwrapped), context.checker);
    if (!symbol || visited.has(symbol)) return;
    const nextVisited = new Set(visited).add(symbol);
    for (const declaration of symbol.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        collect(declaration.initializer, nextVisited);
      }
    }
  }

  collect(expression, visitedSymbols);
  return [...targets.values()].toSorted((left, right) => left.id.localeCompare(right.id));
}

function suppliedRelationship(
  receiver: ComponentTarget,
  propName: string,
  kind: SuppliedRelationship["kind"],
  targets: readonly ComponentTarget[],
  context: AnalysisContext,
): void {
  if (targets.length === 0) return;
  context.suppliedRelationships.push({ receiverId: receiver.id, propName, kind, targets });
}

function analyzeJsxComponentUsage(
  element: ts.JsxElement | ts.JsxSelfClosingElement,
  receiver: ComponentTarget,
  context: AnalysisContext,
): void {
  const opening = ts.isJsxElement(element) ? element.openingElement : element;
  for (const property of opening.attributes.properties) {
    if (!ts.isJsxAttribute(property)) continue;
    const expression = jsxAttributeExpression(property);
    if (!expression) continue;
    const propName = property.name.getText();
    const unwrapped = unwrapExpression(expression);
    if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
      suppliedRelationship(receiver, propName, "render-prop", returnedTargets(unwrapped, context), context);
      continue;
    }
    const componentTargets = componentReferenceTargets(unwrapped, context);
    if (componentTargets.length > 0) {
      suppliedRelationship(receiver, propName, "component-prop", componentTargets, context);
      continue;
    }
    suppliedRelationship(receiver, propName, "node-prop", collectSuppliedTargets([unwrapped], context), context);
  }

  if (ts.isJsxElement(element)) {
    const nodeChildren: ts.Expression[] = [];
    for (const child of element.children) {
      const expression = ts.isJsxExpression(child)
        ? child.expression
        : ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)
          ? child
          : undefined;
      if (!expression) continue;
      const unwrapped = unwrapExpression(expression);
      if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
        suppliedRelationship(receiver, "children", "render-prop", returnedTargets(unwrapped, context), context);
      } else {
        nodeChildren.push(unwrapped);
      }
    }
    suppliedRelationship(receiver, "children", "node-prop", collectSuppliedTargets(nodeChildren, context), context);
  }
}

function analyzeCreateElementUsage(call: ts.CallExpression, receiver: ComponentTarget, context: AnalysisContext): void {
  const [, propsExpression, ...children] = call.arguments;
  if (propsExpression && ts.isObjectLiteralExpression(propsExpression)) {
    for (const property of propsExpression.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
      const propName = propertyNameText(property.name);
      if (!propName) continue;
      const value = unwrapExpression(ts.isPropertyAssignment(property) ? property.initializer : property.name);
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
        suppliedRelationship(receiver, propName, "render-prop", returnedTargets(value, context), context);
        continue;
      }
      const componentTargets = componentReferenceTargets(value, context);
      if (componentTargets.length > 0) {
        suppliedRelationship(receiver, propName, "component-prop", componentTargets, context);
        continue;
      }
      suppliedRelationship(receiver, propName, "node-prop", collectSuppliedTargets([value], context), context);
    }
  }
  const nodeChildren: ts.Expression[] = [];
  for (const child of children) {
    const value = unwrapExpression(child);
    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
      suppliedRelationship(receiver, "children", "render-prop", returnedTargets(value, context), context);
    } else {
      nodeChildren.push(value);
    }
  }
  suppliedRelationship(receiver, "children", "node-prop", collectSuppliedTargets(nodeChildren, context), context);
}

function analyzeDefinitionUsages(definition: ComponentDefinition, context: AnalysisContext): void {
  function analyzeRendered(expression: ts.Expression, directRenderer: ComponentDefinition): void {
    const unwrapped = unwrapExpression(expression);
    if (ts.isJsxFragment(unwrapped)) {
      for (const child of unwrapped.children) analyzeChild(child, directRenderer);
      return;
    }
    if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped)) {
      const opening = ts.isJsxElement(unwrapped) ? unwrapped.openingElement : unwrapped;
      if (isIntrinsicJsxTag(opening.tagName)) {
        if (ts.isJsxElement(unwrapped)) for (const child of unwrapped.children) analyzeChild(child, directRenderer);
        return;
      }
      const target = targetForReference(opening.tagName, context);
      if (!target) return;
      addRelationship(context, { source: directRenderer.id, target: target.id, kind: "direct-render" });
      analyzeJsxComponentUsage(unwrapped, target, context);
      return;
    }
    if (ts.isCallExpression(unwrapped) && isCreateElementCall(unwrapped, context.checker)) {
      const [tagExpression] = unwrapped.arguments;
      if (!tagExpression) return;
      if (ts.isStringLiteral(tagExpression)) {
        for (const child of unwrapped.arguments.slice(2)) analyzeRendered(child, directRenderer);
        return;
      }
      const target = targetForReference(tagExpression, context);
      if (!target) return;
      addRelationship(context, { source: directRenderer.id, target: target.id, kind: "direct-render" });
      analyzeCreateElementUsage(unwrapped, target, context);
      return;
    }
    if (ts.isConditionalExpression(unwrapped)) {
      analyzeRendered(unwrapped.whenTrue, directRenderer);
      analyzeRendered(unwrapped.whenFalse, directRenderer);
      return;
    }
    if (ts.isBinaryExpression(unwrapped)) {
      analyzeRendered(unwrapped.right, directRenderer);
      return;
    }
    if (ts.isArrayLiteralExpression(unwrapped)) {
      for (const element of unwrapped.elements) if (ts.isExpression(element)) analyzeRendered(element, directRenderer);
      return;
    }
    if (ts.isCallExpression(unwrapped) && isArrayRenderingMethodCall(unwrapped, context.checker)) {
      for (const argument of unwrapped.arguments) {
        if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
          for (const returned of collectReturnExpressions(argument.body)) analyzeRendered(returned, directRenderer);
        }
      }
    }
  }

  function analyzeChild(child: ts.JsxChild, renderer: ComponentDefinition): void {
    if (ts.isJsxExpression(child) && child.expression) analyzeRendered(child.expression, renderer);
    else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      analyzeRendered(child, renderer);
    }
  }

  for (const root of definition.renderRoots) analyzeRendered(root, definition);
}

function resolveConsumerEndpoints(
  componentId: string,
  propName: string,
  kind: SuppliedRelationship["kind"],
  rulesByComponentId: ReadonlyMap<string, ConsumerRules>,
  visited: ReadonlySet<string> = new Set(),
): readonly TerminalRule[] {
  const visitKey = `${componentId}\0${propName}\0${kind}`;
  if (visited.has(visitKey)) return [];
  const nextVisited = new Set(visited).add(visitKey);
  const rules = rulesByComponentId.get(componentId);
  if (!rules) return [{ type: "terminal", kind, rendererId: componentId, propName }];
  const candidates = [
    ...(rules.exact.get(propName) ?? []),
    ...rules.spreads
      .filter(({ excludedProps }) => !excludedProps.has(propName))
      .map(({ targetComponentId }): ForwardRule => ({ type: "forward", targetComponentId, targetPropName: propName })),
  ];
  const endpoints = new Map<string, TerminalRule>();

  for (const rule of candidates) {
    if (rule.type === "terminal") {
      if (rule.kind === kind) endpoints.set(JSON.stringify(rule), rule);
      continue;
    }
    for (const endpoint of resolveConsumerEndpoints(
      rule.targetComponentId,
      rule.targetPropName,
      kind,
      rulesByComponentId,
      nextVisited,
    )) {
      endpoints.set(JSON.stringify(endpoint), endpoint);
    }
  }

  return [...endpoints.values()];
}

function relationshipLabel(relationship: Relationship): string | undefined {
  if (relationship.kind === "direct-render") return undefined;
  const category =
    relationship.kind === "node-prop"
      ? "Node prop"
      : relationship.kind === "render-prop"
        ? "Render prop"
        : "Component prop";
  return `${category} · ${relationship.propName}`;
}

function edgeId(relationship: Relationship): string {
  return `edge:${createHash("sha256").update(relationshipKey(relationship)).digest("hex").slice(0, 16)}`;
}

function sourceHref(relativePath: string): string {
  return `source:///${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function createGraph(
  definitions: readonly ComponentDefinition[],
  externalTargets: ReadonlyMap<string, ComponentTarget>,
  relationships: readonly Relationship[],
  excludeComponentPatterns: readonly string[],
): DiagramGraph {
  const localNodes = definitions
    .map((definition): DefaultDiagramNode => ({
      type: "default",
      id: definition.id,
      kind: "React component",
      title: definition.name,
      description: definition.relativePath,
      links: [{ href: sourceHref(definition.relativePath) }],
    }))
    .filter((node) => !matchesAny(node.title, excludeComponentPatterns));
  if (localNodes.length === 0) throw new Error("No React component definitions remain after filtering.");

  const externalNodes = [...externalTargets.values()]
    .map((target): DefaultDiagramNode => ({
      type: "default",
      id: target.id,
      kind: "External React component",
      title: target.title,
      description: `${target.externalPackage} boundary`,
    }))
    .filter((node) => !matchesAny(node.title, excludeComponentPatterns));
  const candidateNodeIds = new Set([...localNodes, ...externalNodes].map(({ id }) => id));
  const edges: DefaultDiagramEdge[] = relationships
    .filter(({ source, target }) => candidateNodeIds.has(source) && candidateNodeIds.has(target))
    .map((relationship): DefaultDiagramEdge => ({
      type: "default",
      id: edgeId(relationship),
      source: relationship.source,
      target: relationship.target,
      kind: relationship.kind,
      ...(relationshipLabel(relationship) ? { label: relationshipLabel(relationship) } : {}),
    }))
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const connectedNodeIds = new Set(edges.flatMap(({ source, target }) => [source, target]));
  const nodes = [...localNodes, ...externalNodes.filter(({ id }) => connectedNodeIds.has(id))].toSorted((left, right) =>
    left.id.localeCompare(right.id),
  );

  return { groups: [], nodes, edges };
}

export async function generateReactComponentStructureGraph(
  options: GenerateReactComponentStructureOptions,
): Promise<DiagramGraph> {
  if (options.sourcePaths.length === 0) throw new Error("At least one source path is required.");
  const scopePath = await realpath(options.scopePath);
  const excludeFilePatterns = [...defaultExcludeFilePatterns, ...(options.excludeFilePatterns ?? [])];
  const sourceFilePaths = await collectSourceFiles(scopePath, options.sourcePaths, excludeFilePatterns);
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
    relationships: new Map(),
    suppliedRelationships: [],
  };
  const rulesByComponentId = new Map<string, ConsumerRules>();
  for (const definition of definitions) {
    const bindings = createPropBindings(definition, checker);
    rulesByComponentId.set(definition.id, analyzeConsumerRules(definition, context, bindings));
  }
  for (const definition of definitions) analyzeDefinitionUsages(definition, context);

  for (const supplied of context.suppliedRelationships) {
    const endpoints = resolveConsumerEndpoints(
      supplied.receiverId,
      supplied.propName,
      supplied.kind,
      rulesByComponentId,
    );
    for (const endpoint of endpoints) {
      for (const target of supplied.targets) {
        addRelationship(context, {
          source: endpoint.rendererId,
          target: target.id,
          kind: endpoint.kind,
          propName: endpoint.propName,
        });
      }
    }
  }

  return createGraph(
    definitions,
    context.externalTargets,
    [...context.relationships.values()].toSorted((left, right) =>
      relationshipKey(left).localeCompare(relationshipKey(right)),
    ),
    options.excludeComponentPatterns ?? [],
  );
}
