// Shared by the options page and background. Original source is never replaced.
const typescriptCache = new Map();

function transpileRuleJavaScript(rule) {
  const source = rule.js || "";
  if (rule.jsLanguage !== "ts" || !source.trim()) return source;
  if (typescriptCache.has(source)) return typescriptCache.get(source);
  // Every browser context loads the packaged compiler before this helper.
  // Service workers cannot introduce a new imported script after installation.
  if (!globalThis.ts) throw new Error("TypeScript compiler is unavailable. Reload the extension.");

  const file = ts.createSourceFile("rule.ts", source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  const describe = (diagnostic) => {
    const position = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start || 0);
    const where = position ? `Line ${position.line + 1}, column ${position.character + 1}: ` : "";
    return where + ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  };
  if (file.parseDiagnostics.length) throw new Error(describe(file.parseDiagnostics[0]));
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement) ||
      ts.isExportDeclaration(statement) || ts.isExportAssignment(statement) ||
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      const position = file.getLineAndCharacterOfPosition(statement.getStart(file));
      throw new Error(`Line ${position.line + 1}: Imports and exports are not supported in injected scripts. Write a single-file script or use the external libraries panel.`);
    }
  }
  const result = ts.transpileModule(source, {
    fileName: "rule.ts",
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
      moduleDetection: ts.ModuleDetectionKind.Legacy,
      newLine: ts.NewLineKind.LineFeed,
      sourceMap: false,
      removeComments: false,
    },
  });
  const errors = result.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) || [];
  if (errors.length) throw new Error(describe(errors[0]));
  if (typescriptCache.size >= 20) typescriptCache.delete(typescriptCache.keys().next().value);
  typescriptCache.set(source, result.outputText);
  return result.outputText;
}
