import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";

import ignore from "ignore";
import micromatch from "micromatch";
import type ts from "typescript";

import { projectDecisionNodes } from "@/features/diagram/decision-nodes";
import type {
  DefaultDiagramEdge,
  DefaultDiagramNode,
  DiagramControl,
  DiagramGraph,
  DiagramRouteRequirementRule,
  DiagramRouteRequirementRuleset,
} from "@/features/diagram/diagram-graph";
import { combineRulesets, unionRulesets } from "@/features/diagram/diagram-route-requirement-rules";
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
  // The supplying usage instances: `supplierIds` name definitions for display,
  // while these identify the exact contexts so merging can compare suppliers
  // structurally instead of by definition.
  supplierInstanceIds: readonly string[];
  origins: readonly Readonly<{ supplierId: string; prop: string }>[];
}>;

type Relationship = (DirectRenderRelationship | SuppliedRenderRelationship) &
  Readonly<{ ruleset: DiagramRouteRequirementRuleset }>;

type SuppliedValue = Readonly<{
  propName: string;
  kind: SuppliedValueKind;
  targets: readonly Readonly<{ useId: string; ruleset: DiagramRouteRequirementRuleset }>[];
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
  ruleset: DiagramRouteRequirementRuleset;
}>;

type ForwardRule = Readonly<{
  type: "forward";
  targetUseId: string;
  targetPropName: string;
  ruleset: DiagramRouteRequirementRuleset;
}>;

type ConsumerRule = TerminalRule | ForwardRule;

type ConsumerRules = Readonly<{
  exact: Map<string, ConsumerRule[]>;
  spreads: ReadonlyArray<
    Readonly<{ excludedProps: ReadonlySet<string>; targetUseId: string; ruleset: DiagramRouteRequirementRuleset }>
  >;
}>;

type ConsumerRouteStep = Readonly<{
  useId: string;
  componentId: string;
  propName: string;
  ruleset: DiagramRouteRequirementRuleset;
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
  useRulesets: Map<string, DiagramRouteRequirementRuleset>;
  propBindings: ReadonlyMap<string, PropBindings>;
}>;

// AST predicates, enum values, the checker, and declarations must use the same compiler.
function createComponentGraphBuilder(ts: typeof import("typescript")) {
  /** Comparison operators that complement each other, grouped by operand pair family. */
  const COMPLEMENTARY_OPERATORS: Readonly<
    Partial<Record<ts.SyntaxKind, Readonly<{ family: string; inverted: boolean }>>>
  > = {
    [ts.SyntaxKind.GreaterThanToken]: { family: "greater", inverted: false },
    [ts.SyntaxKind.LessThanEqualsToken]: { family: "greater", inverted: true },
    [ts.SyntaxKind.GreaterThanEqualsToken]: { family: "greater-or-equal", inverted: false },
    [ts.SyntaxKind.LessThanToken]: { family: "greater-or-equal", inverted: true },
    [ts.SyntaxKind.EqualsEqualsEqualsToken]: { family: "equal", inverted: false },
    [ts.SyntaxKind.ExclamationEqualsEqualsToken]: { family: "equal", inverted: true },
    [ts.SyntaxKind.EqualsEqualsToken]: { family: "loosely-equal", inverted: false },
    [ts.SyntaxKind.ExclamationEqualsToken]: { family: "loosely-equal", inverted: true },
  };

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
      Readonly<{ excludedProps: ReadonlySet<string>; targetUseId: string; ruleset: DiagramRouteRequirementRuleset }>
    >;
    let activeRuleset: DiagramRouteRequirementRuleset = [[]];

    function terminal(propName: string, kind: TerminalRule["kind"]): void {
      addExactRule(rules, propName, { type: "terminal", kind, ruleset: activeRuleset });
    }

    function inActiveRules(rule: DiagramRouteRequirementRule): boolean {
      return activeRuleset.some((prefix) =>
        prefix.every((requirement) =>
          rule.some(({ controlId, value }) => controlId === requirement.controlId && value === requirement.value),
        ),
      );
    }

    function removeActiveForwarding(matches: (rule: ForwardRule) => boolean): void {
      for (const [incomingPropName, existing] of rules.exact) {
        rules.exact.set(
          incomingPropName,
          existing.flatMap((rule) => {
            if (rule.type !== "forward" || !matches(rule)) return [rule];
            const kept = rule.ruleset.filter((requirement) => !inActiveRules(requirement));
            return kept.length > 0 ? [{ ...rule, ruleset: kept }] : [];
          }),
        );
      }
    }

    function removeForwardingToProp(targetUseId: string, targetPropName: string): void {
      removeActiveForwarding((rule) => rule.targetUseId === targetUseId && rule.targetPropName === targetPropName);
      for (const [index, spread] of [...mutableSpreads].entries()) {
        if (spread.targetUseId !== targetUseId) continue;
        const ruleset = spread.ruleset.filter(inActiveRules);
        if (ruleset.length === 0) continue;
        const retained = spread.ruleset.filter((rule) => !inActiveRules(rule));
        if (retained.length > 0) mutableSpreads.push({ ...spread, ruleset: retained });
        mutableSpreads[index] = {
          ...spread,
          ruleset,
          excludedProps: new Set(spread.excludedProps).add(targetPropName),
        };
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
        const ruleset = spread.ruleset.filter((rule) => !inActiveRules(rule));
        if (ruleset.length === 0) mutableSpreads.splice(index, 1);
        else mutableSpreads[index] = { ...spread, ruleset };
      }
    }

    function collectInvokedRenderProps(
      expression: ts.Expression,
      traverseRootFunction: boolean,
      initialRuleset: DiagramRouteRequirementRuleset = activeRuleset,
    ): readonly { propName: string; ruleset: DiagramRouteRequirementRuleset }[] {
      const props = new Map<string, { propName: string; ruleset: DiagramRouteRequirementRuleset }>();
      const activeNodes = new Set<ts.Node>();
      function visit(node: ts.Node, ruleset: DiagramRouteRequirementRuleset, isRoot: boolean): void {
        if (activeNodes.has(node)) return;
        activeNodes.add(node);
        try {
          visitValue(node, ruleset, isRoot);
        } finally {
          activeNodes.delete(node);
        }
      }
      function visitValue(node: ts.Node, ruleset: DiagramRouteRequirementRuleset, isRoot: boolean): void {
        if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
          if (isRoot && traverseRootFunction)
            controlledReturns(node.body, definition.id, context, (value, next) => visit(value, next, false), ruleset);
          return;
        }
        if (ts.isFunctionLike(node)) return;
        if (
          ts.isExpression(node) &&
          controlledExpression(node, definition.id, ruleset, context, (value, next) => visit(value, next, false))
        )
          return;
        if (ts.isCallExpression(node)) {
          const propName = getIncomingProp(node.expression, bindings, context.checker);
          if (propName) {
            const entry = { propName, ruleset };
            props.set(JSON.stringify(entry), entry);
            return;
          }
        }
        if (ts.isExpression(node)) {
          const values = resolveAliasedValues(node, context);
          if (values.some((value) => value !== unwrapExpression(node))) {
            for (const value of values) visit(value, ruleset, isRoot);
            return;
          }
        }
        ts.forEachChild(node, (child) => visit(child, ruleset, false));
      }
      visit(expression, initialRuleset, true);
      return [...props.values()];
    }

    function analyzeRenderPropInvocations(expression: ts.Expression): void {
      for (const { propName, ruleset } of collectInvokedRenderProps(expression, false))
        addExactRule(rules, propName, { type: "terminal", kind: "render-prop", ruleset });
    }

    function collectForwardedProps(
      expression: ts.Expression,
      symbolOverride?: ts.Symbol,
    ): readonly { propName: string; ruleset: DiagramRouteRequirementRuleset }[] {
      const props = new Map<string, { propName: string; ruleset: DiagramRouteRequirementRuleset }>();

      function collect(
        candidate: ts.Expression,
        ruleset: DiagramRouteRequirementRuleset,
        visitedSymbols: ReadonlySet<ts.Symbol>,
        candidateSymbol?: ts.Symbol,
      ): void {
        if (
          controlledExpression(candidate, definition.id, ruleset, context, (value, next) =>
            collect(value, next, visitedSymbols),
          )
        )
          return;
        const unwrapped = unwrapExpression(candidate);
        const directProp = candidateSymbol
          ? bindings.propSymbols.get(candidateSymbol)
          : getIncomingProp(unwrapped, bindings, context.checker);
        if (directProp) {
          const entry = { propName: directProp, ruleset };
          props.set(JSON.stringify(entry), entry);
          return;
        }
        const property = candidateSymbol ? undefined : staticObjectPropertyValue(unwrapped, context, visitedSymbols);
        if (property) {
          collect(property.value, ruleset, visitedSymbols, property.valueSymbol);
          return;
        }
        if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
          for (const entry of collectInvokedRenderProps(unwrapped, true, ruleset))
            props.set(JSON.stringify(entry), entry);
          return;
        }
        if (ts.isObjectLiteralExpression(unwrapped)) {
          for (const property of staticObjectPropertyValues(unwrapped, context))
            collect(property.value, ruleset, visitedSymbols, property.valueSymbol);
          return;
        }
        if (ts.isArrayLiteralExpression(unwrapped)) {
          for (const element of unwrapped.elements)
            if (ts.isExpression(element)) collect(element, ruleset, visitedSymbols);
          return;
        }
        const reference = localVariableReference(unwrapped, context, visitedSymbols, candidateSymbol);
        if (!reference) return;
        for (const initializer of reference.initializers) collect(initializer, ruleset, reference.visitedSymbols);
      }

      collect(expression, activeRuleset, new Set(), symbolOverride);
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
          for (const { propName, ruleset } of collectForwardedProps(expression)) {
            addExactRule(rules, propName, {
              type: "forward",
              targetUseId,
              targetPropName,
              ruleset,
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
            mutableSpreads.push({ excludedProps, targetUseId, ruleset: activeRuleset });
          }
          for (const forwarded of staticProperties.values.values()) {
            removeForwardingToProp(targetUseId, forwarded.propName);
            analyzeRenderPropInvocations(forwarded.value);
            for (const { propName, ruleset } of collectForwardedProps(forwarded.value, forwarded.valueSymbol)) {
              addExactRule(rules, propName, {
                type: "forward",
                targetUseId,
                targetPropName: forwarded.propName,
                ruleset,
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
        for (const { propName, ruleset } of collectForwardedProps(child.expression)) {
          addExactRule(rules, propName, { type: "forward", targetUseId, targetPropName: "children", ruleset });
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
    function analyzeRendered(expression: ts.Expression, ruleset: DiagramRouteRequirementRuleset = activeRuleset): void {
      if (activeExpressions.has(expression)) return;
      activeExpressions.add(expression);
      const previous = activeRuleset;
      activeRuleset = ruleset;
      try {
        if (!controlledExpression(expression, definition.id, ruleset, context, analyzeRendered))
          analyzeRenderedValue(expression);
      } finally {
        activeRuleset = previous;
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
              controlledReturns(argument.body, definition.id, context, analyzeRendered, activeRuleset);
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
        controlledReturns(unwrapped.body, definition.id, context, analyzeRendered, activeRuleset);
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
          mutableSpreads.push({ excludedProps, targetUseId, ruleset: activeRuleset });
        }
        for (const forwarded of staticObjectPropertyValues(propsExpression, context)) {
          removeForwardingToProp(targetUseId, forwarded.propName);
          analyzeRenderPropInvocations(forwarded.value);
          for (const { propName, ruleset } of collectForwardedProps(forwarded.value, forwarded.valueSymbol)) {
            addExactRule(rules, propName, {
              type: "forward",
              targetUseId,
              targetPropName: forwarded.propName,
              ruleset,
            });
          }
        }
      }
      if (targetUseId && children.length > 0) removeForwardingToProp(targetUseId, "children");
      for (const child of children) {
        analyzeRenderPropInvocations(child);
        if (!targetUseId) continue;
        for (const { propName, ruleset } of collectForwardedProps(child)) {
          addExactRule(rules, propName, { type: "forward", targetUseId, targetPropName: "children", ruleset });
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
    initialRuleset: DiagramRouteRequirementRuleset = [[]],
    rulesetsByUse: Map<string, DiagramRouteRequirementRuleset> = new Map(),
  ): readonly ComponentUse[] {
    const uses = new Map<string, ComponentUse>();
    controlledReturns(
      callback.body,
      ownerId,
      context,
      (expression, ruleset) => {
        for (const use of collectSuppliedUses([expression], ownerId, context, ruleset, rulesetsByUse))
          uses.set(use.id, use);
      },
      initialRuleset,
    );
    return [...uses.values()];
  }

  function collectSuppliedUses(
    expressions: readonly ts.Expression[],
    ownerId: string,
    context: AnalysisContext,
    initialRuleset: DiagramRouteRequirementRuleset = [[]],
    rulesetsByUse: Map<string, DiagramRouteRequirementRuleset> = new Map(),
  ): readonly ComponentUse[] {
    const uses = new Map<string, ComponentUse>();

    const activeExpressions = new Set<ts.Expression>();
    function collect(
      expression: ts.Expression,
      ruleset: DiagramRouteRequirementRuleset,
      visitedSymbols: ReadonlySet<ts.Symbol> = new Set(),
    ): void {
      if (activeExpressions.has(expression)) return;
      activeExpressions.add(expression);
      try {
        collectValue(expression, ruleset, visitedSymbols);
      } finally {
        activeExpressions.delete(expression);
      }
    }
    function collectValue(
      expression: ts.Expression,
      ruleset: DiagramRouteRequirementRuleset,
      visitedSymbols: ReadonlySet<ts.Symbol>,
    ): void {
      if (
        controlledExpression(expression, ownerId, ruleset, context, (candidate, next) =>
          collect(candidate, next, visitedSymbols),
        )
      )
        return;
      const unwrapped = unwrapExpression(expression);
      if (ts.isJsxFragment(unwrapped)) {
        for (const child of unwrapped.children) collectChild(child, ruleset);
        return;
      }
      if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped)) {
        const opening = ts.isJsxElement(unwrapped) ? unwrapped.openingElement : unwrapped;
        if (isIntrinsicJsxTag(opening.tagName)) {
          if (ts.isJsxElement(unwrapped)) for (const child of unwrapped.children) collectChild(child, ruleset);
          return;
        }
        const target = targetForReference(opening.tagName, context);
        if (target) {
          const use = ensureComponentUse(ownerId, unwrapped, target, context);
          addUseRuleset(context, use.id, ruleset, rulesetsByUse);
          analyzeJsxComponentUsage(unwrapped, use, context);
          uses.set(use.id, use);
        }
        return;
      }
      if (ts.isCallExpression(unwrapped) && isCreateElementCall(unwrapped, context.checker)) {
        const [tagExpression] = unwrapped.arguments;
        if (!tagExpression) return;
        if (ts.isStringLiteral(tagExpression)) {
          for (const child of unwrapped.arguments.slice(2)) collect(child, ruleset);
          return;
        }
        const target = targetForReference(tagExpression, context);
        if (target) {
          const use = ensureComponentUse(ownerId, unwrapped, target, context);
          addUseRuleset(context, use.id, ruleset, rulesetsByUse);
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
              ruleset,
            );
          }
        }
        return;
      }
      if (ts.isBinaryExpression(unwrapped)) {
        collect(unwrapped.right, ruleset, visitedSymbols);
        return;
      }
      if (ts.isArrayLiteralExpression(unwrapped)) {
        for (const element of unwrapped.elements)
          if (ts.isExpression(element)) collect(element, ruleset, visitedSymbols);
        return;
      }
      const reference = localVariableReference(unwrapped, context, visitedSymbols);
      if (!reference) return;
      for (const initializer of reference.initializers) collect(initializer, ruleset, reference.visitedSymbols);
    }

    function collectChild(child: ts.JsxChild, ruleset: DiagramRouteRequirementRuleset): void {
      if (ts.isJsxExpression(child) && child.expression) collect(child.expression, ruleset);
      else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child))
        collect(child, ruleset);
    }

    for (const expression of expressions) collect(expression, initialRuleset);
    return [...uses.values()];
  }

  function componentReferenceUses(
    expression: ts.Expression,
    ownerId: string,
    context: AnalysisContext,
    symbolOverride?: ts.Symbol,
    rulesetsByUse: Map<string, DiagramRouteRequirementRuleset> = new Map(),
  ): readonly ComponentUse[] {
    const uses = new Map<string, ComponentUse>();

    function collect(
      candidate: ts.Expression,
      visitedSymbols: ReadonlySet<ts.Symbol>,
      candidateSymbol?: ts.Symbol,
      ruleset: DiagramRouteRequirementRuleset = [[]],
    ): void {
      if (
        controlledExpression(candidate, ownerId, ruleset, context, (expression, next) =>
          collect(expression, visitedSymbols, undefined, next),
        )
      )
        return;
      const unwrapped = unwrapExpression(candidate);
      if (ts.isObjectLiteralExpression(unwrapped)) {
        for (const property of unwrapped.properties) {
          if (ts.isPropertyAssignment(property)) collect(property.initializer, visitedSymbols, undefined, ruleset);
          else if (ts.isShorthandPropertyAssignment(property)) {
            collect(
              property.name,
              visitedSymbols,
              context.checker.getShorthandAssignmentValueSymbol(property),
              ruleset,
            );
          } else if (ts.isSpreadAssignment(property)) collect(property.expression, visitedSymbols, undefined, ruleset);
        }
        return;
      }
      if (ts.isArrayLiteralExpression(unwrapped)) {
        for (const element of unwrapped.elements) {
          if (ts.isExpression(element)) collect(element, visitedSymbols, undefined, ruleset);
        }
        return;
      }
      if (!candidateSymbol && !ts.isIdentifier(unwrapped) && !ts.isPropertyAccessExpression(unwrapped)) return;

      const property = candidateSymbol ? undefined : staticObjectPropertyValue(unwrapped, context, visitedSymbols);
      if (property) {
        collect(property.value, visitedSymbols, property.valueSymbol, ruleset);
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
        addUseRuleset(context, use.id, ruleset, rulesetsByUse);
        uses.set(use.id, use);
        return;
      }

      const reference = localVariableReference(unwrapped, context, visitedSymbols, candidateSymbol);
      if (!reference) return;
      for (const initializer of reference.initializers)
        collect(initializer, reference.visitedSymbols, undefined, ruleset);
    }

    collect(expression, new Set(), symbolOverride);
    return [...uses.values()];
  }

  function addSuppliedValue(
    receiver: ComponentUse,
    propName: string,
    kind: SuppliedValueKind,
    targets: readonly ComponentUse[],
    rulesetsByUse: ReadonlyMap<string, DiagramRouteRequirementRuleset>,
  ): void {
    if (targets.length === 0) return;
    receiver.suppliedValues.push({
      propName,
      kind,
      targets: targets.map(({ id }) => ({ useId: id, ruleset: rulesetsByUse.get(id) ?? [[]] })),
    });
  }

  function analyzeSuppliedValue(
    receiver: ComponentUse,
    propName: string,
    expression: ts.Expression,
    context: AnalysisContext,
    symbolOverride?: ts.Symbol,
  ): void {
    const rulesetsByUse = new Map<string, DiagramRouteRequirementRuleset>();
    const componentUses = componentReferenceUses(expression, receiver.ownerId, context, symbolOverride, rulesetsByUse);
    if (componentUses.length > 0) {
      addSuppliedValue(receiver, propName, "component-prop", componentUses, rulesetsByUse);
      return;
    }

    const values = resolveAliasedValues(expression, context, new Set(), symbolOverride);
    const renderUses = new Map<string, ComponentUse>();
    function collectCallbacks(value: ts.Expression, ruleset: DiagramRouteRequirementRuleset): void {
      if (controlledExpression(value, receiver.ownerId, ruleset, context, collectCallbacks)) return;
      const unwrapped = unwrapExpression(value);
      if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
        for (const use of returnedUses(unwrapped, receiver.ownerId, context, ruleset, rulesetsByUse))
          renderUses.set(use.id, use);
        return;
      }
      for (const candidate of resolveAliasedValues(unwrapped, context))
        if (candidate !== unwrapped) collectCallbacks(candidate, ruleset);
    }
    for (const value of values) collectCallbacks(value, [[]]);
    if (renderUses.size > 0) {
      addSuppliedValue(receiver, propName, "render-prop", [...renderUses.values()], rulesetsByUse);
      return;
    }

    addSuppliedValue(
      receiver,
      propName,
      "node-prop",
      collectSuppliedUses(values, receiver.ownerId, context, [[]], rulesetsByUse),
      rulesetsByUse,
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

  function conditionControlId(
    node: ts.Node,
    ownerId: string,
    label: string,
    when: DiagramRouteRequirementRuleset,
    context: AnalysisContext,
    alternatives?: BranchAlternatives,
  ): string {
    const suffix = createHash("sha256")
      .update(`${toPosixPath(relative(context.scopePath, node.getSourceFile().fileName))}:${node.pos}:${node.end}`)
      .digest("hex")
      .slice(0, 16);
    const id = `${ownerId}:control:${suffix}`;
    const existing = context.controls.get(id);
    const base = { id, owner: ownerId, label, dependsOn: unionRulesets(existing?.dependsOn ?? [], when) };
    context.controls.set(
      id,
      alternatives
        ? {
            ...base,
            kind: "branch",
            cases: alternatives.cases,
            ...(alternatives.polarityPair ? { polarityPair: true } : {}),
          }
        : { ...base, kind: "conditional" },
    );
    return id;
  }

  function controlRuleset(
    node: ts.Node,
    ownerId: string,
    label: string,
    when: DiagramRouteRequirementRuleset,
    context: AnalysisContext,
    alternatives?: BranchAlternatives,
  ): (value: string) => DiagramRouteRequirementRuleset {
    const id = conditionControlId(node, ownerId, label, when, context, alternatives);
    return (value) => combineRulesets(when, [[{ controlId: id, value }]]);
  }

  // Branch cases emitted with the control: `polarityPair` marks the pair as
  // one boolean subject and its negation (ADR 0005 category 3), so consumers
  // never parse labels to recover the switch shape.
  type BranchAlternatives = Readonly<{
    cases: { id: string; label: string }[];
    polarityPair?: true;
  }>;

  // Display-only label normalization: control identity stays the node
  // (file/pos), so rewriting text never merges or splits controls. Double
  // negation folds (`!(!x)` → `x`), a negation wraps only when precedence
  // demands it, and the positive form strips every negation.
  const normalizedLabel = (label: string): string => {
    let text = label.trim();
    for (;;) {
      if (text.startsWith("!(") && text.endsWith(")")) {
        const inner = text.slice(2, -1).trim();
        // Only a double negation folds; `!(a || b)` keeps its negation.
        if (!inner.startsWith("!") || inner.length === 1) return text;
        text = normalizedLabel(inner.slice(1).trim());
        continue;
      }
      if (text.startsWith("!!")) {
        text = text.slice(2).trim();
        continue;
      }
      return text;
    }
  };
  const negateLabel = (label: string): string => {
    const text = normalizedLabel(label);
    if (text.startsWith("!") && !text.startsWith("!=")) return normalizedLabel(text.slice(1).trim());
    return /[<>=+\-*%&|?]|\s/.test(text) ? `!(${text})` : `!${text}`;
  };
  const positiveLabel = (label: string): string => {
    let text = normalizedLabel(label);
    for (;;) {
      if (text.startsWith("!(") && text.endsWith(")")) {
        text = normalizedLabel(text.slice(2, -1).trim());
        continue;
      }
      if (text.startsWith("!") && !text.startsWith("!=") && text.length > 1) {
        text = normalizedLabel(text.slice(1).trim());
        continue;
      }
      return text;
    }
  };

  type ConditionLiteral = Readonly<{ expression: ts.Expression; positive: boolean }>;
  const MAX_DECOMPOSED_CLAUSES = 8;
  const MAX_DECOMPOSED_LITERALS = 8;

  // A gate condition that is a pure boolean combination splits into DNF
  // clauses over atomic operands (ADR 0005 category 4): `a && (b || c)`
  // becomes [a b] ∨ [a c] and negation expands by De Morgan. An operand that
  // is not itself a combination — a call, a comparison, a plain `!x` — stays
  // one atomic control, and oversized expansions fall back to the
  // whole-expression gate.
  const isGateCombination = (expression: ts.Expression): boolean => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isPrefixUnaryExpression(unwrapped) && unwrapped.operator === ts.SyntaxKind.ExclamationToken)
      return isGateCombination(unwrapped.operand);
    return (
      ts.isBinaryExpression(unwrapped) &&
      (unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    );
  };

  const negateClauses = (
    clauses: readonly (readonly ConditionLiteral[])[],
  ): readonly (readonly ConditionLiteral[])[] | undefined => {
    const flip = (literal: ConditionLiteral): ConditionLiteral => ({
      expression: literal.expression,
      positive: !literal.positive,
    });
    // ¬(C1 ∨ … ∨ Cn) = ¬C1 ∧ … ∧ ¬Cn, and ¬(l1 ∧ … ∧ lm) = ¬l1 ∨ … ∨ ¬lm,
    // so the negation picks one flipped literal per clause — the cross
    // product. A pure disjunction (singleton clauses) is a single AND rule at
    // any width; multi-literal clauses multiply and the product is capped.
    let expanded: ConditionLiteral[][] = [[]];
    for (const clause of clauses) {
      const next: ConditionLiteral[][] = [];
      for (const base of expanded) for (const literal of clause) next.push([...base, flip(literal)]);
      expanded = next;
    }
    return expanded.length > MAX_DECOMPOSED_CLAUSES ? undefined : expanded;
  };

  const conditionClauses = (expression: ts.Expression): readonly (readonly ConditionLiteral[])[] | undefined => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isPrefixUnaryExpression(unwrapped) && unwrapped.operator === ts.SyntaxKind.ExclamationToken) {
      const operand = conditionClauses(unwrapped.operand);
      if (!operand) return undefined;
      const only = operand.length === 1 ? operand.at(0) : undefined;
      if (only && only.length === 1 && only.at(0)!.positive) return [[{ expression: unwrapped, positive: true }]];
      return negateClauses(operand);
    }
    if (
      ts.isBinaryExpression(unwrapped) &&
      (unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      const left = conditionClauses(unwrapped.left);
      const right = conditionClauses(unwrapped.right);
      if (!left || !right) return undefined;
      const merged =
        unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken
          ? [...left, ...right]
          : left.flatMap((clause) => right.map((other) => [...clause, ...other]));
      if (merged.length > MAX_DECOMPOSED_CLAUSES || merged.some((clause) => clause.length > MAX_DECOMPOSED_LITERALS))
        return undefined;
      return merged;
    }
    return [[{ expression: unwrapped, positive: true }]];
  };

  // Each literal becomes one atomic conditional control; duplicates collapse
  // and a contradictory clause drops out of the ruleset.
  const conditionRequirements = (
    clauses: readonly (readonly ConditionLiteral[])[],
    ownerId: string,
    when: DiagramRouteRequirementRuleset,
    context: AnalysisContext,
  ): DiagramRouteRequirementRuleset => {
    const rules: DiagramRouteRequirementRule[] = [];
    for (const clause of clauses) {
      const rule: DiagramRouteRequirementRule = [];
      const chosen = new Set<string>();
      let contradiction = false;
      for (const literal of clause) {
        const label = normalizedLabel(literal.expression.getText());
        const controlId = conditionControlId(literal.expression, ownerId, label, when, context);
        const value = literal.positive ? "on" : "off";
        if (chosen.has(`${controlId}\0${literal.positive ? "off" : "on"}`)) {
          contradiction = true;
          break;
        }
        if (chosen.has(`${controlId}\0${value}`)) continue;
        chosen.add(`${controlId}\0${value}`);
        rule.push({ controlId, value });
      }
      if (!contradiction) rules.push(rule);
    }
    return rules;
  };

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
    ruleset: DiagramRouteRequirementRuleset,
    context: AnalysisContext,
    visit: (expression: ts.Expression, ruleset: DiagramRouteRequirementRuleset) => void,
  ): boolean {
    const unwrapped = unwrapExpression(expression);
    if (ts.isConditionalExpression(unwrapped)) {
      const emptyTrue = isEmptyOutput(unwrapped.whenTrue, context);
      const emptyFalse = isEmptyOutput(unwrapped.whenFalse, context);
      if (emptyTrue && emptyFalse) return true;
      if (isGateCombination(unwrapped.condition)) {
        // Only arms that render need their clauses: a null arm carries no
        // route, so demanding its expansion would fail decompositions the
        // rendered side handles fine on its own.
        const trueClauses = conditionClauses(unwrapped.condition);
        const falseClauses = trueClauses && negateClauses(trueClauses);
        const trueReady = emptyTrue || trueClauses !== undefined;
        const falseReady = emptyFalse || falseClauses !== undefined;
        if (trueReady && falseReady) {
          if (!emptyTrue)
            visit(
              unwrapped.whenTrue,
              combineRulesets(ruleset, conditionRequirements(trueClauses!, ownerId, ruleset, context)),
            );
          if (!emptyFalse)
            visit(
              unwrapped.whenFalse,
              combineRulesets(ruleset, conditionRequirements(falseClauses!, ownerId, ruleset, context)),
            );
          return true;
        }
      }
      const label = normalizedLabel(unwrapped.condition.getText());
      const select = controlRuleset(
        unwrapped,
        ownerId,
        emptyTrue ? negateLabel(label) : emptyFalse ? label : positiveLabel(label),
        ruleset,
        context,
        emptyTrue || emptyFalse
          ? undefined
          : {
              cases: [
                { id: "true", label },
                { id: "false", label: negateLabel(label) },
              ],
              polarityPair: true,
            },
      );
      if (!emptyTrue) visit(unwrapped.whenTrue, select(emptyFalse ? "on" : "true"));
      if (!emptyFalse) visit(unwrapped.whenFalse, select(emptyTrue ? "on" : "false"));
      return true;
    }
    if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      function conjunction(
        condition: ts.Expression,
        node: ts.Node,
        when: DiagramRouteRequirementRuleset,
      ): DiagramRouteRequirementRuleset {
        const guard = unwrapExpression(condition);
        const operandClauses = (operand: ts.Expression, prerequisites: DiagramRouteRequirementRuleset) => {
          if (!isGateCombination(operand)) return undefined;
          const clauses = conditionClauses(operand);
          return clauses ? conditionRequirements(clauses, ownerId, prerequisites, context) : undefined;
        };
        if (ts.isBinaryExpression(guard) && guard.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
          const prerequisites = conjunction(guard.left, guard, when);
          const decomposed = operandClauses(guard.right, prerequisites);
          if (decomposed) return combineRulesets(prerequisites, decomposed);
          return controlRuleset(node, ownerId, normalizedLabel(guard.right.getText()), prerequisites, context)("on");
        }
        const decomposed = operandClauses(guard, when);
        if (decomposed) return decomposed;
        return controlRuleset(node, ownerId, normalizedLabel(condition.getText()), when, context)("on");
      }
      visit(unwrapped.right, conjunction(unwrapped.left, unwrapped, ruleset));
      return true;
    }
    if (
      ts.isBinaryExpression(unwrapped) &&
      (unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      const nullish = unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken;
      const label = normalizedLabel(unwrapped.left.getText());
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
      const select = controlRuleset(
        unwrapped,
        ownerId,
        hasLeftOutput ? label : nullish ? `${label} == null` : negateLabel(label),
        ruleset,
        context,
        hasLeftOutput
          ? {
              // The decision is the left operand's truthiness (`??`: null or
              // not) — a two-value subject, so it renders as a switch over it,
              // same as any other boolean gate. What each arm renders is the
              // graph's business: the arm edges already point at their nodes.
              cases: [
                { id: "left", label },
                { id: "right", label: nullish ? `${label} == null` : negateLabel(label) },
              ],
              polarityPair: true,
            }
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
    visit: (expression: ts.Expression, ruleset: DiagramRouteRequirementRuleset) => void,
    initialRuleset: DiagramRouteRequirementRuleset = [[]],
  ): void {
    if (!ts.isBlock(body)) {
      visit(body, initialRuleset);
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
    type Flow = { next: DiagramRouteRequirementRuleset; breaks: DiagramRouteRequirementRuleset };
    function walk(
      statements: readonly ts.Statement[],
      initial: DiagramRouteRequirementRuleset,
      breakContinuation: readonly ts.Statement[] = [],
      continuation: readonly ts.Statement[] = [],
    ): Flow {
      let next = initial;
      let breaks: DiagramRouteRequirementRuleset = [];
      for (const [index, statement] of statements.entries()) {
        if (next.length === 0) break;
        if (ts.isReturnStatement(statement)) {
          if (statement.expression) visit(statement.expression, next);
          next = [];
        } else if (ts.isThrowStatement(statement)) {
          next = [];
        } else if (ts.isBreakStatement(statement)) {
          breaks = unionRulesets(breaks, next);
          next = [];
        } else if (ts.isBlock(statement)) {
          const flow = walk(statement.statements, next, breakContinuation, [
            ...statements.slice(index + 1),
            ...continuation,
          ]);
          next = flow.next;
          breaks = unionRulesets(breaks, flow.breaks);
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
          if (isGateCombination(statement.expression)) {
            const trueClauses = conditionClauses(statement.expression);
            const falseClauses = trueClauses && negateClauses(trueClauses);
            const trueReady = !trueOutput || trueClauses !== undefined;
            const falseReady = !falseOutput || falseClauses !== undefined;
            if (trueReady && falseReady) {
              const thenFlow = walk(
                statementsOf(statement.thenStatement),
                combineRulesets(next, trueOutput ? conditionRequirements(trueClauses!, ownerId, next, context) : []),
                breakContinuation,
                tail,
              );
              const elseFlow = walk(
                statementsOf(statement.elseStatement),
                combineRulesets(next, falseOutput ? conditionRequirements(falseClauses!, ownerId, next, context) : []),
                breakContinuation,
                tail,
              );
              next = unionRulesets(thenFlow.next, elseFlow.next);
              breaks = unionRulesets(breaks, thenFlow.breaks, elseFlow.breaks);
              continue;
            }
          }
          const label = normalizedLabel(statement.expression.getText());
          const select = controlRuleset(
            statement,
            ownerId,
            trueOutput && falseOutput ? positiveLabel(label) : trueOutput ? label : negateLabel(label),
            next,
            context,
            trueOutput && falseOutput
              ? {
                  cases: [
                    { id: "true", label },
                    { id: "false", label: negateLabel(label) },
                  ],
                  polarityPair: true,
                }
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
          next = unionRulesets(thenFlow.next, elseFlow.next);
          breaks = unionRulesets(breaks, thenFlow.breaks, elseFlow.breaks);
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
            next = unionRulesets(flow.next, flow.breaks);
            continue;
          }
          const select = controlRuleset(statement, ownerId, statement.expression.getText(), next, context, {
            cases: alternatives,
          });
          let fallthrough: DiagramRouteRequirementRuleset = [];
          let exits: DiagramRouteRequirementRuleset = noDefault ? select(`case:${clauses.length}`) : [];
          for (const [clauseIndex, clause] of clauses.entries()) {
            const flow = walk(clause.statements, unionRulesets(fallthrough, select(`case:${clauseIndex}`)), tail, [
              ...clauses.slice(clauseIndex + 1).flatMap((nextClause) => [...nextClause.statements]),
              ...tail,
            ]);
            fallthrough = flow.next;
            exits = unionRulesets(exits, flow.breaks);
          }
          next = unionRulesets(exits, fallthrough);
        } else if (!ts.isFunctionLike(statement)) {
          // Preserve relationship discovery without inventing loop or exception controls.
          for (const expression of collectReturnExpressions(statement)) visit(expression, next);
        }
      }
      return { next, breaks };
    }
    walk(body.statements, initialRuleset);
  }

  function addUseRuleset(
    context: AnalysisContext,
    useId: string,
    ruleset: DiagramRouteRequirementRuleset,
    rulesetsByUse: Map<string, DiagramRouteRequirementRuleset> = context.useRulesets,
  ): void {
    rulesetsByUse.set(useId, unionRulesets(rulesetsByUse.get(useId) ?? [], ruleset));
  }

  function analyzeDefinitionUsages(definition: ComponentDefinition, context: AnalysisContext): void {
    const activeExpressions = new Set<ts.Expression>();
    function analyzeRendered(expression: ts.Expression, ruleset: DiagramRouteRequirementRuleset = [[]]): void {
      if (activeExpressions.has(expression)) return;
      activeExpressions.add(expression);
      try {
        analyzeRenderedValue(expression, ruleset);
      } finally {
        activeExpressions.delete(expression);
      }
    }
    function analyzeRenderedValue(expression: ts.Expression, ruleset: DiagramRouteRequirementRuleset): void {
      if (controlledExpression(expression, definition.id, ruleset, context, analyzeRendered)) return;
      const unwrapped = unwrapExpression(expression);
      if (ts.isJsxFragment(unwrapped)) {
        for (const child of unwrapped.children) analyzeChild(child, ruleset);
        return;
      }
      if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped)) {
        const opening = ts.isJsxElement(unwrapped) ? unwrapped.openingElement : unwrapped;
        if (isIntrinsicJsxTag(opening.tagName)) {
          if (ts.isJsxElement(unwrapped)) for (const child of unwrapped.children) analyzeChild(child, ruleset);
          return;
        }
        const target = targetForReference(opening.tagName, context);
        if (!target) {
          // Unresolved tags (context providers, third-party macros) still wrap
          // children that must be traced, matching the intrinsic branch.
          if (ts.isJsxElement(unwrapped)) for (const child of unwrapped.children) analyzeChild(child, ruleset);
          return;
        }
        const use = ensureComponentUse(definition.id, unwrapped, target, context);
        addDirectUse(context, use);
        addUseRuleset(context, use.id, ruleset);
        analyzeJsxComponentUsage(unwrapped, use, context);
        return;
      }
      if (ts.isCallExpression(unwrapped) && isCreateElementCall(unwrapped, context.checker)) {
        const [tagExpression] = unwrapped.arguments;
        if (!tagExpression) return;
        if (ts.isStringLiteral(tagExpression)) {
          for (const child of unwrapped.arguments.slice(2)) analyzeRendered(child, ruleset);
          return;
        }
        const target = targetForReference(tagExpression, context);
        if (!target) return;
        const use = ensureComponentUse(definition.id, unwrapped, target, context);
        addDirectUse(context, use);
        addUseRuleset(context, use.id, ruleset);
        analyzeCreateElementUsage(unwrapped, use, context);
        return;
      }
      if (ts.isArrayLiteralExpression(unwrapped)) {
        for (const element of unwrapped.elements) if (ts.isExpression(element)) analyzeRendered(element, ruleset);
        return;
      }
      if (ts.isCallExpression(unwrapped) && isArrayRenderingMethodCall(unwrapped, context.checker)) {
        for (const argument of unwrapped.arguments) {
          if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
            controlledReturns(argument.body, definition.id, context, analyzeRendered, ruleset);
          }
        }
        return;
      }
      const reference = localVariableReference(unwrapped, context, new Set());
      if (reference) for (const initializer of reference.initializers) analyzeRendered(initializer, ruleset);
    }

    function analyzeChild(child: ts.JsxChild, ruleset: DiagramRouteRequirementRuleset): void {
      if (ts.isJsxExpression(child) && child.expression) analyzeRendered(child.expression, ruleset);
      else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
        analyzeRendered(child, ruleset);
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
      ruleset: [[]],
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
        .map(({ targetUseId, ruleset }): ForwardRule => ({
          type: "forward",
          targetUseId,
          targetPropName: propName,
          ruleset,
        })),
    ];
    const routes = new Map<string, ConsumerRoute>();

    for (const rule of candidates) {
      if (rule.type === "terminal") {
        if (rule.kind === kind) {
          const route = { kind, steps: [{ ...step, ruleset: rule.ruleset }] } satisfies ConsumerRoute;
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
        const route = {
          kind,
          steps: [{ ...step, ruleset: rule.ruleset }, ...downstream.steps],
        } satisfies ConsumerRoute;
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

    function instantiateRuleset(
      ruleset: DiagramRouteRequirementRuleset,
      instance: ComponentInstance,
      source: ComponentInstance,
      prerequisites: DiagramRouteRequirementRuleset = [[]],
    ): DiagramRouteRequirementRuleset {
      return ruleset.map((path) =>
        path.map(({ controlId, value }) => {
          const template = context.controls.get(controlId)!;
          const id = `${instance.id}:control:${controlId.split(":control:").at(-1)}`;
          const when = combineRulesets(
            prerequisites,
            instantiateRuleset(template.dependsOn, instance, source, prerequisites),
          );
          const existing = controls.get(id);
          controls.set(id, {
            ...template,
            id,
            owner: source.id,
            dependsOn: unionRulesets(existing?.dependsOn ?? [], when),
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
      const ruleset = unionRulesets(existing.ruleset, relationship.ruleset);
      relationships.set(
        key,
        existing.kind === "direct-render" || relationship.kind === "direct-render"
          ? { ...relationship, ruleset }
          : {
              ...relationship,
              ruleset,
              supplierIds: [...new Set([...existing.supplierIds, ...relationship.supplierIds])].toSorted(),
              supplierInstanceIds: [
                ...new Set([...existing.supplierInstanceIds, ...relationship.supplierInstanceIds]),
              ].toSorted(),
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
      ruleset: DiagramRouteRequirementRuleset,
      targetUseRuleset: DiagramRouteRequirementRuleset,
    ): void {
      const visitKey = [targetUse.id, source.id, kind, propName].join("\0");
      if (trail.has(visitKey)) return;
      const nextTrail = new Set(trail).add(visitKey);
      const instance = ensureComponentInstance(parent, targetUse, owner);
      const policy = targetVisibility(targetUse.target.id);
      const supplierSource = targetVisibility(owner.target.id).boundaryVisible ? owner : source;
      const targetRulesets = combineRulesets(instantiateRuleset(targetUseRuleset, owner, supplierSource), ruleset);
      if (!policy.boundaryVisible) {
        processUseSupplies(targetUse, instance, source, owner, nextTrail, { kind, propName }, targetRulesets);
        return;
      }

      makeVisible(instance);
      addFinalRelationship({
        source: source.id,
        target: instance.id,
        kind,
        propName,
        supplierIds: [targetUse.ownerId],
        supplierInstanceIds: [owner.id],
        origins: [{ supplierId: targetUse.ownerId, prop: originPropName }],
        ruleset: targetRulesets,
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
      inheritedRulesets: DiagramRouteRequirementRuleset = [[]],
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
          let routeRulesets = inheritedRulesets;
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
            routeRulesets = combineRulesets(
              routeRulesets,
              instantiateRuleset(step.ruleset, consumer, source, routeRulesets),
            );
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
                routeRulesets,
                suppliedTarget.ruleset,
              );
            }
          }
        }
      }
    }

    function processDirectUse(source: ComponentInstance, use: ComponentUse): void {
      const instance = ensureComponentInstance(source, use, source);
      const policy = targetVisibility(use.target.id);
      const ruleset = instantiateRuleset(context.useRulesets.get(use.id) ?? [[]], source, source);
      if (policy.boundaryVisible) {
        makeVisible(instance);
        addFinalRelationship({ source: source.id, target: instance.id, kind: "direct-render", ruleset });
      }
      processUseSupplies(use, instance, source, source, new Set(), undefined, policy.boundaryVisible ? [[]] : ruleset);
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
        activeWhen: relationship.ruleset,
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

  /**
   * Conditional gates that test one operand through opposite polarities are a
   * switch over that operand, not two independent flags: `X && …` and `!X && …`
   * collected from separate gates must never be selectable at once. The merge
   * groups each owner's conditional controls by canonical operand — recursive
   * `!` stripping, comparison-operator inversion (`>` with `<=`, `===` with
   * `!==`), and `===` literals over one subject — and replaces every group with
   * a single control whose cases are the observed polarity expressions, in
   * source order. A group that never observes a second case stays conditional;
   * only its duplicate instances fold together.
   */
  function mergePolarityConditionals(context: AnalysisContext, rulesByComponentId: Map<string, ConsumerRules>): void {
    type Polarity = Readonly<{
      group: string;
      caseKey: string;
      positive: boolean;
      enumSubject?: string;
      enumCase?: string;
    }>;
    const parsedLabels = new Map<string, ts.Expression | undefined>();
    const parseLabel = (label: string): ts.Expression | undefined => {
      if (!parsedLabels.has(label)) {
        const sourceFile = ts.createSourceFile("label.ts", label, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const [statement] = sourceFile.statements;
        parsedLabels.set(label, ts.isExpressionStatement(statement) ? statement.expression : undefined);
      }
      return parsedLabels.get(label);
    };
    // Folding keys come from expression structure, not raw text, so the same
    // predicate written with different whitespace, parentheses, or quote
    // styles folds into one control (ADR 0005 category 5).
    const structureKey = (node: ts.Expression): string => {
      if (ts.isParenthesizedExpression(node)) return structureKey(node.expression);
      if (ts.isIdentifier(node)) return `id\0${node.text}`;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return `lit\0${node.text}`;
      if (ts.isNumericLiteral(node)) return `lit\0${node.text}`;
      if (ts.isPropertyAccessExpression(node)) return `get\0${structureKey(node.expression)}\0${node.name.text}`;
      if (ts.isElementAccessExpression(node))
        return `at\0${structureKey(node.expression)}\0${node.argumentExpression.getText()}`;
      if (ts.isCallExpression(node))
        return `call\0${structureKey(node.expression)}\0${node.arguments.map(structureKey).join("\u0001")}`;
      if (ts.isPrefixUnaryExpression(node)) return `pre\0${node.operator}\0${structureKey(node.operand)}`;
      if (ts.isBinaryExpression(node))
        return `bin\0${node.operatorToken.kind}\0${structureKey(node.left)}\0${structureKey(node.right)}`;
      return `raw\0${node.kind}\0${node.getText()}`;
    };
    const unwrapPolarity = (node: ts.Expression): { core: ts.Expression; parity: number } => {
      let core = node;
      let parity = 0;
      for (;;) {
        if (ts.isParenthesizedExpression(core)) {
          core = core.expression;
          continue;
        }
        if (ts.isPrefixUnaryExpression(core) && core.operator === ts.SyntaxKind.ExclamationToken) {
          parity ^= 1;
          core = core.operand;
          continue;
        }
        return { core, parity };
      }
    };
    const isEnumSubject = (node: ts.Expression): boolean =>
      ts.isIdentifier(node) || (ts.isPropertyAccessExpression(node) && isEnumSubject(node.expression));
    const isEnumLiteral = (node: ts.Expression): boolean =>
      ts.isStringLiteral(node) ||
      ts.isNumericLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      node.kind === ts.SyntaxKind.TrueKeyword ||
      node.kind === ts.SyntaxKind.FalseKeyword;
    const polarityOfLabel = (text: string): Polarity | undefined => {
      const expression = parseLabel(text);
      if (!expression) return undefined;
      const { core, parity } = unwrapPolarity(expression);
      if (!ts.isBinaryExpression(core) || !COMPLEMENTARY_OPERATORS[core.operatorToken.kind])
        return { group: `expression\0${structureKey(core)}`, caseKey: `polarity:${parity}`, positive: parity === 0 };
      const operator = COMPLEMENTARY_OPERATORS[core.operatorToken.kind]!;
      const leftCore = unwrapPolarity(core.left).core;
      const rightCore = unwrapPolarity(core.right).core;
      const left = leftCore.getText();
      const right = rightCore.getText();
      const polarity = parity ^ (operator.inverted ? 1 : 0);
      return {
        group: `comparison\0${operator.family}\0${structureKey(leftCore)}\0${structureKey(rightCore)}`,
        caseKey: `polarity:${polarity}`,
        positive: polarity === 0,
        ...(parity === 0 && !operator.inverted && isEnumSubject(leftCore) && isEnumLiteral(rightCore)
          ? { enumSubject: left, enumCase: right }
          : {}),
      };
    };
    const polarityOf = (control: DiagramControl): Polarity | undefined => polarityOfLabel(control.label);

    // A native boolean gate branch (`hide ? A : B` with both arms rendering):
    // its two cases spell one subject and its negation, so it folds with the
    // conditionals over that subject instead of living as its own switch.
    const branchCasesOf = (control: DiagramControl): { trueText: string; falseText: string } | undefined => {
      if (control.kind !== "branch" || control.cases.length !== 2) return undefined;
      const [trueCase, falseCase] = control.cases;
      if (!trueCase || !falseCase || trueCase.id !== "true" || falseCase.id !== "false") return undefined;
      return { trueText: trueCase.label, falseText: falseCase.label };
    };

    type Member = Readonly<{
      control: DiagramControl;
      polarity: Polarity;
      branchCases?: { trueText: string; falseText: string };
    }>;
    const groups = new Map<string, Member[]>();

    // One discriminant: an equality comparing a subject expression to a
    // literal value. Every gate over the same subject — a conditional or a
    // true/false branch — enumerates one case per value instead of separate
    // polarity pairs, with a synthesized remainder case for routes that need
    // "any other value" (ADR 0005). Case labels are the comparands and the
    // branch label is the subject, not the source expressions.
    type DiscriminantSemantics = Readonly<{ literal: string; positive: boolean }>;
    type DiscriminantMember = Readonly<{
      control: DiagramControl;
      groupKey: string;
      subject: string;
      semantics: ReadonlyMap<string, DiscriminantSemantics>;
    }>;
    type DiscriminantGroup = {
      owner: string;
      subject: string;
      members: DiscriminantMember[];
      positiveLiterals: string[];
      needsRemainder: boolean;
      representative: DiagramControl;
      staysConditional: boolean;
    };
    const EQUALITY_FAMILIES = new Set(["equal", "loosely-equal"]);
    const literalCaseText = (node: ts.Expression): string =>
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node)
        ? node.text
        : node.getText();
    const discriminantOf = (control: DiagramControl): DiscriminantMember | undefined => {
      let label: string | undefined;
      let values: readonly string[];
      if (control.kind === "branch") {
        const [onCase, offCase] = control.cases;
        if (
          control.cases.length !== 2 ||
          onCase?.id !== "true" ||
          offCase?.id !== "false" ||
          offCase.label !== negateLabel(onCase.label)
        )
          return undefined;
        label = onCase.label;
        values = ["true", "false"];
      } else {
        label = control.label;
        values = ["on", "off"];
      }
      const expression = parseLabel(label);
      if (!expression) return undefined;
      const { core, parity } = unwrapPolarity(expression);
      if (!ts.isBinaryExpression(core)) return undefined;
      const operator = COMPLEMENTARY_OPERATORS[core.operatorToken.kind];
      if (!operator || !EQUALITY_FAMILIES.has(operator.family)) return undefined;
      const left = unwrapPolarity(core.left).core;
      const right = unwrapPolarity(core.right).core;
      if (!isEnumSubject(left) || !isEnumLiteral(right)) return undefined;
      const literal = literalCaseText(right);
      if (literal.length === 0) return undefined;
      const positive = operator.inverted ? parity === 1 : parity === 0;
      const semantics = new Map<string, DiscriminantSemantics>(
        values.map((value, index) => [value, { literal, positive: index === 0 ? positive : !positive }]),
      );
      return {
        control,
        groupKey: `${control.owner}\0discriminant\0${operator.family}\0${structureKey(left)}`,
        subject: left.getText(),
        semantics,
      };
    };
    const discriminantMembers = new Map<string, DiscriminantMember>();
    const discriminantGroups = new Map<string, DiscriminantGroup>();
    for (const control of context.controls.values()) {
      const member = discriminantOf(control);
      if (!member) continue;
      discriminantMembers.set(control.id, member);
      const group = discriminantGroups.get(member.groupKey) ?? {
        owner: member.control.owner,
        subject: member.subject,
        members: [],
        positiveLiterals: [],
        needsRemainder: false,
        representative: member.control,
        staysConditional: false,
      };
      group.members.push(member);
      for (const { literal, positive } of member.semantics.values()) {
        if (positive && !group.positiveLiterals.includes(literal)) group.positiveLiterals.push(literal);
      }
      discriminantGroups.set(member.groupKey, group);
    }

    for (const control of context.controls.values()) {
      if (discriminantMembers.has(control.id)) continue;
      const branchCases = branchCasesOf(control);
      if (!branchCases && control.kind !== "conditional") continue;
      // A branch's own label is the positive subject, but its true case names
      // the gate as written — that text carries the polarity.
      const polarity = branchCases ? polarityOfLabel(branchCases.trueText) : polarityOf(control);
      if (!polarity) continue;
      const key = `${control.owner}\0${polarity.group}`;
      const members = groups.get(key) ?? [];
      members.push({ control, polarity, ...(branchCases ? { branchCases } : {}) });
      groups.set(key, members);
    }

    // A route that leaves a discriminant group with only negated values —
    // "not loading, not error" — names the remainder, which no source
    // expression ever spells. Scanning every ruleset first tells each group
    // whether it must synthesize that case before any rewriting starts.
    const scanDiscriminantUsage = (ruleset: DiagramRouteRequirementRuleset): void => {
      for (const rule of ruleset) {
        const states = new Map<string, { positives: Set<string>; negatives: Set<string> }>();
        for (const { controlId, value } of rule) {
          const member = discriminantMembers.get(controlId);
          const semantic = member?.semantics.get(value);
          if (!member || !semantic) continue;
          const state = states.get(member.groupKey) ?? { positives: new Set<string>(), negatives: new Set<string>() };
          (semantic.positive ? state.positives : state.negatives).add(semantic.literal);
          states.set(member.groupKey, state);
        }
        for (const [groupKey, { positives, negatives }] of states) {
          if (positives.size > 0 || negatives.size === 0) continue;
          const group = discriminantGroups.get(groupKey)!;
          if (group.positiveLiterals.length > 0) group.needsRemainder = true;
        }
      }
    };
    for (const control of context.controls.values()) scanDiscriminantUsage(control.dependsOn);
    for (const ruleset of context.useRulesets.values()) scanDiscriminantUsage(ruleset);
    for (const use of context.uses.values()) {
      for (const supplied of use.suppliedValues) {
        for (const target of supplied.targets) scanDiscriminantUsage(target.ruleset);
      }
    }
    for (const rules of rulesByComponentId.values()) {
      for (const list of rules.exact.values()) for (const rule of list) scanDiscriminantUsage(rule.ruleset);
      for (const spread of rules.spreads) scanDiscriminantUsage(spread.ruleset);
    }
    for (const group of discriminantGroups.values()) {
      // A lone value nobody negates keeps the conditional's on/off value space;
      // anything richer enumerates the subject's values as branch cases.
      group.staysConditional = group.positiveLiterals.length < 2 && !group.needsRemainder;
    }

    const finalGroups: Member[][] = [...groups.values()];

    type Replacement = Readonly<{ controlId: string; values: Readonly<Record<string, string>> }>;
    const replacements = new Map<string, Replacement>();
    const memberIds = new Set<string>();
    const mergedGroups = new Map<string, Member[]>();
    const complementKeyOf = (caseKey: string): string =>
      caseKey.startsWith("polarity:") ? `polarity:${caseKey === "polarity:0" ? 1 : 0}` : caseKey;
    for (const members of finalGroups) {
      // A lone branch keeps its native true/false value space: folding it
      // with itself only renames its cases. It joins when a conditional or
      // another branch over the same subject shares the group.
      if (members.length === 1 && members.at(0)!.branchCases) continue;
      const representative = members.at(0)!.control;
      const caseTextByKey = new Map<string, string>();
      for (const { control, polarity, branchCases } of members) {
        if (!caseTextByKey.has(polarity.caseKey))
          caseTextByKey.set(polarity.caseKey, branchCases ? branchCases.trueText : control.label);
        // A branch member's false arm already names the complement case.
        if (branchCases && !caseTextByKey.has(complementKeyOf(polarity.caseKey)))
          caseTextByKey.set(complementKeyOf(polarity.caseKey), branchCases.falseText);
        memberIds.add(control.id);
      }
      const complementText = (caseKey: string): string | undefined => caseTextByKey.get(complementKeyOf(caseKey));
      // A group that never sees a second case stays conditional, so its value
      // space is still "on"/"off"; only the duplicate control ids fold together.
      const staysConditional = caseTextByKey.size < 2;
      for (const { control, polarity, branchCases } of members) {
        const values: Record<string, string> = branchCases
          ? {
              true: caseTextByKey.get(polarity.caseKey)!,
              false: caseTextByKey.get(complementKeyOf(polarity.caseKey))!,
            }
          : staysConditional
            ? { on: "on", off: "off" }
            : {
                on: caseTextByKey.get(polarity.caseKey)!,
                ...(complementText(polarity.caseKey) ? { off: complementText(polarity.caseKey)! } : {}),
              };
        replacements.set(control.id, { controlId: representative.id, values });
      }
      mergedGroups.set(representative.id, members);
    }

    const discriminantByRepresentative = new Map<string, DiscriminantGroup>();
    for (const group of discriminantGroups.values()) {
      discriminantByRepresentative.set(group.representative.id, group);
      for (const { control } of group.members) memberIds.add(control.id);
    }

    // A discriminant group resolves per rule: one chosen value wins, negations
    // of a different value are implied, contradicting or empty resolutions
    // drop the rule, and a bare negation expands over the values it still
    // allows — the remainder included when the group synthesized one.
    const conditionalValueOf = (group: DiscriminantGroup, outcomePositive: boolean): string => {
      const representative = group.members.at(0)!.semantics;
      const onSemantic = representative.get("on") ?? representative.get("true")!;
      return onSemantic.positive === outcomePositive ? "on" : "off";
    };
    const resolveDiscriminant = (
      group: DiscriminantGroup,
      positives: ReadonlySet<string>,
      negatives: ReadonlySet<string>,
    ): readonly string[] => {
      const [chosen] = positives;
      if (chosen !== undefined) {
        if (negatives.has(chosen)) return [];
        return group.staysConditional
          ? [conditionalValueOf(group, true)]
          : group.positiveLiterals.includes(chosen)
            ? [chosen]
            : [];
      }
      if (negatives.size === 0) return [];
      if (group.staysConditional) return [conditionalValueOf(group, false)];
      const allowed = group.positiveLiterals.filter((literal) => !negatives.has(literal));
      return group.needsRemainder ? [...allowed, "otherwise"] : allowed;
    };
    const rewrite = (ruleset: DiagramRouteRequirementRuleset): DiagramRouteRequirementRuleset => {
      const rewritten: DiagramRouteRequirementRule[] = [];
      for (const rule of ruleset) {
        const passthrough: DiagramRouteRequirementRule = [];
        const states = new Map<string, { positives: Set<string>; negatives: Set<string> }>();
        let dead = false;
        for (const requirement of rule) {
          const member = discriminantMembers.get(requirement.controlId);
          if (member) {
            const semantic = member.semantics.get(requirement.value);
            if (!semantic) {
              dead = true;
              break;
            }
            const state = states.get(member.groupKey) ?? { positives: new Set<string>(), negatives: new Set<string>() };
            (semantic.positive ? state.positives : state.negatives).add(semantic.literal);
            states.set(member.groupKey, state);
            continue;
          }
          const replacement = replacements.get(requirement.controlId);
          if (!replacement) {
            passthrough.push(requirement);
            continue;
          }
          const value = replacement.values[requirement.value];
          passthrough.push(value === undefined ? requirement : { controlId: replacement.controlId, value });
        }
        if (dead) continue;
        const resolutions = [...states];
        const buildRules = (
          index: number,
          base: DiagramRouteRequirementRule,
        ): readonly DiagramRouteRequirementRule[] => {
          if (index >= resolutions.length) return [base];
          const [groupKey, state] = resolutions[index]!;
          const group = discriminantGroups.get(groupKey)!;
          const values = resolveDiscriminant(group, state.positives, state.negatives);
          return values.flatMap((value) =>
            buildRules(index + 1, [...base, { controlId: group.representative.id, value }]),
          );
        };
        rewritten.push(...buildRules(0, passthrough));
      }
      return rewritten;
    };

    const controls = new Map<string, DiagramControl>();
    for (const control of context.controls.values()) {
      const members = mergedGroups.get(control.id);
      if (members) {
        const casesByKey = new Map<string, { id: string; label: string; positive: boolean }>();
        for (const { control: member, polarity, branchCases } of members) {
          if (!casesByKey.has(polarity.caseKey))
            casesByKey.set(polarity.caseKey, {
              id: branchCases ? branchCases.trueText : member.label,
              label: branchCases ? branchCases.trueText : member.label,
              positive: polarity.positive,
            });
          if (branchCases && !casesByKey.has(complementKeyOf(polarity.caseKey)))
            casesByKey.set(complementKeyOf(polarity.caseKey), {
              id: branchCases.falseText,
              label: branchCases.falseText,
              positive: !polarity.positive,
            });
        }
        const cases = [...casesByKey.values()].map(({ id, label }) => ({ id, label }));
        const positiveText = [...casesByKey.values()].find(({ positive }) => positive)?.label ?? cases.at(0)!.label;
        controls.set(control.id, {
          id: control.id,
          owner: control.owner,
          // A two-case group is a switch over one two-value subject, so its
          // label is the positive form; a lone member stays a conditional and
          // keeps its own polarity — its label names the condition that turns
          // it on. Comparison groups qualify too: they pair one predicate with
          // its complement over the same threshold, which never overlaps —
          // overlapping thresholds keep separate groups (ADR 0005 category 6).
          ...(cases.length >= 2
            ? {
                kind: "branch" as const,
                label: positiveLabel(positiveText),
                cases,
                polarityPair: true as const,
              }
            : { kind: "conditional" as const, label: positiveText }),
          dependsOn: unionRulesets(...members.map(({ control: member }) => rewrite(member.dependsOn))),
        });
        continue;
      }
      const discriminant = discriminantByRepresentative.get(control.id);
      if (discriminant) {
        const dependsOn = unionRulesets(
          ...discriminant.members.map(({ control: member }) => rewrite(member.dependsOn)),
        );
        controls.set(
          control.id,
          discriminant.staysConditional
            ? { id: control.id, owner: control.owner, label: control.label, kind: "conditional", dependsOn }
            : {
                id: control.id,
                owner: control.owner,
                kind: "branch",
                label: discriminant.subject,
                cases: [
                  ...discriminant.positiveLiterals.map((literal) => ({ id: literal, label: literal })),
                  ...(discriminant.needsRemainder ? [{ id: "otherwise", label: "otherwise" }] : []),
                ],
                dependsOn,
              },
        );
        continue;
      }
      if (memberIds.has(control.id)) continue;
      controls.set(control.id, { ...control, dependsOn: rewrite(control.dependsOn) });
    }
    // Gates ordered `A && B` at one site and `B && A` at another make the
    // merged controls prerequisites of each other. Peers gated in conflicting
    // orders are not prerequisites — the later control drops the requirement
    // that closes the cycle, in source order, until the graph is acyclic.
    const creationOrder = new Map([...controls.keys()].map((id, index) => [id, index]));
    const dependents = (control: DiagramControl) => [
      ...new Set(control.dependsOn.flat().map(({ controlId }) => controlId)),
    ];
    for (;;) {
      const state = new Map<string, "visiting" | "done">();
      const path: string[] = [];
      const visit = (id: string): readonly string[] | undefined => {
        state.set(id, "visiting");
        path.push(id);
        for (const successor of dependents(controls.get(id)!)) {
          if (!controls.has(successor)) continue;
          if (state.get(successor) === "visiting") return [...path.slice(path.indexOf(successor)), successor];
          if (!state.has(successor)) {
            const cycle = visit(successor);
            if (cycle) return cycle;
          }
        }
        state.set(id, "done");
        path.pop();
        return undefined;
      };
      let cycle: readonly string[] | undefined;
      for (const id of controls.keys()) {
        if (!state.has(id)) {
          cycle = visit(id);
          if (cycle) break;
        }
      }
      if (!cycle) break;
      const ring = cycle.slice(0, -1);
      const latest = ring.reduce((left, right) =>
        creationOrder.get(left)! > creationOrder.get(right)! ? left : right,
      );
      const successor = ring[(ring.indexOf(latest) + 1) % ring.length]!;
      const control = controls.get(latest)!;
      controls.set(latest, {
        ...control,
        dependsOn: control.dependsOn.map((rule) => rule.filter(({ controlId }) => controlId !== successor)),
      });
    }
    context.controls.clear();
    for (const [id, control] of controls) context.controls.set(id, control);

    for (const [useId, ruleset] of context.useRulesets) context.useRulesets.set(useId, rewrite(ruleset));
    for (const [useId, use] of context.uses) {
      context.uses.set(useId, {
        ...use,
        suppliedValues: use.suppliedValues.map((supplied) => ({
          ...supplied,
          targets: supplied.targets.map((target) => ({ ...target, ruleset: rewrite(target.ruleset) })),
        })),
      });
    }
    for (const [componentId, rules] of rulesByComponentId) {
      rulesByComponentId.set(componentId, {
        exact: new Map(
          [...rules.exact].map(([propName, list]) => [
            propName,
            list.map((rule) => ({ ...rule, ruleset: rewrite(rule.ruleset) })),
          ]),
        ),
        spreads: rules.spreads.map((spread) => ({ ...spread, ruleset: rewrite(spread.ruleset) })),
      });
    }
  }

  function mergeEquivalentContexts(
    graph: DiagramGraph,
    instances: readonly ComponentInstance[],
    relationships: readonly Relationship[],
  ): DiagramGraph {
    const targetsByInstanceId = new Map(instances.map(({ id, target }) => [id, target]));
    const relationshipsByEdgeId = new Map(relationships.map((relationship) => [edgeId(relationship), relationship]));
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
    function requireControls(ruleset: DiagramRouteRequirementRuleset): void {
      for (const { controlId } of ruleset.flat()) {
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
    const normalizeRulesets = (ruleset: DiagramRouteRequirementRuleset, classes: ReadonlyMap<string, string>) =>
      ruleset.map((path) =>
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
          // Suppliers compare by their usage classes, not their definition
          // ids: a receiver merges only with usages whose supplied content
          // came from structurally identical suppliers. Suppliers outside the
          // focused graph have no class and keep their raw ids.
          const suppliers =
            relationship.kind === "direct-render"
              ? []
              : relationship.supplierInstanceIds.map((instanceId) => classes.get(instanceId) ?? instanceId).toSorted();
          return JSON.stringify([
            {
              ...metadata,
              activeWhen: normalizeRulesets(edge.type === "default" ? (edge.activeWhen ?? [[]]) : [[]], classes),
            },
            suppliers,
            classes.get(target),
          ]);
        });
        const ownedControls = (controlsByOwner.get(node.id) ?? []).map(
          ({ id: _id, owner: _owner, dependsOn, ...metadata }) => ({
            ...metadata,
            dependsOn: normalizeRulesets(dependsOn, classes),
          }),
        );
        const signature = JSON.stringify([classes.get(node.id), ownedControls, [...new Set(outgoing)].toSorted()]);
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
    const rewriteRulesets = (ruleset: DiagramRouteRequirementRuleset): DiagramRouteRequirementRuleset =>
      unionRulesets(
        ruleset.map((path) =>
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
        dependsOn: unionRulesets(existing?.dependsOn ?? [], rewriteRulesets(control.dependsOn)),
      });
    }
    const edges = new Map<string, (typeof graph.edges)[number]>();
    for (const edge of graph.edges) {
      const source = outputIds.get(edge.source)!;
      const target = outputIds.get(edge.target)!;
      const id = edgeId({ ...relationshipsByEdgeId.get(edge.id)!, source, target });
      const existing = edges.get(id);
      const ruleset = edge.type === "default" ? rewriteRulesets(edge.activeWhen ?? [[]]) : [[]];
      edges.set(id, {
        ...edge,
        id,
        source,
        target,
        ...(edge.type === "default"
          ? { activeWhen: unionRulesets(existing?.type === "default" ? (existing.activeWhen ?? []) : [], ruleset) }
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
      throw new Error("No JS, JSX, TS, or TSX source files matched the selected ruleset.");
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
    const selectedRulesets = new Set(sourceFilePaths);
    const sourceFiles = program
      .getSourceFiles()
      .filter((sourceFile) => selectedRulesets.has(resolve(sourceFile.fileName)))
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
      useRulesets: new Map(),
      propBindings: new Map(definitions.map((definition) => [definition.id, createPropBindings(definition, checker)])),
    };
    for (const definition of definitions) analyzeDefinitionUsages(definition, context);

    const rulesByComponentId = new Map<string, ConsumerRules>();
    for (const definition of definitions) {
      const bindings = context.propBindings.get(definition.id)!;
      rulesByComponentId.set(definition.id, analyzeConsumerRules(definition, context, bindings));
    }
    mergePolarityConditionals(context, rulesByComponentId);

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
