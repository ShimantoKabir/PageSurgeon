// Type inference only: editor source is parsed, never executed.
class ScriptIntelligence {
  constructor(libraries) {
    this.files = new Map(Object.entries(libraries).map(([name, text]) => ["/" + name, text]));
    this.snapshots = new Map();
    this.version = 0;
    this.fileName = "/rule.js";
    this.files.set(this.fileName, "");
    this.files.set("/selectors.d.ts", "");
    const tagMap = libraries["lib.dom.d.ts"]?.match(/interface HTMLElementTagNameMap\s*\{([\s\S]*?)^\}/m)?.[1] || "";
    this.tags = new Set([...tagMap.matchAll(/"([\w-]+)"\s*:/g)].map((match) => match[1]));
    const normalize = (name) => name.startsWith("/") ? name : "/" + name;
    const host = {
      getCompilationSettings: () => ({ allowJs: true, checkJs: true, noEmit: true,
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None,
        lib: ["lib.es2020.full.d.ts"], strict: false }),
      getScriptFileNames: () => [this.fileName, "/selectors.d.ts"],
      getScriptVersion: (name) => name === this.fileName || name === "/selectors.d.ts" ? String(this.version) : "0",
      getProjectVersion: () => String(this.version),
      getScriptSnapshot: (name) => {
        name = normalize(name);
        if (!this.files.has(name)) return undefined;
        if (!this.snapshots.has(name)) this.snapshots.set(name, ts.ScriptSnapshot.fromString(this.files.get(name)));
        return this.snapshots.get(name);
      },
      getCurrentDirectory: () => "/",
      getDefaultLibFileName: () => "/lib.es2020.full.d.ts",
      fileExists: (name) => this.files.has(normalize(name)),
      readFile: (name) => this.files.get(normalize(name)),
      readDirectory: () => [],
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
    };
    this.service = ts.createLanguageService(host);
  }

  selectorTag(selector) {
    let start = 0;
    let depth = 0;
    let quote = "";
    for (let i = 0; i < selector.length; i++) {
      const char = selector[i];
      if (char === "\\") { i++; continue; }
      if (quote) { if (char === quote) quote = ""; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === "[" || char === "(") depth++;
      else if (char === "]" || char === ")") depth--;
      else if (!depth && char === ",") return null;
      else if (!depth && /[\s>+~]/.test(char)) start = i + 1;
    }
    const tag = selector.slice(start).match(/^([a-zA-Z][\w-]*)/)?.[1].toLowerCase();
    return this.tags.has(tag) ? tag : null;
  }

  selectorDeclarations(source, typescript) {
    const file = ts.createSourceFile(this.fileName, source, ts.ScriptTarget.ES2020, true,
      typescript ? ts.ScriptKind.TS : ts.ScriptKind.JS);
    const declarations = new Set();
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ["querySelector", "querySelectorAll"].includes(node.expression.name.text) &&
        node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
        const selector = node.arguments[0].text;
        const tag = this.selectorTag(selector);
        if (tag) {
          const type = `HTMLElementTagNameMap[${JSON.stringify(tag)}]`;
          const result = node.expression.name.text === "querySelectorAll" ? `NodeListOf<${type}>` : `${type} | null`;
          declarations.add(`${node.expression.name.text}(selectors: ${JSON.stringify(selector)}): ${result};`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    // Supplement compound literal selectors such as "a#dib", without rewriting source.
    return declarations.size ? `interface ParentNode {\n${[...declarations].join("\n")}\n}` : "";
  }

  complete(source, position, language = "js") {
    const fileName = language === "ts" ? "/rule.ts" : "/rule.js";
    const previous = this.fileName;
    if (fileName !== previous || this.files.get(fileName) !== source) {
      this.files.delete(previous);
      this.snapshots.delete(previous);
      this.fileName = fileName;
      this.files.set(fileName, source);
      this.snapshots.delete(fileName);
      this.files.set("/selectors.d.ts", this.selectorDeclarations(source, language === "ts"));
      this.snapshots.delete("/selectors.d.ts");
      this.version++;
    }
    const before = source.slice(0, position);
    const member = /(?:\?\.|\.)\s*[\w$]*$/.test(before);
    const info = this.service.getCompletionsAtPosition(fileName, position, {
      includeCompletionsForModuleExports: false,
      includeCompletionsWithInsertText: true,
    });
    if (!info) return { items: [], member, allowFallback: false };
    const prefix = before.match(/[\w$]*$/)[0];
    const suffix = source.slice(position).match(/^[\w$]*/)[0];
    const common = ["href", "textContent", "classList", "style", "addEventListener", "querySelector", "id", "value", "length"];
    const items = info.entries.filter((entry) =>
      !entry.hasAction && !entry.source && entry.name.toLowerCase().startsWith(prefix.toLowerCase()),
    ).map((entry) => {
      const span = entry.replacementSpan || info.optionalReplacementSpan ||
        { start: position - prefix.length, length: prefix.length + suffix.length };
      return { text: entry.name, insertText: entry.insertText || entry.name,
        type: /method|function/.test(entry.kind) ? "method" : entry.kind,
        replaceStart: span.start, replaceLength: span.length,
        rank: entry.isRecommended ? -1 : common.includes(entry.name) ? common.indexOf(entry.name) : 100,
      };
    }).sort((a, b) => a.rank - b.rank || a.text.localeCompare(b.text));
    return { items, member: info.isMemberCompletion || member, allowFallback: true };
  }
}
