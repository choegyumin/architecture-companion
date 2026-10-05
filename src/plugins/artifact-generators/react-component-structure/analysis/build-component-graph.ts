import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";

import ignore from "ignore";
import micromatch from "micromatch";
import type ts from "typescript";

import { projectDecisionNodes } from "@/features/diagram/decision-nodes";
import { combineControlPaths, unionControlPaths } from "@/features/diagram/diagram-control-paths";
import type {
  DefaultDiagramEdge,
  DefaultDiagramNode,
  DiagramControl,
  DiagramControlPaths,
  DiagramGraph,
} from "@/features/diagram/diagram-graph";
import { isMissingPathError, isPathInside, toPosixPath } from "@/shared/node/path";

import { collectSourceFiles } from "./collect-source-files";
import { loadTypeScript } from "./load-typescript";

/* eslint-disable no-use-before-define -- Recursive AST walkers use mutually recursive function declarations. */

export type ReactComponentRelationshipKind = "direct-render" | "node-prop" | "render-prop" | "component-prop";

export type ComponentGraphOptions = Readonly<{
  scopePath: string;
  sourcePaths: readonly string[];
  tsconfigPath?: string;
  excludeFilePatterns?: readonly string[];
  excludeComponentPatterns?: readonly string[];
  rootPatterns?: readonly string[];
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
  origins: readonly Readonly<{ supplierId: string; prop: string }>[];
}>;

type Relationship = (DirectRenderRelationship | SuppliedRenderRelationship) & Readonly<{ paths: DiagramControlPaths }>;

type SuppliedValue = Readonly<{
  propName: string;
  kind: SuppliedValueKind;
  targets: readonly Readonly<{ useId: string; paths: DiagramControlPaths }>[];
}>;

type ComponentUse = Readonly<{
  id: string;
  ownerId: string;
  target: ComponentTarget;
  suppliedValues: SuppliedValue[];
}>;

type ComponentInstance = Readonly<{
  id: string;
  target: ComponentTarget;
  ancestors: ReadonlyMap<string, ComponentInstance>;
  uses: Map<string, ComponentInstance>;
}>;

type TerminalRule = Readonly<{
  type: "terminal";
  kind: SuppliedValueKind;
  paths: DiagramControlPaths;
}>;

type ForwardRule = Readonly<{
  type: "forward";
  targetUseId: string;
  targetPropName: string;
  paths: DiagramControlPaths;
}>;

type ConsumerRule = TerminalRule | ForwardRule;

type ConsumerRules = Readonly<{
  exact: Map<string, ConsumerRule[]>;
  spreads: ReadonlyArray<
    Readonly<{ excludedProps: ReadonlySet<string>; targetUseId: string; paths: DiagramControlPaths }>
  >;
}>;

type ConsumerRouteStep = Readonly<{
  useId: string;
  componentId: string;
  propName: string;
  paths: DiagramControlPaths;
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
  scopePath: string;
  program: ts.Program;
  host: ts.ModuleResolutionHost;
  checker: ts.TypeChecker;
  definitionsBySymbol: ReadonlyMap<ts.Symbol, ComponentDefinition>;
  definitionsByDeclaration: ReadonlyMap<ts.Node, ComponentDefinition>;
  externalTargets: Map<string, ComponentTarget>;
  uses: Map<string, ComponentUse>;
  directUseIdsByOwner: Map<string, string[]>;
  analyzedUseIds: Set<string>;
  controls: Map<string, DiagramControl>;
  usePaths: Map<string, DiagramControlPaths>;
  propBindings: ReadonlyMap<string, PropBindings>;
}>;

// AST predicates, enum values, the checker, and declarations must use the same compiler.
function createComponentGraphBuilder(ts: typeof import("typescript")) {
  function formatDiagnostic(diagnostic: ts.Diagnostic): string {
    return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  }

  async function readCompilerOptions(scopePath: string, tsconfigPath?: string): Promise<ts.CompilerOptions> {
    const candidatePath = resolve(scopePath, tsconfigPath ?? "tsconfig.json");
    let canonicalPath: string | undefined;
    try {
      canonicalPath = await realpath(candidatePath);
    } catch (error) {
      if (!isMissingPathError(error) || tsconfigPath !== undefined) throw error;
    }

    let options: ts.CompilerOptions = {};
    if (canonicalPath) {
      if (!isPathInside(scopePath, canonicalPath)) {
        throw new Error(`TypeScript config must stay inside the base: ${tsconfigPath ?? "tsconfig.json"}`);
      }
      if (!(await lstat(canonicalPath)).isFile()) {
        throw new Error(`TypeScript config must be a file: ${tsconfigPath ?? "tsconfig.json"}`);
      }
      const config = ts.readConfigFile(canonicalPath, ts.sys.readFile);
      if (config.error) throw new Error(`Cannot read ${canonicalPath}: ${formatDiagnostic(config.error)}`);
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve(canonicalPath, ".."));
      if (parsed.errors.length > 0) {
        throw new Error(`Cannot parse ${canonicalPath}: ${parsed.errors.map(formatDiagnostic).join("\n")}`);
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
      // Bundler resolution requires module ES2015+ or preserve; a tsconfig that
      // pins an older module (for example commonjs) must fall back to Node10.
      moduleResolution:
        options.moduleResolution ??
        (options.module !== undefined && options.module < ts.ModuleKind.ES2015
          ? ts.ModuleResolutionKind.Node10
          : ts.ModuleResolutionKind.Bundler),
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

  function collectReturnExpressions(body: ts.Node): readonly ts.Expression[] {
    if (ts.isExpression(body)) return [body];
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

  function containsReactOutput(
    expression: ts.Expression,
    checker: ts.TypeChecker,
    visitedSymbols: ReadonlySet<ts.Symbol> = new Set(),
  ): boolean {
    const unwrapped = unwrapExpression(expression);
    if (ts.isIdentifier(unwrapped) || ts.isPropertyAccessExpression(unwrapped)) {
      const symbol = canonicalSymbol(checker.getSymbolAtLocation(unwrapped), checker);
      if (symbol && !visitedSymbols.has(symbol)) {
        const next = new Set(visitedSymbols).add(symbol);
        if (
          symbol.declarations?.some(
            (declaration) =>
              ts.isVariableDeclaration(declaration) &&
              declaration.initializer &&
              ts.isVariableDeclarationList(declaration.parent) &&
              (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
              containsReactOutput(declaration.initializer, checker, next),
          )
        )
          return true;
      }
    }
    if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped) || ts.isJsxFragment(unwrapped)) return true;
    if (ts.isCallExpression(unwrapped)) {
      if (isCreateElementCall(unwrapped, checker)) return true;
      if (!isArrayRenderingMethodCall(unwrapped, checker)) return false;
      return unwrapped.arguments.some(
        (argument) =>
          (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) &&
          collectReturnExpressions(argument.body).some((returned) =>
            containsReactOutput(returned, checker, visitedSymbols),
          ),
      );
    }
    if (ts.isConditionalExpression(unwrapped)) {
      return (
        containsReactOutput(unwrapped.whenTrue, checker, visitedSymbols) ||
        containsReactOutput(unwrapped.whenFalse, checker, visitedSymbols)
      );
    }
    if (ts.isBinaryExpression(unwrapped))
      return (
        containsReactOutput(unwrapped.left, checker, visitedSymbols) ||
        containsReactOutput(unwrapped.right, checker, visitedSymbols)
      );
    if (ts.isArrayLiteralExpression(unwrapped)) {
      return unwrapped.elements.some(
        (element) => ts.isExpression(element) && containsReactOutput(element, checker, visitedSymbols),
      );
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
    const renderedSymbols = new Set<ts.Symbol>();
    function collectRenderedSymbols(node: ts.Node): void {
      const reference =
        ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)
          ? node.tagName
          : ts.isCallExpression(node) && isCreateElementCall(node, checker)
            ? node.arguments.at(0)
            : undefined;
      const symbol = reference ? canonicalSymbol(checker.getSymbolAtLocation(reference), checker) : undefined;
      if (symbol) renderedSymbols.add(symbol);
      ts.forEachChild(node, collectRenderedSymbols);
    }
    for (const sourceFile of sourceFiles) collectRenderedSymbols(sourceFile);

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
      if (
        renderRoots.length === 0 ||
        (!renderRoots.some((root) => containsReactOutput(root, checker)) &&
          !renderedSymbols.has(canonicalSymbol(symbol, checker)!))
      )
        return;
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
      if (ts.isExportAssignment(declaration)) {
        const expression = unwrapExpression(declaration.expression);
        if (
          ts.isCallExpression(expression) &&
          isReactWrapperCall(expression, checker) &&
          expression.arguments.length > 0
        ) {
          const wrapped = unwrapExpression(expression.arguments.at(0) as ts.Expression);
          if (ts.isIdentifier(wrapped) || ts.isPropertyAccessExpression(wrapped)) {
            const aliasedDefinition = resolveDefinition(
              checker.getSymbolAtLocation(wrapped),
              checker,
              definitionsBySymbol,
              definitionsByDeclaration,
              nextVisited,
            );
            if (aliasedDefinition) return aliasedDefinition;
          }
        }
        continue;
      }
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
    if (markerIndex >= 0) {
      const modulePath = normalized.slice(markerIndex + marker.length);
      if (modulePath.startsWith("@")) return modulePath.split("/").slice(0, 2).join("/");
      const packageName = modulePath.split("/").at(0);
      return packageName && !packageName.startsWith(".") ? packageName : undefined;
    }

    // Workspace links can resolve outside node_modules. Nested module-format
    // manifests need not name the package, so continue to the containing manifest.
    let directory = resolve(fileName, "..");
    while (true) {
      const manifestPath = ts.findConfigFile(directory, ts.sys.fileExists, "package.json");
      if (!manifestPath) return undefined;
      const { config } = ts.readConfigFile(manifestPath, ts.sys.readFile);
      if (typeof config?.name === "string") return config.name;
      const parent = resolve(manifestPath, "../..");
      if (parent === resolve(manifestPath, "..")) return undefined;
      directory = parent;
    }
  }

  function hasExternalDeclaration(symbol: ts.Symbol | undefined, context: AnalysisContext): boolean {
    const canonical = canonicalSymbol(symbol, context.checker);
    return (canonical?.declarations ?? symbol?.declarations ?? []).some((declaration) =>
      context.program.isSourceFileFromExternalLibrary(declaration.getSourceFile()),
    );
  }

  function isReactSymbol(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): boolean {
    if (getImportModuleSpecifier(symbol) === "react") return true;
    const canonical = canonicalSymbol(symbol, checker);
    return (canonical?.declarations ?? symbol?.declarations ?? []).some((declaration) => {
      const packageName = externalPackageNameFromFile(declaration.getSourceFile().fileName);
      return packageName === "react" || packageName === "@types/react";
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
    moduleSpecifier: ts.StringLiteral;
    importedName: string;
  }>;

  type ExternalSymbolOrigin = Readonly<{
    packageName: string;
    importedName?: string;
    symbol: ts.Symbol;
    namespaceDepth?: number;
  }>;

  type ExternalReference = Readonly<{
    origin: ExternalSymbolOrigin;
    members: readonly ReferenceMember[];
    localName: string;
  }>;

  type ReferenceMember = Readonly<{
    name: string;
    symbol?: ts.Symbol;
    type: ts.Type;
  }>;

  function resolveReferenceMembers(
    symbol: ts.Symbol,
    location: ts.Node,
    names: readonly string[],
    checker: ts.TypeChecker,
  ): readonly ReferenceMember[] | undefined {
    const members: ReferenceMember[] = [];
    let type = checker.getTypeOfSymbolAtLocation(symbol, location);
    for (const name of names) {
      const member = checker.getPropertyOfType(type, name);
      const nextType = member
        ? checker.getTypeOfSymbolAtLocation(member, location)
        : checker
            .getIndexInfosOfType(type)
            .find(({ keyType }) => checker.isTypeAssignableTo(checker.getStringLiteralType(name), keyType))?.type;
      if (!nextType) return undefined;
      members.push({ name, symbol: member, type: nextType });
      type = nextType;
    }
    return members;
  }

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
      return { moduleSpecifier: candidate.moduleSpecifier, importedName };
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

  function externalSymbolOrigin(
    symbol: ts.Symbol,
    context: AnalysisContext,
    namespaceMembers: readonly ReferenceMember[] = [],
  ): ExternalSymbolOrigin | undefined {
    const checker = context.checker;
    const chain = symbolAliasChain(symbol, checker);
    const canonical = canonicalSymbol(chain.at(-1), checker);
    const namespaceMember = namespaceMembers.at(0);
    const namespaceBinding = chain.map(moduleBinding).find((binding) => binding?.importedName === "*");
    // Type members also cover export= objects and applicable index signatures;
    // looking them up again in a module export table would discard that evidence.
    const member = namespaceBinding ? namespaceMember?.symbol : undefined;
    const selected = canonicalSymbol(member, checker);
    const externalSymbol = selected?.declarations?.length ? selected : canonical;
    if (!externalSymbol?.declarations?.length) return undefined;

    const originFromBinding = (
      binding: ModuleBinding,
      visited: ReadonlySet<ts.StringLiteral> = new Set(),
    ): ExternalSymbolOrigin | undefined => {
      if (visited.has(binding.moduleSpecifier)) return undefined;
      const sourceFile = binding.moduleSpecifier.getSourceFile();
      const resolved = ts.resolveModuleName(
        binding.moduleSpecifier.text,
        sourceFile.fileName,
        context.program.getCompilerOptions(),
        context.host,
        undefined,
        undefined,
        context.program.getModeForUsageLocation(sourceFile, binding.moduleSpecifier),
      ).resolvedModule;
      if (resolved?.isExternalLibraryImport) {
        const packageName = externalPackageName(binding.moduleSpecifier.text);
        if (packageName) return { packageName, importedName: binding.importedName, symbol: externalSymbol };
      }

      // Star re-exports can bypass intermediate symbols in the alias chain.
      const moduleSymbol = checker.getSymbolAtLocation(binding.moduleSpecifier);
      const nextVisited = new Set(visited).add(binding.moduleSpecifier);
      for (const declaration of moduleSymbol?.declarations ?? []) {
        if (!ts.isSourceFile(declaration)) continue;
        const hasExplicitExport = declaration.statements.some(
          (statement) =>
            ts.isExportDeclaration(statement) &&
            statement.exportClause &&
            (ts.isNamespaceExport(statement.exportClause)
              ? statement.exportClause.name.text === binding.importedName
              : statement.exportClause.elements.some((member) => member.name.text === binding.importedName)),
        );
        if (hasExplicitExport) continue;
        for (const statement of declaration.statements) {
          if (
            !ts.isExportDeclaration(statement) ||
            statement.exportClause ||
            !statement.moduleSpecifier ||
            !ts.isStringLiteral(statement.moduleSpecifier)
          ) {
            continue;
          }
          const exportedModule = checker.getSymbolAtLocation(statement.moduleSpecifier);
          const exported = exportedModule
            ? checker.getExportsOfModule(exportedModule).find((member) => member.name === binding.importedName)
            : undefined;
          if (canonicalSymbol(exported, checker) !== externalSymbol) continue;
          const origin = originFromBinding(
            { moduleSpecifier: statement.moduleSpecifier, importedName: binding.importedName },
            nextVisited,
          );
          if (origin) return origin;
        }
      }
      return undefined;
    };

    // A local import of the same file can clear its program-wide external flag.
    for (const candidate of chain) {
      const binding = moduleBinding(candidate);
      const origin = binding
        ? originFromBinding(
            binding.importedName === "*" && namespaceMember
              ? { ...binding, importedName: namespaceMember.name }
              : binding,
          )
        : undefined;
      if (origin) return binding?.importedName === "*" ? { ...origin, importedName: "*" } : origin;
    }
    if (member) {
      const origin = externalSymbolOrigin(member, context, namespaceMembers.slice(1));
      if (origin) return { ...origin, namespaceDepth: (origin.namespaceDepth ?? 0) + 1 };
    }

    if (!hasExternalDeclaration(externalSymbol, context)) return undefined;
    const packageName = externalPackageForSymbol(externalSymbol, checker);
    return packageName ? { packageName, symbol: externalSymbol } : undefined;
  }

  function externalReferencePath(
    expression: ts.Expression | ts.JsxTagNameExpression,
  ): Readonly<{ root: ts.Identifier; members: readonly string[] }> | undefined {
    if (ts.isJsxNamespacedName(expression)) return undefined;
    let current = unwrapExpression(expression);
    const members: string[] = [];
    while (ts.isPropertyAccessExpression(current)) {
      members.unshift(current.name.text);
      current = unwrapExpression(current.expression);
    }
    return ts.isIdentifier(current) ? { root: current, members } : undefined;
  }

  function resolveExternalReference(
    expression: ts.Expression | ts.JsxTagNameExpression,
    context: AnalysisContext,
    symbolOverride?: ts.Symbol,
    visitedSymbols: ReadonlySet<ts.Symbol> = new Set(),
    remainingMembers: readonly string[] = [],
  ): ExternalReference | undefined {
    const path = externalReferencePath(expression);
    if (!path) return undefined;
    const symbol = symbolOverride ?? context.checker.getSymbolAtLocation(path.root);
    if (!symbol || visitedSymbols.has(symbol)) return undefined;
    const members = [...path.members, ...remainingMembers];
    const selectedMembers = resolveReferenceMembers(symbol, expression, members, context.checker);
    if (!selectedMembers) return undefined;
    const origin = externalSymbolOrigin(symbol, context, selectedMembers);
    if (origin) {
      return { origin, members: selectedMembers.slice(origin.namespaceDepth ?? 0), localName: path.root.text };
    }

    const reference = localImmutableReference(symbol, context, visitedSymbols);
    if (!reference) return undefined;
    const resolved = new Map<string, ExternalReference>();
    for (const initializer of reference.initializers) {
      const target = resolveExternalReference(initializer, context, undefined, reference.visitedSymbols, members);
      if (!target) continue;
      resolved.set(externalReferenceIdentity(target, context.checker).id, target);
    }
    return resolved.size === 1 ? [...resolved.values()].at(0) : undefined;
  }

  function externalReferenceIdentity(reference: ExternalReference, checker: ts.TypeChecker): ComponentTarget {
    const { origin, members, localName } = reference;
    const canonicalName = declarationName(origin.symbol, checker);
    const rootName =
      origin.importedName === "*"
        ? undefined
        : origin.importedName === "default"
          ? (canonicalName ?? "default")
          : (origin.importedName ?? canonicalName);
    const path = members.map(({ name }) => name);
    const title = rootName
      ? [rootName, ...path].join(".")
      : path.length > 0
        ? path.join(".")
        : (canonicalName ?? localName);
    return { id: `external:${origin.packageName}#${title}`, title, externalPackage: origin.packageName };
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
    const external = resolveExternalReference(expression, context, symbolOverride);
    if (!external) {
      const symbol = symbolOverride ?? checker.getSymbolAtLocation(expression);
      const definition = resolveDefinition(
        symbol,
        checker,
        context.definitionsBySymbol,
        context.definitionsByDeclaration,
      );
      return definition ? { id: definition.id, title: definition.name, definition } : undefined;
    }
    const target = externalReferenceIdentity(external, checker);
    if (target.externalPackage === "react" && /(?:^|\.)Fragment$/.test(target.title)) return undefined;
    const existing = context.externalTargets.get(target.id);
    if (existing) return existing;
    context.externalTargets.set(target.id, target);
    return target;
  }

  function componentUseId(ownerId: string, node: ts.Node, targetId: string, scopePath: string): string {
    return [
      ownerId,
      toPosixPath(relative(scopePath, node.getSourceFile().fileName)),
      node.pos,
      node.end,
      targetId,
    ].join("\0");
  }

  function ensureComponentUse(
    ownerId: string,
    node: ts.Node,
    target: ComponentTarget,
    context: AnalysisContext,
  ): ComponentUse {
    const id = componentUseId(ownerId, node, target.id, context.scopePath);
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
    const referenceSymbol = symbolOverride ?? context.checker.getSymbolAtLocation(unwrapped);
    const reference = referenceSymbol ? localImmutableReference(referenceSymbol, context, visitedSymbols) : undefined;
    if (!reference) return undefined;
    if (ts.isPropertyAccessExpression(unwrapped)) {
      const root = externalReferencePath(unwrapped)?.root;
      const rootSymbol = root ? context.checker.getSymbolAtLocation(root) : undefined;
      if (rootSymbol && externalSymbolOrigin(rootSymbol, context)) return undefined;
      // Local namespace barrels and aliases need member-level provenance. This
      // consumes ownership evidence, not the display identity of a graph node.
      if (resolveExternalReference(unwrapped, context, undefined, visitedSymbols)) return undefined;
    }
    if (
      resolveDefinition(referenceSymbol, context.checker, context.definitionsBySymbol, context.definitionsByDeclaration)
    ) {
      return undefined;
    }
    return reference;
  }

  function localImmutableReference(
    referenceSymbol: ts.Symbol,
    context: AnalysisContext,
    visitedSymbols: ReadonlySet<ts.Symbol>,
  ): Readonly<{ initializers: readonly ts.Expression[]; visitedSymbols: ReadonlySet<ts.Symbol> }> | undefined {
    // Following a component alias for provenance does not expand its render value.
    // Keep import-route ownership independent of whether a target member resolves.
    if (externalSymbolOrigin(referenceSymbol, context)) return undefined;
    const symbol = canonicalSymbol(referenceSymbol, context.checker);
    if (!symbol || visitedSymbols.has(symbol)) return undefined;
    const initializers = (symbol.declarations ?? []).flatMap((declaration) => {
      if (context.program.isSourceFileFromExternalLibrary(declaration.getSourceFile())) {
        return [];
      }
      // A default export binds its expression once per module, so it is as
      // immutable as a const initializer for static value tracing.
      if (ts.isExportAssignment(declaration)) return [declaration.expression];
      if (
        !ts.isVariableDeclaration(declaration) ||
        !declaration.initializer ||
        !ts.isVariableDeclarationList(declaration.parent) ||
        (declaration.parent.flags & ts.NodeFlags.Const) === 0
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
    const mutableSpreads = rules.spreads as Array<
      Readonly<{ excludedProps: ReadonlySet<string>; targetUseId: string; paths: DiagramControlPaths }>
    >;
    let activePaths: DiagramControlPaths = [[]];

    function terminal(propName: string, kind: TerminalRule["kind"]): void {
      addExactRule(rules, propName, { type: "terminal", kind, paths: activePaths });
    }

    function inActivePaths(path: DiagramControlPaths[number]): boolean {
      return activePaths.some((prefix) =>
        prefix.every((requirement) =>
          path.some(({ controlId, value }) => controlId === requirement.controlId && value === requirement.value),
        ),
      );
    }

    function removeActiveForwarding(matches: (rule: ForwardRule) => boolean): void {
      for (const [incomingPropName, existing] of rules.exact) {
        rules.exact.set(
          incomingPropName,
          existing.flatMap((rule) => {
            if (rule.type !== "forward" || !matches(rule)) return [rule];
            const paths = rule.paths.filter((path) => !inActivePaths(path));
            return paths.length > 0 ? [{ ...rule, paths }] : [];
          }),
        );
      }
    }

    function removeForwardingToProp(targetUseId: string, targetPropName: string): void {
      removeActiveForwarding((rule) => rule.targetUseId === targetUseId && rule.targetPropName === targetPropName);
      for (const [index, spread] of [...mutableSpreads].entries()) {
        if (spread.targetUseId !== targetUseId) continue;
        const paths = spread.paths.filter(inActivePaths);
        if (paths.length === 0) continue;
        const retained = spread.paths.filter((path) => !inActivePaths(path));
        if (retained.length > 0) mutableSpreads.push({ ...spread, paths: retained });
        mutableSpreads[index] = { ...spread, paths, excludedProps: new Set(spread.excludedProps).add(targetPropName) };
      }
    }

    function removeForwardingOverriddenBySpread(targetUseId: string, excludedProps: ReadonlySet<string>): void {
      removeActiveForwarding((rule) => rule.targetUseId === targetUseId && !excludedProps.has(rule.targetPropName));
    }

    function clearForwardingToTarget(targetUseId: string): void {
      removeActiveForwarding((rule) => rule.targetUseId === targetUseId);
      for (let index = mutableSpreads.length - 1; index >= 0; index -= 1) {
        const spread = mutableSpreads[index]!;
        if (spread.targetUseId !== targetUseId) continue;
        const paths = spread.paths.filter((path) => !inActivePaths(path));
        if (paths.length === 0) mutableSpreads.splice(index, 1);
        else mutableSpreads[index] = { ...spread, paths };
      }
    }

    function collectInvokedRenderProps(
      expression: ts.Expression,
      traverseRootFunction: boolean,
      initialPaths: DiagramControlPaths = activePaths,
    ): readonly { propName: string; paths: DiagramControlPaths }[] {
      const props = new Map<string, { propName: string; paths: DiagramControlPaths }>();
      const activeNodes = new Set<ts.Node>();
      function visit(node: ts.Node, paths: DiagramControlPaths, isRoot: boolean): void {
        if (activeNodes.has(node)) return;
        activeNodes.add(node);
        try {
          visitValue(node, paths, isRoot);
        } finally {
          activeNodes.delete(node);
        }
      }
      function visitValue(node: ts.Node, paths: DiagramControlPaths, isRoot: boolean): void {
        if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
          if (isRoot && traverseRootFunction)
            controlledReturns(node.body, definition.id, context, (value, next) => visit(value, next, false), paths);
          return;
        }
        if (ts.isFunctionLike(node)) return;
        if (
          ts.isExpression(node) &&
          controlledExpression(node, definition.id, paths, context, (value, next) => visit(value, next, false))
        )
          return;
        if (ts.isCallExpression(node)) {
          const propName = getIncomingProp(node.expression, bindings, context.checker);
          if (propName) {
            const entry = { propName, paths };
            props.set(JSON.stringify(entry), entry);
            return;
          }
        }
        if (ts.isExpression(node)) {
          const values = resolveAliasedValues(node, context);
          if (values.some((value) => value !== unwrapExpression(node))) {
            for (const value of values) visit(value, paths, isRoot);
            return;
          }
        }
        ts.forEachChild(node, (child) => visit(child, paths, false));
      }
      visit(expression, initialPaths, true);
      return [...props.values()];
    }

    function analyzeRenderPropInvocations(expression: ts.Expression): void {
      for (const { propName, paths } of collectInvokedRenderProps(expression, false))
        addExactRule(rules, propName, { type: "terminal", kind: "render-prop", paths });
    }

    function collectForwardedProps(
      expression: ts.Expression,
      symbolOverride?: ts.Symbol,
    ): readonly { propName: string; paths: DiagramControlPaths }[] {
      const props = new Map<string, { propName: string; paths: DiagramControlPaths }>();

      function collect(
        candidate: ts.Expression,
        paths: DiagramControlPaths,
        visitedSymbols: ReadonlySet<ts.Symbol>,
        candidateSymbol?: ts.Symbol,
      ): void {
        if (
          controlledExpression(candidate, definition.id, paths, context, (value, next) =>
            collect(value, next, visitedSymbols),
          )
        )
          return;
        const unwrapped = unwrapExpression(candidate);
        const directProp = candidateSymbol
          ? bindings.propSymbols.get(candidateSymbol)
          : getIncomingProp(unwrapped, bindings, context.checker);
        if (directProp) {
          const entry = { propName: directProp, paths };
          props.set(JSON.stringify(entry), entry);
          return;
        }
        const property = candidateSymbol ? undefined : staticObjectPropertyValue(unwrapped, context, visitedSymbols);
        if (property) {
          collect(property.value, paths, visitedSymbols, property.valueSymbol);
          return;
        }
        if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
          for (const entry of collectInvokedRenderProps(unwrapped, true, paths))
            props.set(JSON.stringify(entry), entry);
          return;
        }
        if (ts.isObjectLiteralExpression(unwrapped)) {
          for (const property of staticObjectPropertyValues(unwrapped, context))
            collect(property.value, paths, visitedSymbols, property.valueSymbol);
          return;
        }
        if (ts.isArrayLiteralExpression(unwrapped)) {
          for (const element of unwrapped.elements)
            if (ts.isExpression(element)) collect(element, paths, visitedSymbols);
          return;
        }
        const reference = localVariableReference(unwrapped, context, visitedSymbols, candidateSymbol);
        if (!reference) return;
        for (const initializer of reference.initializers) collect(initializer, paths, reference.visitedSymbols);
      }

      collect(expression, activePaths, new Set(), symbolOverride);
      return [...props.values()];
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
          for (const { propName, paths } of collectForwardedProps(expression)) {
            addExactRule(rules, propName, {
              type: "forward",
              targetUseId,
              targetPropName,
              paths,
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
            mutableSpreads.push({ excludedProps, targetUseId, paths: activePaths });
          }
          for (const forwarded of staticProperties.values.values()) {
            removeForwardingToProp(targetUseId, forwarded.propName);
            analyzeRenderPropInvocations(forwarded.value);
            for (const { propName, paths } of collectForwardedProps(forwarded.value, forwarded.valueSymbol)) {
              addExactRule(rules, propName, {
                type: "forward",
                targetUseId,
                targetPropName: forwarded.propName,
                paths,
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
        for (const { propName, paths } of collectForwardedProps(child.expression)) {
          addExactRule(rules, propName, { type: "forward", targetUseId, targetPropName: "children", paths });
        }
      }
    }

    function analyzeIntrinsicSpreadAttributes(attributes: ts.JsxAttributes, children: readonly ts.JsxChild[]): void {
      // Explicit JSX children override a children key arriving through a spread,
      // matching how createElement applies children after spread attributes.
      if (children.filter(isEffectiveJsxChild).length > 0) return;
      for (const property of attributes.properties) {
        if (ts.isJsxAttribute(property)) continue;
        for (const excludedProps of collectForwardedSpreadExclusions(property.expression)) {
          // A spread onto an intrinsic element delivers its children key into
          // the DOM tree, so forwarded children render under this component.
          if (!excludedProps.has("children")) terminal("children", "node-prop");
        }
      }
    }

    const activeExpressions = new Set<ts.Expression>();
    function analyzeRendered(expression: ts.Expression, paths: DiagramControlPaths = activePaths): void {
      if (activeExpressions.has(expression)) return;
      activeExpressions.add(expression);
      const previous = activePaths;
      activePaths = paths;
      try {
        if (!controlledExpression(expression, definition.id, paths, context, analyzeRendered))
          analyzeRenderedValue(expression);
      } finally {
        activePaths = previous;
        activeExpressions.delete(expression);
      }
    }

    function analyzeRenderedValue(expression: ts.Expression): void {
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
              controlledReturns(argument.body, definition.id, context, analyzeRendered, activePaths);
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
          analyzeIntrinsicSpreadAttributes(opening.attributes, ts.isJsxElement(unwrapped) ? unwrapped.children : []);
          return;
        }
        const target = targetForReference(opening.tagName, context);
        const targetUseId = target ? componentUseId(definition.id, unwrapped, target.id, context.scopePath) : undefined;
        analyzeJsxAttributes(opening.attributes, targetUseId, ts.isJsxElement(unwrapped) ? unwrapped.children : []);
        return;
      }

      if (ts.isArrayLiteralExpression(unwrapped)) {
        for (const element of unwrapped.elements) {
          if (ts.isExpression(element)) analyzeRendered(element);
        }
        return;
      }
      if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
        controlledReturns(unwrapped.body, definition.id, context, analyzeRendered, activePaths);
        return;
      }
      for (const value of resolveAliasedValues(unwrapped, context)) {
        if (value !== unwrapped) analyzeRendered(value);
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
      const targetUseId = target ? componentUseId(definition.id, call, target.id, context.scopePath) : undefined;
      if (propsExpression && targetUseId) {
        for (const excludedProps of collectForwardedSpreadExclusions(propsExpression)) {
          mutableSpreads.push({ excludedProps, targetUseId, paths: activePaths });
        }
        for (const forwarded of staticObjectPropertyValues(propsExpression, context)) {
          removeForwardingToProp(targetUseId, forwarded.propName);
          analyzeRenderPropInvocations(forwarded.value);
          for (const { propName, paths } of collectForwardedProps(forwarded.value, forwarded.valueSymbol)) {
            addExactRule(rules, propName, {
              type: "forward",
              targetUseId,
              targetPropName: forwarded.propName,
              paths,
            });
          }
        }
      }
      if (targetUseId && children.length > 0) removeForwardingToProp(targetUseId, "children");
      for (const child of children) {
        analyzeRenderPropInvocations(child);
        if (!targetUseId) continue;
        for (const { propName, paths } of collectForwardedProps(child)) {
          addExactRule(rules, propName, { type: "forward", targetUseId, targetPropName: "children", paths });
        }
      }
    }

    if (definition.body) controlledReturns(definition.body, definition.id, context, analyzeRendered);
    else for (const root of definition.renderRoots) analyzeRendered(root);
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
    initialPaths: DiagramControlPaths = [[]],
    pathsByUse: Map<string, DiagramControlPaths> = new Map(),
  ): readonly ComponentUse[] {
    const uses = new Map<string, ComponentUse>();
    controlledReturns(
      callback.body,
      ownerId,
      context,
      (expression, paths) => {
        for (const use of collectSuppliedUses([expression], ownerId, context, paths, pathsByUse)) uses.set(use.id, use);
      },
      initialPaths,
    );
    return [...uses.values()];
  }

  function collectSuppliedUses(
    expressions: readonly ts.Expression[],
    ownerId: string,
    context: AnalysisContext,
    initialPaths: DiagramControlPaths = [[]],
    pathsByUse: Map<string, DiagramControlPaths> = new Map(),
  ): readonly ComponentUse[] {
    const uses = new Map<string, ComponentUse>();

    const activeExpressions = new Set<ts.Expression>();
    function collect(
      expression: ts.Expression,
      paths: DiagramControlPaths,
      visitedSymbols: ReadonlySet<ts.Symbol> = new Set(),
    ): void {
      if (activeExpressions.has(expression)) return;
      activeExpressions.add(expression);
      try {
        collectValue(expression, paths, visitedSymbols);
      } finally {
        activeExpressions.delete(expression);
      }
    }
    function collectValue(
      expression: ts.Expression,
      paths: DiagramControlPaths,
      visitedSymbols: ReadonlySet<ts.Symbol>,
    ): void {
      if (
        controlledExpression(expression, ownerId, paths, context, (candidate, next) =>
          collect(candidate, next, visitedSymbols),
        )
      )
        return;
      const unwrapped = unwrapExpression(expression);
      if (ts.isJsxFragment(unwrapped)) {
        for (const child of unwrapped.children) collectChild(child, paths);
        return;
      }
      if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped)) {
        const opening = ts.isJsxElement(unwrapped) ? unwrapped.openingElement : unwrapped;
        if (isIntrinsicJsxTag(opening.tagName)) {
          if (ts.isJsxElement(unwrapped)) for (const child of unwrapped.children) collectChild(child, paths);
          return;
        }
        const target = targetForReference(opening.tagName, context);
        if (target) {
          const use = ensureComponentUse(ownerId, unwrapped, target, context);
          addUsePaths(context, use.id, paths, pathsByUse);
          analyzeJsxComponentUsage(unwrapped, use, context);
          uses.set(use.id, use);
        }
        return;
      }
      if (ts.isCallExpression(unwrapped) && isCreateElementCall(unwrapped, context.checker)) {
        const [tagExpression] = unwrapped.arguments;
        if (!tagExpression) return;
        if (ts.isStringLiteral(tagExpression)) {
          for (const child of unwrapped.arguments.slice(2)) collect(child, paths);
          return;
        }
        const target = targetForReference(tagExpression, context);
        if (target) {
          const use = ensureComponentUse(ownerId, unwrapped, target, context);
          addUsePaths(context, use.id, paths, pathsByUse);
          analyzeCreateElementUsage(unwrapped, use, context);
          uses.set(use.id, use);
        }
        return;
      }
      if (ts.isCallExpression(unwrapped) && isArrayRenderingMethodCall(unwrapped, context.checker)) {
        for (const argument of unwrapped.arguments) {
          if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
            controlledReturns(
              argument.body,
              ownerId,
              context,
              (returned, next) => collect(returned, next, visitedSymbols),
              paths,
            );
          }
        }
        return;
      }
      if (ts.isBinaryExpression(unwrapped)) {
        collect(unwrapped.right, paths, visitedSymbols);
        return;
      }
      if (ts.isArrayLiteralExpression(unwrapped)) {
        for (const element of unwrapped.elements) if (ts.isExpression(element)) collect(element, paths, visitedSymbols);
        return;
      }
      const reference = localVariableReference(unwrapped, context, visitedSymbols);
      if (!reference) return;
      for (const initializer of reference.initializers) collect(initializer, paths, reference.visitedSymbols);
    }

    function collectChild(child: ts.JsxChild, paths: DiagramControlPaths): void {
      if (ts.isJsxExpression(child) && child.expression) collect(child.expression, paths);
      else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child))
        collect(child, paths);
    }

    for (const expression of expressions) collect(expression, initialPaths);
    return [...uses.values()];
  }

  function componentReferenceUses(
    expression: ts.Expression,
    ownerId: string,
    context: AnalysisContext,
    symbolOverride?: ts.Symbol,
    pathsByUse: Map<string, DiagramControlPaths> = new Map(),
  ): readonly ComponentUse[] {
    const uses = new Map<string, ComponentUse>();

    function collect(
      candidate: ts.Expression,
      visitedSymbols: ReadonlySet<ts.Symbol>,
      candidateSymbol?: ts.Symbol,
      paths: DiagramControlPaths = [[]],
    ): void {
      if (
        controlledExpression(candidate, ownerId, paths, context, (expression, next) =>
          collect(expression, visitedSymbols, undefined, next),
        )
      )
        return;
      const unwrapped = unwrapExpression(candidate);
      if (ts.isObjectLiteralExpression(unwrapped)) {
        for (const property of unwrapped.properties) {
          if (ts.isPropertyAssignment(property)) collect(property.initializer, visitedSymbols, undefined, paths);
          else if (ts.isShorthandPropertyAssignment(property)) {
            collect(property.name, visitedSymbols, context.checker.getShorthandAssignmentValueSymbol(property), paths);
          } else if (ts.isSpreadAssignment(property)) collect(property.expression, visitedSymbols, undefined, paths);
        }
        return;
      }
      if (ts.isArrayLiteralExpression(unwrapped)) {
        for (const element of unwrapped.elements) {
          if (ts.isExpression(element)) collect(element, visitedSymbols, undefined, paths);
        }
        return;
      }
      if (!candidateSymbol && !ts.isIdentifier(unwrapped) && !ts.isPropertyAccessExpression(unwrapped)) return;

      const property = candidateSymbol ? undefined : staticObjectPropertyValue(unwrapped, context, visitedSymbols);
      if (property) {
        collect(property.value, visitedSymbols, property.valueSymbol, paths);
        return;
      }

      const target = targetForReference(unwrapped, context, candidateSymbol);
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
        addUsePaths(context, use.id, paths, pathsByUse);
        uses.set(use.id, use);
        return;
      }

      const reference = localVariableReference(unwrapped, context, visitedSymbols, candidateSymbol);
      if (!reference) return;
      for (const initializer of reference.initializers)
        collect(initializer, reference.visitedSymbols, undefined, paths);
    }

    collect(expression, new Set(), symbolOverride);
    return [...uses.values()];
  }

  function addSuppliedValue(
    receiver: ComponentUse,
    propName: string,
    kind: SuppliedValueKind,
    targets: readonly ComponentUse[],
    pathsByUse: ReadonlyMap<string, DiagramControlPaths>,
  ): void {
    if (targets.length === 0) return;
    receiver.suppliedValues.push({
      propName,
      kind,
      targets: targets.map(({ id }) => ({ useId: id, paths: pathsByUse.get(id) ?? [[]] })),
    });
  }

  function analyzeSuppliedValue(
    receiver: ComponentUse,
    propName: string,
    expression: ts.Expression,
    context: AnalysisContext,
    symbolOverride?: ts.Symbol,
  ): void {
    const pathsByUse = new Map<string, DiagramControlPaths>();
    const componentUses = componentReferenceUses(expression, receiver.ownerId, context, symbolOverride, pathsByUse);
    if (componentUses.length > 0) {
      addSuppliedValue(receiver, propName, "component-prop", componentUses, pathsByUse);
      return;
    }

    const values = resolveAliasedValues(expression, context, new Set(), symbolOverride);
    const renderUses = new Map<string, ComponentUse>();
    function collectCallbacks(value: ts.Expression, paths: DiagramControlPaths): void {
      if (controlledExpression(value, receiver.ownerId, paths, context, collectCallbacks)) return;
      const unwrapped = unwrapExpression(value);
      if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
        for (const use of returnedUses(unwrapped, receiver.ownerId, context, paths, pathsByUse))
          renderUses.set(use.id, use);
        return;
      }
      for (const candidate of resolveAliasedValues(unwrapped, context))
        if (candidate !== unwrapped) collectCallbacks(candidate, paths);
    }
    for (const value of values) collectCallbacks(value, [[]]);
    if (renderUses.size > 0) {
      addSuppliedValue(receiver, propName, "render-prop", [...renderUses.values()], pathsByUse);
      return;
    }

    addSuppliedValue(
      receiver,
      propName,
      "node-prop",
      collectSuppliedUses(values, receiver.ownerId, context, [[]], pathsByUse),
      pathsByUse,
    );
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

  function unionPaths(...sets: DiagramControlPaths[]): DiagramControlPaths {
    return unionControlPaths(...sets);
  }

  function combinePaths(left: DiagramControlPaths, right: DiagramControlPaths): DiagramControlPaths {
    return combineControlPaths(left, right);
  }

  function controlPaths(
    node: ts.Node,
    ownerId: string,
    label: string,
    when: DiagramControlPaths,
    context: AnalysisContext,
    alternatives?: { id: string; label: string }[],
  ): (value: string) => DiagramControlPaths {
    const suffix = createHash("sha256")
      .update(`${toPosixPath(relative(context.scopePath, node.getSourceFile().fileName))}:${node.pos}:${node.end}`)
      .digest("hex")
      .slice(0, 16);
    const id = `${ownerId}:control:${suffix}`;
    const existing = context.controls.get(id);
    const base = { id, owner: ownerId, label, dependsOn: unionPaths(existing?.dependsOn ?? [], when) };
    context.controls.set(
      id,
      alternatives ? { ...base, kind: "branch", cases: alternatives } : { ...base, kind: "conditional" },
    );
    return (value) => combinePaths(when, [[{ controlId: id, value }]]);
  }

  function isEmptyOutput(expression: ts.Expression, context: AnalysisContext): boolean {
    return resolveAliasedValues(expression, context).every(
      (unwrapped) =>
        unwrapped.kind === ts.SyntaxKind.NullKeyword ||
        unwrapped.kind === ts.SyntaxKind.FalseKeyword ||
        unwrapped.kind === ts.SyntaxKind.TrueKeyword ||
        (ts.isIdentifier(unwrapped) && unwrapped.text === "undefined") ||
        ts.isVoidExpression(unwrapped),
    );
  }

  function controlledExpression(
    expression: ts.Expression,
    ownerId: string,
    paths: DiagramControlPaths,
    context: AnalysisContext,
    visit: (expression: ts.Expression, paths: DiagramControlPaths) => void,
  ): boolean {
    const unwrapped = unwrapExpression(expression);
    if (ts.isConditionalExpression(unwrapped)) {
      const emptyTrue = isEmptyOutput(unwrapped.whenTrue, context);
      const emptyFalse = isEmptyOutput(unwrapped.whenFalse, context);
      if (emptyTrue && emptyFalse) return true;
      const label = unwrapped.condition.getText();
      const select = controlPaths(
        unwrapped,
        ownerId,
        emptyTrue ? `!(${label})` : label,
        paths,
        context,
        emptyTrue || emptyFalse
          ? undefined
          : [
              { id: "true", label },
              { id: "false", label: `!(${label})` },
            ],
      );
      if (!emptyTrue) visit(unwrapped.whenTrue, select(emptyFalse ? "on" : "true"));
      if (!emptyFalse) visit(unwrapped.whenFalse, select(emptyTrue ? "on" : "false"));
      return true;
    }
    if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      function conjunction(condition: ts.Expression, node: ts.Node, when: DiagramControlPaths): DiagramControlPaths {
        const guard = unwrapExpression(condition);
        if (ts.isBinaryExpression(guard) && guard.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
          const prerequisites = conjunction(guard.left, guard, when);
          return controlPaths(node, ownerId, guard.right.getText(), prerequisites, context)("on");
        }
        return controlPaths(node, ownerId, condition.getText(), when, context)("on");
      }
      visit(unwrapped.right, conjunction(unwrapped.left, unwrapped, paths));
      return true;
    }
    if (
      ts.isBinaryExpression(unwrapped) &&
      (unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      const nullish = unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken;
      const label = unwrapped.left.getText();
      const bindings = context.propBindings.get(ownerId);
      function hasOutput(expression: ts.Expression, visited: ReadonlySet<ts.Symbol> = new Set()): boolean {
        const candidate = unwrapExpression(expression);
        if (
          containsReactOutput(candidate, context.checker, visited) ||
          (bindings &&
            getIncomingProp(
              ts.isCallExpression(candidate) ? candidate.expression : candidate,
              bindings,
              context.checker,
            ))
        )
          return true;
        if (ts.isConditionalExpression(candidate))
          return hasOutput(candidate.whenTrue, visited) || hasOutput(candidate.whenFalse, visited);
        if (ts.isBinaryExpression(candidate))
          return (
            hasOutput(candidate.right, visited) ||
            ((candidate.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
              candidate.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) &&
              hasOutput(candidate.left, visited))
          );
        if (ts.isArrowFunction(candidate) || ts.isFunctionExpression(candidate))
          return collectReturnExpressions(candidate.body).some((returned) => hasOutput(returned, visited));
        const reference = localVariableReference(candidate, context, visited);
        if (reference)
          return reference.initializers.some((initializer) => hasOutput(initializer, reference.visitedSymbols));
        if (!ts.isIdentifier(candidate) && !ts.isPropertyAccessExpression(candidate)) return false;
        const target = targetForReference(candidate, context);
        if (target?.definition) return true;
        if (!target || !/^[A-Z]/.test(target.title.split(".").at(-1) ?? "")) return false;
        const valueType = context.checker.getTypeAtLocation(candidate);
        return valueType.getCallSignatures().length + valueType.getConstructSignatures().length > 0;
      }
      const hasLeftOutput = hasOutput(unwrapped.left);
      const select = controlPaths(
        unwrapped,
        ownerId,
        hasLeftOutput ? label : nullish ? `${label} == null` : `!(${label})`,
        paths,
        context,
        hasLeftOutput
          ? [
              { id: "left", label },
              { id: "right", label: nullish ? `${label} == null` : `!(${label})` },
            ]
          : undefined,
      );
      if (hasLeftOutput) visit(unwrapped.left, select("left"));
      visit(unwrapped.right, select(hasLeftOutput ? "right" : "on"));
      return true;
    }
    return false;
  }

  function controlledReturns(
    body: ts.ConciseBody,
    ownerId: string,
    context: AnalysisContext,
    visit: (expression: ts.Expression, paths: DiagramControlPaths) => void,
    initialPaths: DiagramControlPaths = [[]],
  ): void {
    if (!ts.isBlock(body)) {
      visit(body, initialPaths);
      return;
    }
    const statementsOf = (statement: ts.Statement | undefined): readonly ts.Statement[] =>
      !statement ? [] : ts.isBlock(statement) ? statement.statements : [statement];
    function hasExit(node: ts.Node): boolean {
      if (ts.isFunctionLike(node)) return false;
      if (ts.isReturnStatement(node) || ts.isBreakStatement(node) || ts.isThrowStatement(node)) return true;
      let found = false;
      ts.forEachChild(node, (child) => {
        if (hasExit(child)) found = true;
      });
      return found;
    }
    function mayRender(statements: readonly ts.Statement[], breakContinuation: readonly ts.Statement[] = []): boolean {
      for (const [index, statement] of statements.entries()) {
        const tail = statements.slice(index + 1);
        if (ts.isReturnStatement(statement))
          return !!statement.expression && !isEmptyOutput(statement.expression, context);
        if (ts.isBlock(statement)) return mayRender([...statement.statements, ...tail], breakContinuation);
        if (ts.isIfStatement(statement))
          return (
            mayRender([...statementsOf(statement.thenStatement), ...tail], breakContinuation) ||
            mayRender([...statementsOf(statement.elseStatement), ...tail], breakContinuation)
          );
        if (ts.isSwitchStatement(statement))
          return statement.caseBlock.clauses.some((clause) => mayRender([...clause.statements, ...tail], tail));
        if (ts.isBreakStatement(statement)) return mayRender(breakContinuation);
        if (ts.isThrowStatement(statement)) return false;
      }
      return false;
    }
    type Flow = { next: DiagramControlPaths; breaks: DiagramControlPaths };
    function walk(
      statements: readonly ts.Statement[],
      initial: DiagramControlPaths,
      breakContinuation: readonly ts.Statement[] = [],
      continuation: readonly ts.Statement[] = [],
    ): Flow {
      let next = initial;
      let breaks: DiagramControlPaths = [];
      for (const [index, statement] of statements.entries()) {
        if (next.length === 0) break;
        if (ts.isReturnStatement(statement)) {
          if (statement.expression) visit(statement.expression, next);
          next = [];
        } else if (ts.isThrowStatement(statement)) {
          next = [];
        } else if (ts.isBreakStatement(statement)) {
          breaks = unionPaths(breaks, next);
          next = [];
        } else if (ts.isBlock(statement)) {
          const flow = walk(statement.statements, next, breakContinuation, [
            ...statements.slice(index + 1),
            ...continuation,
          ]);
          next = flow.next;
          breaks = unionPaths(breaks, flow.breaks);
        } else if (
          ts.isIfStatement(statement) &&
          (hasExit(statement.thenStatement) || (statement.elseStatement && hasExit(statement.elseStatement)))
        ) {
          const tail = [...statements.slice(index + 1), ...continuation];
          const trueOutput = mayRender([...statementsOf(statement.thenStatement), ...tail], breakContinuation);
          const falseOutput = mayRender([...statementsOf(statement.elseStatement), ...tail], breakContinuation);
          if (!trueOutput && !falseOutput) {
            next = [];
            continue;
          }
          const label = statement.expression.getText();
          const select = controlPaths(
            statement,
            ownerId,
            trueOutput ? label : `!(${label})`,
            next,
            context,
            trueOutput && falseOutput
              ? [
                  { id: "true", label },
                  { id: "false", label: `!(${label})` },
                ]
              : undefined,
          );
          const thenFlow = walk(
            statementsOf(statement.thenStatement),
            select(trueOutput && falseOutput ? "true" : trueOutput ? "on" : "off"),
            breakContinuation,
            tail,
          );
          const elseFlow = walk(
            statementsOf(statement.elseStatement),
            select(trueOutput && falseOutput ? "false" : falseOutput ? "on" : "off"),
            breakContinuation,
            tail,
          );
          next = unionPaths(thenFlow.next, elseFlow.next);
          breaks = unionPaths(breaks, thenFlow.breaks, elseFlow.breaks);
        } else if (ts.isSwitchStatement(statement)) {
          const clauses = statement.caseBlock.clauses;
          if (clauses.length === 0) continue;
          const alternatives = clauses.map((clause, clauseIndex) => ({
            id: `case:${clauseIndex}`,
            label: ts.isCaseClause(clause) ? clause.expression.getText() : "default",
          }));
          const noDefault = !clauses.some(ts.isDefaultClause);
          if (noDefault) alternatives.push({ id: `case:${clauses.length}`, label: "default" });
          const tail = [...statements.slice(index + 1), ...continuation];
          if (alternatives.length === 1) {
            const flow = walk(clauses.at(0)!.statements, next, tail, tail);
            next = unionPaths(flow.next, flow.breaks);
            continue;
          }
          const select = controlPaths(statement, ownerId, statement.expression.getText(), next, context, alternatives);
          let fallthrough: DiagramControlPaths = [];
          let exits: DiagramControlPaths = noDefault ? select(`case:${clauses.length}`) : [];
          for (const [clauseIndex, clause] of clauses.entries()) {
            const flow = walk(clause.statements, unionPaths(fallthrough, select(`case:${clauseIndex}`)), tail, [
              ...clauses.slice(clauseIndex + 1).flatMap((nextClause) => [...nextClause.statements]),
              ...tail,
            ]);
            fallthrough = flow.next;
            exits = unionPaths(exits, flow.breaks);
          }
          next = unionPaths(exits, fallthrough);
        } else if (!ts.isFunctionLike(statement)) {
          // Preserve relationship discovery without inventing loop or exception controls.
          for (const expression of collectReturnExpressions(statement)) visit(expression, next);
        }
      }
      return { next, breaks };
    }
    walk(body.statements, initialPaths);
  }

  function addUsePaths(
    context: AnalysisContext,
    useId: string,
    paths: DiagramControlPaths,
    pathsByUse: Map<string, DiagramControlPaths> = context.usePaths,
  ): void {
    pathsByUse.set(useId, unionPaths(pathsByUse.get(useId) ?? [], paths));
  }

  function analyzeDefinitionUsages(definition: ComponentDefinition, context: AnalysisContext): void {
    const activeExpressions = new Set<ts.Expression>();
    function analyzeRendered(expression: ts.Expression, paths: DiagramControlPaths = [[]]): void {
      if (activeExpressions.has(expression)) return;
      activeExpressions.add(expression);
      try {
        analyzeRenderedValue(expression, paths);
      } finally {
        activeExpressions.delete(expression);
      }
    }
    function analyzeRenderedValue(expression: ts.Expression, paths: DiagramControlPaths): void {
      if (controlledExpression(expression, definition.id, paths, context, analyzeRendered)) return;
      const unwrapped = unwrapExpression(expression);
      if (ts.isJsxFragment(unwrapped)) {
        for (const child of unwrapped.children) analyzeChild(child, paths);
        return;
      }
      if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped)) {
        const opening = ts.isJsxElement(unwrapped) ? unwrapped.openingElement : unwrapped;
        if (isIntrinsicJsxTag(opening.tagName)) {
          if (ts.isJsxElement(unwrapped)) for (const child of unwrapped.children) analyzeChild(child, paths);
          return;
        }
        const target = targetForReference(opening.tagName, context);
        if (!target) {
          // Unresolved tags (context providers, third-party macros) still wrap
          // children that must be traced, matching the intrinsic branch.
          if (ts.isJsxElement(unwrapped)) for (const child of unwrapped.children) analyzeChild(child, paths);
          return;
        }
        const use = ensureComponentUse(definition.id, unwrapped, target, context);
        addDirectUse(context, use);
        addUsePaths(context, use.id, paths);
        analyzeJsxComponentUsage(unwrapped, use, context);
        return;
      }
      if (ts.isCallExpression(unwrapped) && isCreateElementCall(unwrapped, context.checker)) {
        const [tagExpression] = unwrapped.arguments;
        if (!tagExpression) return;
        if (ts.isStringLiteral(tagExpression)) {
          for (const child of unwrapped.arguments.slice(2)) analyzeRendered(child, paths);
          return;
        }
        const target = targetForReference(tagExpression, context);
        if (!target) return;
        const use = ensureComponentUse(definition.id, unwrapped, target, context);
        addDirectUse(context, use);
        addUsePaths(context, use.id, paths);
        analyzeCreateElementUsage(unwrapped, use, context);
        return;
      }
      if (ts.isArrayLiteralExpression(unwrapped)) {
        for (const element of unwrapped.elements) if (ts.isExpression(element)) analyzeRendered(element, paths);
        return;
      }
      if (ts.isCallExpression(unwrapped) && isArrayRenderingMethodCall(unwrapped, context.checker)) {
        for (const argument of unwrapped.arguments) {
          if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
            controlledReturns(argument.body, definition.id, context, analyzeRendered, paths);
          }
        }
        return;
      }
      const reference = localVariableReference(unwrapped, context, new Set());
      if (reference) for (const initializer of reference.initializers) analyzeRendered(initializer, paths);
    }

    function analyzeChild(child: ts.JsxChild, paths: DiagramControlPaths): void {
      if (ts.isJsxExpression(child) && child.expression) analyzeRendered(child.expression, paths);
      else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
        analyzeRendered(child, paths);
      }
    }

    if (definition.body) controlledReturns(definition.body, definition.id, context, analyzeRendered);
    else for (const root of definition.renderRoots) analyzeRendered(root);
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
    const step = {
      useId: receiverUse.id,
      componentId: receiverUse.target.id,
      propName,
      paths: [[]],
    } satisfies ConsumerRouteStep;
    const rules = rulesByComponentId.get(receiverUse.target.id);
    if (!rules) {
      if (kind === "render-prop" && /^on[A-Z]/.test(propName)) return [];
      return [{ kind, steps: [step] }];
    }
    const candidates = [
      ...(rules.exact.get(propName) ?? []),
      ...rules.spreads
        .filter(({ excludedProps }) => !excludedProps.has(propName))
        .map(({ targetUseId, paths }): ForwardRule => ({
          type: "forward",
          targetUseId,
          targetPropName: propName,
          paths,
        })),
    ];
    const routes = new Map<string, ConsumerRoute>();

    for (const rule of candidates) {
      if (rule.type === "terminal") {
        if (rule.kind === kind) {
          const route = { kind, steps: [{ ...step, paths: rule.paths }] } satisfies ConsumerRoute;
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
        const route = { kind, steps: [{ ...step, paths: rule.paths }, ...downstream.steps] } satisfies ConsumerRoute;
        routes.set(JSON.stringify(route), route);
      }
    }

    return [...routes.values()];
  }

  function edgeId(relationship: Relationship): string {
    const key =
      relationship.kind === "direct-render"
        ? relationshipKey(relationship)
        : `${relationshipKey(relationship)}\0${relationship.supplierIds.join("\0")}`;
    return `edge:${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
  }

  function sourceHref(relativePath: string): string {
    return `source:///${relativePath.split("/").map(encodeURIComponent).join("/")}`;
  }

  function matchesComponentPattern(id: string, title: string, patterns: readonly string[]): boolean {
    // Ordered matching so a later negation pattern re-includes earlier matches.
    return micromatch.match([title, id], patterns).length > 0;
  }

  function createVisibilityByTarget(
    definitions: readonly ComponentDefinition[],
    externalTargets: ReadonlyMap<string, ComponentTarget>,
    excludeFilePatterns: readonly string[],
    excludeComponentPatterns: readonly string[],
  ): ReadonlyMap<string, ComponentVisibility> {
    const excludeFileRules = excludeFilePatterns.length > 0 ? ignore().add([...excludeFilePatterns]) : undefined;
    const visibility = new Map<string, ComponentVisibility>();
    for (const definition of definitions) {
      const hidden =
        (excludeFileRules?.ignores(definition.relativePath) ?? false) ||
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
  ): Readonly<{
    instances: readonly ComponentInstance[];
    relationships: readonly Relationship[];
    controls: DiagramControl[];
    roots: string[];
  }> {
    const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
    const visibleInstances = new Map<string, ComponentInstance>();
    const visibleDefinitionIds = new Set<string>();
    const relationships = new Map<string, Relationship>();
    const controls = new Map<string, DiagramControl>();
    const roots: string[] = [];

    function instantiatePaths(
      paths: DiagramControlPaths,
      instance: ComponentInstance,
      source: ComponentInstance,
      prerequisites: DiagramControlPaths = [[]],
    ): DiagramControlPaths {
      return paths.map((path) =>
        path.map(({ controlId, value }) => {
          const template = context.controls.get(controlId)!;
          const id = `${instance.id}:control:${controlId.split(":control:").at(-1)}`;
          const when = combinePaths(
            prerequisites,
            instantiatePaths(template.dependsOn, instance, source, prerequisites),
          );
          const existing = controls.get(id);
          controls.set(id, {
            ...template,
            id,
            owner: source.id,
            dependsOn: unionPaths(existing?.dependsOn ?? [], when),
          });
          return { controlId: id, value };
        }),
      );
    }

    function targetVisibility(targetId: string): ComponentVisibility {
      return visibility.get(targetId) ?? { boundaryVisible: false, implementationAnalyzed: false };
    }

    function createInstance(id: string, target: ComponentTarget, owner?: ComponentInstance): ComponentInstance {
      const ancestors = new Map(owner?.ancestors);
      const instance = { id, target, ancestors, uses: new Map<string, ComponentInstance>() };
      ancestors.set(target.id, instance);
      return instance;
    }

    function ensureComponentInstance(
      parent: ComponentInstance,
      use: ComponentUse,
      owner: ComponentInstance,
    ): ComponentInstance {
      const existing = parent.uses.get(use.id);
      if (existing) return existing;
      // Follow the definition expansion path, not the visual parent path:
      // explicitly nested JSX of the same component is not definition recursion.
      const ancestor = owner.ancestors.get(use.target.id);
      const suffix = createHash("sha256").update(`${parent.id}\0${use.id}`).digest("hex").slice(0, 16);
      const instance = ancestor ?? createInstance(`${use.target.id}@${suffix}`, use.target, owner);
      parent.uses.set(use.id, instance);
      return instance;
    }

    function addFinalRelationship(relationship: Relationship): void {
      const key = relationshipKey(relationship);
      const existing = relationships.get(key);
      if (!existing) {
        relationships.set(key, relationship);
        return;
      }
      const paths = unionPaths(existing.paths, relationship.paths);
      relationships.set(
        key,
        existing.kind === "direct-render" || relationship.kind === "direct-render"
          ? { ...relationship, paths }
          : {
              ...relationship,
              paths,
              supplierIds: [...new Set([...existing.supplierIds, ...relationship.supplierIds])].toSorted(),
              origins: [
                ...new Map(
                  [...existing.origins, ...relationship.origins].map((origin) => [JSON.stringify(origin), origin]),
                ).values(),
              ],
            },
      );
    }

    function makeVisible(instance: ComponentInstance): void {
      const policy = targetVisibility(instance.target.id);
      if (!policy.boundaryVisible || visibleInstances.has(instance.id)) return;
      visibleInstances.set(instance.id, instance);
      visibleDefinitionIds.add(instance.target.id);
      if (!instance.target.definition || !policy.implementationAnalyzed) return;
      for (const useId of context.directUseIdsByOwner.get(instance.target.id) ?? []) {
        const use = context.uses.get(useId);
        if (use) processDirectUse(instance, use);
      }
    }

    function processSuppliedTarget(
      targetUse: ComponentUse,
      parent: ComponentInstance,
      source: ComponentInstance,
      owner: ComponentInstance,
      kind: SuppliedValueKind,
      propName: string,
      originPropName: string,
      trail: ReadonlySet<string>,
      paths: DiagramControlPaths,
      targetUsePaths: DiagramControlPaths,
    ): void {
      const visitKey = [targetUse.id, source.id, kind, propName].join("\0");
      if (trail.has(visitKey)) return;
      const nextTrail = new Set(trail).add(visitKey);
      const instance = ensureComponentInstance(parent, targetUse, owner);
      const policy = targetVisibility(targetUse.target.id);
      const supplierSource = targetVisibility(owner.target.id).boundaryVisible ? owner : source;
      const targetPaths = combinePaths(instantiatePaths(targetUsePaths, owner, supplierSource), paths);
      if (!policy.boundaryVisible) {
        processUseSupplies(targetUse, instance, source, owner, nextTrail, { kind, propName }, targetPaths);
        return;
      }

      makeVisible(instance);
      addFinalRelationship({
        source: source.id,
        target: instance.id,
        kind,
        propName,
        supplierIds: [targetUse.ownerId],
        origins: [{ supplierId: targetUse.ownerId, prop: originPropName }],
        paths: targetPaths,
      });
      processUseSupplies(targetUse, instance, instance, owner, nextTrail);
    }

    function processUseSupplies(
      receiverUse: ComponentUse,
      receiver: ComponentInstance,
      fallbackSource: ComponentInstance,
      owner: ComponentInstance,
      trail: ReadonlySet<string> = new Set(),
      inherited?: Readonly<{ kind: SuppliedValueKind; propName: string }>,
      inheritedPaths: DiagramControlPaths = [[]],
    ): void {
      const receiverVisible = targetVisibility(receiverUse.target.id).boundaryVisible;
      for (const supplied of receiverUse.suppliedValues) {
        const routes = resolveConsumerRoutes(
          receiverUse,
          supplied.propName,
          supplied.kind,
          rulesByComponentId,
          context,
        );
        if (routes.length === 0) continue;

        for (const route of routes) {
          let consumer = receiver;
          let source = fallbackSource;
          let propName = inherited?.propName ?? supplied.propName;
          let visiblePath = receiverVisible;
          let routePaths = inheritedPaths;
          for (const [index, step] of route.steps.entries()) {
            if (index > 0) {
              const use = context.uses.get(step.useId)!;
              consumer = ensureComponentInstance(consumer, use, consumer);
            }
            // Hidden boundaries stop visual ownership, not usage-path identity.
            visiblePath &&= targetVisibility(step.componentId).boundaryVisible;
            if (visiblePath) {
              source = consumer;
              propName = step.propName;
            }
            routePaths = combinePaths(routePaths, instantiatePaths(step.paths, consumer, source, routePaths));
          }
          for (const suppliedTarget of supplied.targets) {
            const targetUse = context.uses.get(suppliedTarget.useId);
            if (targetUse) {
              processSuppliedTarget(
                targetUse,
                consumer,
                source,
                owner,
                inherited?.kind ?? route.kind,
                propName,
                supplied.propName,
                trail,
                routePaths,
                suppliedTarget.paths,
              );
            }
          }
        }
      }
    }

    function processDirectUse(source: ComponentInstance, use: ComponentUse): void {
      const instance = ensureComponentInstance(source, use, source);
      const policy = targetVisibility(use.target.id);
      const paths = instantiatePaths(context.usePaths.get(use.id) ?? [[]], source, source);
      if (policy.boundaryVisible) {
        makeVisible(instance);
        addFinalRelationship({ source: source.id, target: instance.id, kind: "direct-render", paths });
      }
      processUseSupplies(use, instance, source, source, new Set(), undefined, policy.boundaryVisible ? [[]] : paths);
    }

    for (const rootId of sourceDefinitionIds(definitions, context.uses)) {
      const definition = definitionsById.get(rootId);
      if (!definition || visibleDefinitionIds.has(rootId) || !targetVisibility(rootId).boundaryVisible) continue;
      roots.push(rootId);
      makeVisible(createInstance(rootId, { id: definition.id, title: definition.name, definition }));
    }

    return {
      instances: [...visibleInstances.values()],
      controls: [...controls.values()],
      roots,
      relationships: [...relationships.values()].toSorted((left, right) =>
        relationshipKey(left).localeCompare(relationshipKey(right)),
      ),
    };
  }

  function createGraph(
    definitions: readonly ComponentDefinition[],
    instances: readonly ComponentInstance[],
    relationships: readonly Relationship[],
    controls: DiagramControl[],
    roots: string[],
  ): DiagramGraph {
    const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
    function componentMetadata(id: string, definitionId: string): DefaultDiagramNode["component"] {
      const origins = relationships.flatMap((relationship) =>
        relationship.target === id && relationship.kind !== "direct-render"
          ? relationship.origins.map(({ supplierId, prop }) => ({
              supplierId,
              supplierTitle: definitionsById.get(supplierId)?.name ?? supplierId,
              prop,
            }))
          : [],
      );
      return {
        definitionId,
        origins: [...new Map(origins.map((origin) => [JSON.stringify(origin), origin])).values()],
      };
    }
    const localNodes = instances.flatMap(({ id, target }): DefaultDiagramNode[] => {
      const definition = target.definition;
      return definition
        ? [
            {
              type: "default",
              id,
              title: definition.name,
              description: definition.relativePath,
              links: [{ href: sourceHref(definition.relativePath) }],
              component: componentMetadata(id, target.id),
            },
          ]
        : [];
    });
    if (localNodes.length === 0) throw new Error("No React component definitions remain after filtering.");

    const externalNodes = instances
      .filter(({ target }) => !target.definition)
      .map(({ id, target }): DefaultDiagramNode => ({
        type: "default",
        id,
        title: target.title,
        description: `${target.externalPackage} boundary`,
        component: componentMetadata(id, target.id),
      }));
    const candidateNodeIds = new Set([...localNodes, ...externalNodes].map(({ id }) => id));
    const edges: DefaultDiagramEdge[] = relationships
      .filter(({ source, target }) => candidateNodeIds.has(source) && candidateNodeIds.has(target))
      .map((relationship): DefaultDiagramEdge => ({
        type: "default",
        id: edgeId(relationship),
        source: relationship.source,
        target: relationship.target,
        activeWhen: relationship.paths,
      }))
      .toSorted((left, right) => left.id.localeCompare(right.id));
    const nodes = [...localNodes, ...externalNodes].toSorted((left, right) => left.id.localeCompare(right.id));

    return { groups: [], nodes, edges, roots, controls };
  }

  function focusGraphOnRoots(
    graph: DiagramGraph,
    rootPatterns: readonly string[],
    instances: readonly ComponentInstance[],
  ): DiagramGraph {
    const targetsByInstanceId = new Map(instances.map(({ id, target }) => [id, target]));
    const roots = graph.nodes.filter(({ id, title }) =>
      rootPatterns.some(
        (pattern) =>
          matchesComponentPattern(targetsByInstanceId.get(id)!.id, title, [pattern]) ||
          matchesComponentPattern(id, title, [pattern]),
      ),
    );
    if (roots.length === 0) {
      throw new Error(`No visible component matches the --root pattern: ${rootPatterns.join(", ")}`);
    }

    const reachable = new Set(roots.map(({ id }) => id));
    const targetsBySource = new Map<string, string[]>();
    for (const { source, target } of graph.edges) {
      targetsBySource.set(source, [...(targetsBySource.get(source) ?? []), target]);
    }
    const queue = [...reachable];
    while (queue.length > 0) {
      const current = queue.pop() as string;
      for (const target of targetsBySource.get(current) ?? []) {
        if (!reachable.has(target)) {
          reachable.add(target);
          queue.push(target);
        }
      }
    }

    return {
      ...graph,
      nodes: graph.nodes.filter(({ id }) => reachable.has(id)),
      edges: graph.edges.filter(({ source, target }) => reachable.has(source) && reachable.has(target)),
      roots: roots.map(({ id }) => id),
      controls: graph.controls!,
    };
  }

  function mergeEquivalentContexts(
    graph: DiagramGraph,
    instances: readonly ComponentInstance[],
    relationships: readonly Relationship[],
  ): DiagramGraph {
    const targetsByInstanceId = new Map(instances.map(({ id, target }) => [id, target]));
    const relationshipsByEdgeId = new Map(relationships.map((relationship) => [edgeId(relationship), relationship]));
    // A component whose render output includes elements supplied by an
    // ancestor — a node, render prop, or component prop — is customized per
    // usage, so every usage keeps its own node. Supplied values themselves stay
    // mergeable: they are the reused content, not the customized receiver. The
    // relationship binds the final renderer as its source, so flag sources.
    const suppliedRenderers = new Set(
      relationships.filter(({ kind }) => kind !== "direct-render").map(({ source }) => source),
    );
    const edgesBySource = new Map<string, (typeof graph.edges)[number][]>();
    for (const edge of graph.edges) {
      const edges = edgesBySource.get(edge.source) ?? [];
      edges.push(edge);
      edgesBySource.set(edge.source, edges);
    }
    const visibleIds = new Set(graph.nodes.map(({ id }) => id));
    const availableControls = new Map(
      graph.controls!.filter(({ owner }) => visibleIds.has(owner)).map((control) => [control.id, control]),
    );
    const neededControls = new Set<string>();
    function requireControls(paths: DiagramControlPaths): void {
      for (const { controlId } of paths.flat()) {
        const control = availableControls.get(controlId);
        if (!control || neededControls.has(controlId)) continue;
        neededControls.add(controlId);
        requireControls(control.dependsOn);
      }
    }
    for (const edge of graph.edges) if (edge.type === "default") requireControls(edge.activeWhen ?? [[]]);
    const controls = graph.controls!.filter(({ id }) => neededControls.has(id));
    const controlsByOwner = new Map<string, DiagramControl[]>();
    const controlKeys = new Map<string, string>();
    for (const control of controls) {
      const owned = controlsByOwner.get(control.owner) ?? [];
      controlKeys.set(control.id, String(owned.length));
      owned.push(control);
      controlsByOwner.set(control.owner, owned);
    }
    const controlsById = new Map(controls.map((control) => [control.id, control]));
    const normalizePaths = (paths: DiagramControlPaths, classes: ReadonlyMap<string, string>) =>
      paths.map((path) =>
        path
          .filter(({ controlId }) => controlsById.has(controlId))
          .map(({ controlId, value }) => ({
            controlId: `${classes.get(controlsById.get(controlId)!.owner)}:${controlKeys.get(controlId)}`,
            value,
          })),
      );
    let classes = new Map(graph.nodes.map(({ id }) => [id, targetsByInstanceId.get(id)!.id]));

    // Refine whole outgoing structures to a fixed point, including recursive compositions.
    // The previous class prevents distinct contexts from being merged on a later pass.
    for (;;) {
      const representatives = new Map<string, string>();
      const refined = new Map<string, string>();
      for (const node of graph.nodes) {
        const outgoing = (edgesBySource.get(node.id) ?? []).map((edge) => {
          const { id, source: _source, target, ...metadata } = edge;
          const relationship = relationshipsByEdgeId.get(id)!;
          const suppliers = relationship.kind === "direct-render" ? [] : relationship.supplierIds;
          return JSON.stringify([
            {
              ...metadata,
              activeWhen: normalizePaths(edge.type === "default" ? (edge.activeWhen ?? [[]]) : [[]], classes),
            },
            suppliers,
            classes.get(target),
          ]);
        });
        const ownedControls = (controlsByOwner.get(node.id) ?? []).map(
          ({ id: _id, owner: _owner, dependsOn, ...metadata }) => ({
            ...metadata,
            dependsOn: normalizePaths(dependsOn, classes),
          }),
        );
        const signature = JSON.stringify([
          classes.get(node.id),
          // Supplied renderers carry their own instance id: structurally
          // identical receivers still stay apart, one node per customizing
          // usage.
          ...(suppliedRenderers.has(node.id) ? [node.id] : []),
          ownedControls,
          [...new Set(outgoing)].toSorted(),
        ]);
        if (!representatives.has(signature)) representatives.set(signature, node.id);
        refined.set(node.id, representatives.get(signature)!);
      }
      if (graph.nodes.every(({ id }) => refined.get(id) === classes.get(id))) break;
      classes = refined;
    }

    const classesByDefinition = new Map<string, Set<string>>();
    for (const node of graph.nodes) {
      const definitionId = targetsByInstanceId.get(node.id)!.id;
      const contexts = classesByDefinition.get(definitionId) ?? new Set<string>();
      contexts.add(classes.get(node.id)!);
      classesByDefinition.set(definitionId, contexts);
    }
    const outputIds = new Map(
      graph.nodes.map(({ id }) => {
        const definitionId = targetsByInstanceId.get(id)!.id;
        return [id, classesByDefinition.get(definitionId)!.size === 1 ? definitionId : classes.get(id)!];
      }),
    );
    const nodes = graph.nodes
      .filter(({ id }) => classes.get(id) === id)
      .map((node) => {
        if (node.type !== "default") return { ...node, id: outputIds.get(node.id)! };
        const origins = graph.nodes.flatMap((candidate) =>
          candidate.type === "default" && classes.get(candidate.id) === node.id ? candidate.component!.origins : [],
        );
        return {
          ...node,
          id: outputIds.get(node.id)!,
          component: {
            ...node.component!,
            origins: [...new Map(origins.map((origin) => [JSON.stringify(origin), origin])).values()],
          },
        };
      })
      .toSorted((left, right) => left.id.localeCompare(right.id));
    const outputControlIds = new Map(
      controls.map((control) => [control.id, `${outputIds.get(control.owner)}:control:${controlKeys.get(control.id)}`]),
    );
    const rewritePaths = (paths: DiagramControlPaths): DiagramControlPaths =>
      unionPaths(
        paths.map((path) =>
          path
            .filter(({ controlId }) => outputControlIds.has(controlId))
            .map(({ controlId, value }) => ({ controlId: outputControlIds.get(controlId)!, value })),
        ),
      );
    const outputControls = new Map<string, DiagramControl>();
    for (const control of controls) {
      const id = outputControlIds.get(control.id)!;
      const existing = outputControls.get(id);
      outputControls.set(id, {
        ...control,
        id,
        owner: outputIds.get(control.owner)!,
        dependsOn: unionPaths(existing?.dependsOn ?? [], rewritePaths(control.dependsOn)),
      });
    }
    const edges = new Map<string, (typeof graph.edges)[number]>();
    for (const edge of graph.edges) {
      const source = outputIds.get(edge.source)!;
      const target = outputIds.get(edge.target)!;
      const id = edgeId({ ...relationshipsByEdgeId.get(edge.id)!, source, target });
      const existing = edges.get(id);
      const paths = edge.type === "default" ? rewritePaths(edge.activeWhen ?? [[]]) : [[]];
      edges.set(id, {
        ...edge,
        id,
        source,
        target,
        ...(edge.type === "default"
          ? { activeWhen: unionPaths(existing?.type === "default" ? (existing.activeWhen ?? []) : [], paths) }
          : {}),
      });
    }
    return {
      ...graph,
      nodes,
      edges: [...edges.values()].toSorted((left, right) => left.id.localeCompare(right.id)),
      roots: [...new Set(graph.roots!.map((id) => outputIds.get(id)!))],
      controls: [...outputControls.values()],
    };
  }

  async function buildComponentGraph(options: ComponentGraphOptions): Promise<DiagramGraph> {
    const scopePath = options.scopePath;
    const sourceFilePaths = await collectSourceFiles(scopePath, options.sourcePaths);
    if (sourceFilePaths.length === 0)
      throw new Error("No JS, JSX, TS, or TSX source files matched the selected paths.");
    const compilerOptions = await readCompilerOptions(scopePath, options.tsconfigPath);
    const host = ts.createCompilerHost(compilerOptions);
    host.getCurrentDirectory = () => scopePath;
    const program = ts.createProgram({
      rootNames: sourceFilePaths,
      options: compilerOptions,
      host,
    });
    const programErrors = [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()];
    if (programErrors.length > 0) {
      throw new Error(`Cannot initialize TypeScript analysis: ${programErrors.map(formatDiagnostic).join("\n")}`);
    }
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
      scopePath,
      program,
      host,
      checker,
      definitionsBySymbol,
      definitionsByDeclaration,
      externalTargets: new Map(),
      uses: new Map(),
      directUseIdsByOwner: new Map(),
      analyzedUseIds: new Set(),
      controls: new Map(),
      usePaths: new Map(),
      propBindings: new Map(definitions.map((definition) => [definition.id, createPropBindings(definition, checker)])),
    };
    for (const definition of definitions) analyzeDefinitionUsages(definition, context);

    const rulesByComponentId = new Map<string, ConsumerRules>();
    for (const definition of definitions) {
      const bindings = context.propBindings.get(definition.id)!;
      rulesByComponentId.set(definition.id, analyzeConsumerRules(definition, context, bindings));
    }

    const visibility = createVisibilityByTarget(
      definitions,
      context.externalTargets,
      options.excludeFilePatterns ?? [],
      options.excludeComponentPatterns ?? [],
    );
    const collapsed = collapseComponentStructure(definitions, context, rulesByComponentId, visibility);
    const graph = createGraph(
      definitions,
      collapsed.instances,
      collapsed.relationships,
      collapsed.controls,
      collapsed.roots,
    );
    const focused =
      options.rootPatterns && options.rootPatterns.length > 0
        ? focusGraphOnRoots(graph, [...options.rootPatterns], collapsed.instances)
        : graph;
    return projectDecisionNodes(mergeEquivalentContexts(focused, collapsed.instances, collapsed.relationships));
  }
  return buildComponentGraph;
}

export async function buildComponentGraph(options: ComponentGraphOptions): Promise<DiagramGraph> {
  if (options.sourcePaths.length === 0) throw new Error("At least one source path is required.");
  const scopePath = await realpath(options.scopePath);
  if (!(await lstat(scopePath)).isDirectory()) throw new Error(`Base must be a directory: ${options.scopePath}`);
  return createComponentGraphBuilder(await loadTypeScript(scopePath))({ ...options, scopePath });
}
