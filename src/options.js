const ext = globalThis.browser || globalThis.chrome;

document.title = ext.runtime.getManifest().name;

// Firefox requires userScripts to be requested from a user gesture.
if (ext.runtime.getManifest().optional_permissions?.includes("userScripts")) {
  const panel = document.getElementById("user-scripts-permission");
  const status = document.getElementById("user-scripts-status");
  const permission = { permissions: ["userScripts"] };
  const refreshPermission = async () => {
    panel.classList.toggle("hidden", await ext.permissions.contains(permission));
  };
  document.getElementById("enable-user-scripts").addEventListener("click", async () => {
    try {
      const granted = await ext.permissions.request(permission);
      status.textContent = granted
        ? "User scripts enabled. Reload your website tabs to apply rules."
        : "Permission was not granted. Click Enable user scripts to try again.";
      if (granted) await refreshPermission();
    } catch (error) {
      status.textContent = `Could not enable user scripts: ${error.message}`;
    }
  });
  ext.permissions.onAdded.addListener(refreshPermission);
  ext.permissions.onRemoved.addListener(refreshPermission);
  refreshPermission().catch((error) => {
    panel.classList.remove("hidden");
    status.textContent = `Could not check user scripts permission: ${error.message}`;
  });
}

let currentRuleId = null;
let rules = [];

const ui = {
  list: document.getElementById("rules-list"),
  count: document.getElementById("rule-count"),
  search: document.getElementById("search-input"),
  name: document.getElementById("rule-name"),
  url: document.getElementById("url-pattern"),
  js: document.getElementById("js-editor"),
  jsLanguage: document.getElementById("js-language"),
  compileMessage: document.getElementById("js-compile-message"),
  css: document.getElementById("css-editor"),
  hlJs: document.getElementById("js-highlight"),
  hlCss: document.getElementById("css-highlight"),
  jsLines: document.getElementById("js-lines"),
  cssLines: document.getElementById("css-lines"),
  jsAuto: document.getElementById("js-autocomplete"),
  cssAuto: document.getElementById("css-autocomplete"),
  libs: document.getElementById("libs-editor"),
  btnSave: document.getElementById("save-btn"),
  btnNew: document.getElementById("new-rule-btn"),
  btnDel: document.getElementById("delete-btn"),
  btnMods: document.getElementById("modules-btn"),
  panelMods: document.getElementById("modules-panel"),
  btnExport: document.getElementById("export-btn"),
  inputImport: document.getElementById("import-file"),
  runAtStart: document.getElementById("run-at-start"),
  timingError: document.getElementById("timing-error"),
};

/* ==========================================================
   INTELLISENSE SUGGESTION DICTIONARIES
   ========================================================== */
const JS_SUGGESTIONS = [
  {
    text: "document.querySelector",
    type: "method",
    snippet: "document.querySelector('$1')",
  },
  {
    text: "document.querySelectorAll",
    type: "method",
    snippet: "document.querySelectorAll('$1')",
  },
  {
    text: "document.getElementById",
    type: "method",
    snippet: "document.getElementById('$1')",
  },
  {
    text: "addEventListener",
    type: "method",
    snippet: "addEventListener('$1', (e) => {\n    $2\n});",
  },
  { text: "removeEventListener", type: "method" },
  { text: "console.log", type: "method", snippet: "console.log($1);" },
  { text: "console.warn", type: "method" },
  { text: "console.error", type: "method" },
  { text: "classList.add", type: "property" },
  { text: "classList.remove", type: "property" },
  { text: "classList.toggle", type: "property" },
  { text: "setAttribute", type: "method" },
  { text: "getAttribute", type: "method" },
  { text: "style.display", type: "property" },
  { text: "innerHTML", type: "property" },
  { text: "textContent", type: "property" },
  {
    text: "createElement",
    type: "method",
    snippet: "document.createElement('$1')",
  },
  { text: "appendChild", type: "method" },
  { text: "removeChild", type: "method" },
  {
    text: "setTimeout",
    type: "function",
    snippet: "setTimeout(() => {\n    $1\n}, 1000);",
  },
  {
    text: "setInterval",
    type: "function",
    snippet: "setInterval(() => {\n    $1\n}, 1000);",
  },
  {
    text: "fetch",
    type: "function",
    snippet: "fetch('$1').then(r => r.json()).then(data => {\n    $2\n});",
  },
  { text: "localStorage.getItem", type: "method" },
  { text: "localStorage.setItem", type: "method" },
  { text: "window.location.href", type: "property" },
  { text: "window.location.reload()", type: "method" },
  { text: "preventDefault()", type: "method" },
  { text: "stopPropagation()", type: "method" },
  { text: "async function", type: "keyword" },
  { text: "const", type: "keyword" },
  { text: "let", type: "keyword" },
  { text: "return", type: "keyword" },
];

const TS_SUGGESTIONS = [
  ...JS_SUGGESTIONS,
  { text: "interface", type: "keyword", snippet: "interface $1 {\n  $2\n}" },
  { text: "type", type: "keyword", snippet: "type $1 = {};" },
  { text: "enum", type: "keyword", snippet: "enum $1 {\n  $2\n}" },
  { text: "string", type: "type" },
  { text: "number", type: "type" },
  { text: "boolean", type: "type" },
  { text: "unknown", type: "type" },
  { text: "readonly", type: "keyword" },
  { text: "as", type: "keyword" },
  { text: "satisfies", type: "keyword" },
  { text: "HTMLElement", type: "type" },
];

const CSS_SUGGESTIONS = [
  { text: "display: flex;", type: "property" },
  { text: "display: grid;", type: "property" },
  { text: "display: none;", type: "property" },
  { text: "display: block;", type: "property" },
  { text: "display: inline-block;", type: "property" },
  { text: "color: #fff;", type: "property" },
  { text: "background-color: #", type: "property" },
  { text: "background: ", type: "property" },
  { text: "padding: 10px;", type: "property" },
  { text: "margin: 0 auto;", type: "property" },
  { text: "font-size: 14px;", type: "property" },
  { text: "font-weight: bold;", type: "property" },
  { text: "font-family: sans-serif;", type: "property" },
  { text: "border: 1px solid #ccc;", type: "property" },
  { text: "border-radius: 6px;", type: "property" },
  { text: "justify-content: center;", type: "property" },
  { text: "align-items: center;", type: "property" },
  { text: "position: relative;", type: "property" },
  { text: "position: absolute;", type: "property" },
  { text: "position: fixed;", type: "property" },
  { text: "z-index: 9999;", type: "property" },
  { text: "width: 100%;", type: "property" },
  { text: "height: 100%;", type: "property" },
  { text: "overflow: hidden;", type: "property" },
  { text: "cursor: pointer;", type: "property" },
  { text: "box-sizing: border-box;", type: "property" },
  { text: "transition: all 0.3s ease;", type: "property" },
  { text: "!important;", type: "keyword" },
];

/* ==========================================================
   SYNTAX HIGHLIGHTING & LINE NUMBER ENGINE
   ========================================================== */
function highlight(text, type) {
  let escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  if (type === "js") {
    return escaped.replace(
      /(\/\/.*|\/\*[\s\S]*?\*\/)|(['"`])(?:(?!\2)[^\\]|\\.)*\2|\b(const|let|var|function|return|if|else|for|while|class|import|export|from|new|this|typeof|try|catch|switch|case|break|default|await|async|true|false|null|undefined|interface|type|enum|implements|declare|namespace|readonly|public|private|protected|abstract|as|satisfies|keyof|infer|never|unknown|string|number|boolean)\b|\b([a-zA-Z_$][0-9a-zA-Z_$]*)\s*(?=\()/g,
      function (match, comment, stringQuote, keyword, func) {
        if (comment) return `<span class="token comment">${match}</span>`;
        if (stringQuote) return `<span class="token string">${match}</span>`;
        if (keyword) return `<span class="token keyword">${match}</span>`;
        if (func) return `<span class="token function">${match}</span>`;
        return match;
      },
    );
  } else if (type === "css") {
    return escaped.replace(
      /(\/\*[\s\S]*?\*\/)|(['"`])(?:(?!\2)[^\\]|\\.)*\2|([a-zA-Z0-9_-]+)(?=\s*:)|([a-zA-Z0-9_.#-]+)(?=\s*\{)/g,
      function (match, comment, stringQuote, property, selector) {
        if (comment) return `<span class="token comment">${match}</span>`;
        if (stringQuote) return `<span class="token string">${match}</span>`;
        if (property) return `<span class="token property">${match}</span>`;
        if (selector) return `<span class="token selector">${match}</span>`;
        return match;
      },
    );
  }
  return escaped;
}

function updateEditor(type) {
  const editor = type === "js" ? ui.js : ui.css;
  const hl = type === "js" ? ui.hlJs : ui.hlCss;
  const linesEl = type === "js" ? ui.jsLines : ui.cssLines;

  let text = editor.value;
  if (text[text.length - 1] === "\n") text += " ";
  hl.innerHTML = highlight(text, type);

  // Update Line Numbers
  const lineCount = editor.value.split("\n").length;
  let lineStr = "";
  for (let i = 1; i <= Math.max(lineCount, 1); i++) {
    lineStr += i + "\n";
  }
  linesEl.textContent = lineStr;
  hl.parentElement.scrollTop = editor.scrollTop;
  hl.parentElement.scrollLeft = editor.scrollLeft;
  linesEl.scrollTop = editor.scrollTop;
}

/* ==========================================================
   AUTOCOMPLETE ENGINE (INTELLISENSE)
   ========================================================== */
class AutoCompleteManager {
  constructor(textarea, autoBox, dictionary, type) {
    this.textarea = textarea;
    this.autoBox = autoBox;
    this.dictionary = dictionary;
    this.type = type;
    this.activeIdx = 0;
    this.matches = [];
    this.currentWord = "";

    this.init();
  }

  init() {
    this.textarea.addEventListener("input", (event) => {
      if (!event.isComposing) this.checkSuggestions();
    });
    this.textarea.addEventListener("keydown", (e) => this.handleKeydown(e));
    this.textarea.addEventListener("blur", () => this.hide());
    this.textarea.addEventListener("scroll", () => this.hide());
    this.textarea.addEventListener("click", () => this.hide());

    document.addEventListener("click", (e) => {
      if (!this.autoBox.contains(e.target) && e.target !== this.textarea) {
        this.hide();
      }
    });
  }

  getWordBeforeCursor() {
    const pos = this.textarea.selectionStart;
    const textBefore = this.textarea.value.slice(0, pos);
    const match = textBefore.match(/([a-zA-Z0-9_.$!:-]+)$/);
    return match ? match[1] : "";
  }

  checkSuggestions(force = false) {
    this.currentWord = this.getWordBeforeCursor();
    if (this.textarea.selectionStart !== this.textarea.selectionEnd ||
      (!force && this.currentWord.length < 2)) {
      this.hide();
      return;
    }

    const query = this.currentWord.toLowerCase();
    this.matches = this.dictionary.filter((item) =>
      item.text.toLowerCase().includes(query),
    ).sort((a, b) => Number(b.text.toLowerCase().startsWith(query)) -
      Number(a.text.toLowerCase().startsWith(query)));

    if (this.matches.length === 0) {
      this.hide();
      return;
    }

    this.activeIdx = 0;
    this.render();
  }

  render() {
    this.autoBox.innerHTML = "";
    this.matches.slice(0, 7).forEach((item, index) => {
      const div = document.createElement("div");
      div.className =
        "autocomplete-item" + (index === this.activeIdx ? " selected" : "");
      div.innerHTML = `
                <span class="suggestion-text">${item.text}</span>
                <span class="suggestion-badge">${item.type}</span>
            `;
      div.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.applySuggestion(item);
      });
      this.autoBox.appendChild(div);
    });

    const textBefore = this.textarea.value.slice(
      0,
      this.textarea.selectionStart,
    );
    const lineIndex = textBefore.split("\n").length;
    const topPos = Math.min(
      lineIndex * 20 + 15 - this.textarea.scrollTop,
      this.textarea.clientHeight - 180,
    );

    this.autoBox.style.top = `${Math.max(0, topPos)}px`;
    this.autoBox.style.left = "15px";
    this.autoBox.style.maxWidth = `${Math.max(0, this.textarea.clientWidth - 30)}px`;
    this.autoBox.classList.remove("hidden");
  }

  applySuggestion(item) {
    const placeholder = item.snippet?.indexOf("$1") ?? -1;
    const textToInsert = item.snippet
      ? item.snippet.replace(/\$1|\$2/g, "")
      : item.text;
    const pos = this.textarea.selectionStart;
    const start = pos - this.currentWord.length;
    this.editor.replace(textToInsert, start, pos,
      start + (placeholder >= 0 ? placeholder : textToInsert.length));

    this.hide();
    updateEditor(this.type);
    this.textarea.focus();
  }

  handleKeydown(e) {
    if (e.isComposing) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.code === "Space") {
        e.preventDefault();
        this.checkSuggestions(true);
      } else {
        this.hide();
      }
      return;
    }
    if (!this.autoBox.classList.contains("hidden") && this.matches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.activeIdx =
          (this.activeIdx + 1) % Math.min(this.matches.length, 7);
        this.updateSelectedUI();
        return;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.activeIdx =
          (this.activeIdx - 1 + Math.min(this.matches.length, 7)) %
          Math.min(this.matches.length, 7);
        this.updateSelectedUI();
        return;
      } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
        e.preventDefault();
        this.applySuggestion(this.matches[this.activeIdx]);
        return;
      } else if (e.key === "Escape") {
        this.hide();
        return;
      }
    }

    if (["ArrowLeft", "ArrowRight", "Home", "End", "Tab"].includes(e.key)) this.hide();
  }

  updateSelectedUI() {
    const items = this.autoBox.querySelectorAll(".autocomplete-item");
    items.forEach((el, idx) => {
      el.classList.toggle("selected", idx === this.activeIdx);
    });
  }

  hide() {
    this.autoBox.classList.add("hidden");
    this.matches = [];
  }
}

// Instantiate Autocomplete on both editors
const jsAuto = new AutoCompleteManager(ui.js, ui.jsAuto, JS_SUGGESTIONS, "js");
const cssAuto = new AutoCompleteManager(
  ui.css,
  ui.cssAuto,
  CSS_SUGGESTIONS,
  "css",
);
jsAuto.editor = new CodeEditor(ui.js, () => {
  updateEditor("js");
  scheduleScriptValidation();
}, document.getElementById("js-status"));
cssAuto.editor = new CodeEditor(ui.css, () => updateEditor("css"), document.getElementById("css-status"), "css");

let compileTimer;
function validateScriptSource() {
  clearTimeout(compileTimer);
  if (ui.jsLanguage.value !== "ts") {
    ui.compileMessage.classList.add("hidden");
    return true;
  }
  ui.compileMessage.classList.remove("hidden");
  try {
    transpileRuleJavaScript({ js: ui.js.value, jsLanguage: "ts" });
    ui.compileMessage.textContent = "TypeScript compiles locally. Single-file scripts only; imports and JSX are not supported. No type checking.";
    ui.compileMessage.classList.remove("editor-error");
    return true;
  } catch (error) {
    ui.compileMessage.textContent = `TypeScript error: ${error.message} JavaScript will not run until this is fixed.`;
    ui.compileMessage.classList.add("editor-error");
    return false;
  }
}

function updateScriptLanguage() {
  const typescript = ui.jsLanguage.value === "ts";
  jsAuto.hide();
  jsAuto.dictionary = typescript ? TS_SUGGESTIONS : JS_SUGGESTIONS;
  ui.js.setAttribute("aria-label", typescript ? "TypeScript editor" : "JavaScript editor");
  ui.js.placeholder = typescript ? "Write TypeScript; it compiles to JavaScript before injection..." : "Start typing JavaScript...";
  document.getElementById("beautify-js").title = typescript ? "Beautify TypeScript" : "Beautify JavaScript";
  document.getElementById("js-format-message").classList.add("hidden");
  validateScriptSource();
  updateEditor("js");
}
ui.jsLanguage.addEventListener("change", updateScriptLanguage);
function scheduleScriptValidation() {
  clearTimeout(compileTimer);
  compileTimer = setTimeout(validateScriptSource, 250);
}

for (const [type, manager] of [["js", jsAuto], ["css", cssAuto]]) {
  const button = document.getElementById(`beautify-${type}`);
  const message = document.getElementById(`${type}-format-message`);
  button.addEventListener("click", async () => {
    const ruleId = currentRuleId;
    const editor = manager.textarea;
    const source = editor.value;
    const language = type === "js" ? ui.jsLanguage.value : "css";
    button.disabled = true;
    button.textContent = "Formatting...";
    message.classList.add("hidden");
    try {
      const result = await beautifySource(source, language, editor.selectionStart);
      // A rule switch or further typing must never be overwritten by an old result.
      if (ruleId !== currentRuleId || source !== editor.value ||
        language !== (type === "js" ? ui.jsLanguage.value : "css")) return;
      manager.hide();
      manager.editor.replace(result.formatted, 0, source.length, result.cursorOffset);
      if (type === "js") validateScriptSource();
      message.textContent = type === "css"
        ? "Beautified. SCSS formatting does not compile SCSS to CSS."
        : "Beautified. Save to apply your changes.";
      message.classList.remove("editor-error", "hidden");
    } catch (error) {
      if (ruleId !== currentRuleId || source !== editor.value ||
        language !== (type === "js" ? ui.jsLanguage.value : "css")) return;
      message.textContent = `Could not beautify: ${error.message}`;
      message.classList.add("editor-error");
      message.classList.remove("hidden");
    } finally {
      button.disabled = false;
      button.textContent = "Beautify";
    }
  });
}

function validateTiming() {
  const hasLibraries = ui.libs.value.split("\n").some((line) => line.trim());
  const invalid = ui.runAtStart.checked && hasLibraries;
  ui.timingError.textContent = invalid
    ? "Remove external libraries or turn off document start before saving. Libraries cannot finish loading before the DOM starts building."
    : "";
  ui.timingError.classList.toggle("hidden", !invalid);
  return !invalid;
}
ui.runAtStart.addEventListener("change", validateTiming);
ui.libs.addEventListener("input", validateTiming);

// Synchronize inputs & scrolling

ui.js.addEventListener("scroll", () => {
  ui.hlJs.parentElement.scrollTop = ui.js.scrollTop;
  ui.hlJs.parentElement.scrollLeft = ui.js.scrollLeft;
  ui.jsLines.scrollTop = ui.js.scrollTop;
});
ui.css.addEventListener("scroll", () => {
  ui.hlCss.parentElement.scrollTop = ui.css.scrollTop;
  ui.hlCss.parentElement.scrollLeft = ui.css.scrollLeft;
  ui.cssLines.scrollTop = ui.css.scrollTop;
});

/* ==========================================================
   EXTENSION RULES STORAGE & MANAGEMENT
   ========================================================== */
ext.storage.local.get(["rules", "targetRuleId"]).then((res) => {
  rules = res.rules || [];
  const targetId = res.targetRuleId;
  if (targetId) ext.storage.local.remove(["targetRuleId"]);

  if (rules.length === 0) {
    createRule();
  } else {
    renderList();
    const ruleToSelect = rules.find((r) => r.id === targetId) || rules[0];
    selectRule(ruleToSelect.id);
  }
});

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function renderList(filter = "") {
  ui.list.innerHTML = "";
  const filtered = rules.filter((r) =>
    (r.name + r.urlPattern).toLowerCase().includes(filter.toLowerCase()),
  );
  ui.count.textContent = rules.length;

  filtered.forEach((rule) => {
    const li = document.createElement("li");
    li.className = "rule-item" + (rule.id === currentRuleId ? " active" : "");
    li.innerHTML = `
            <div class="rule-info">
                <div class="rule-name"></div>
                <div class="rule-url"></div>
            </div>
            <label class="switch" title="Enable/Disable">
                <input type="checkbox" role="switch" class="rule-toggle" ${rule.enabled !== false ? "checked" : ""}>
                <span class="slider" aria-hidden="true"></span>
            </label>
        `;
    li.querySelector(".rule-name").textContent = rule.name || "Untitled";
    li.querySelector(".rule-url").textContent = rule.urlPattern || "*";
    li.querySelector(".rule-toggle").setAttribute("aria-label", `Enable ${rule.name || "Untitled rule"}`);

    li.addEventListener("click", (e) => {
      if (!e.target.closest(".switch")) selectRule(rule.id);
    });

    li.querySelector(".rule-toggle").addEventListener("change", (e) => {
      rule.enabled = e.target.checked;
      saveAll(() => notifyBackgroundLiveUpdate(rule));
    });

    ui.list.appendChild(li);
  });
}

// Copy the editor fields into the open rule; returns true if anything changed
function commitEditor() {
  const rule = rules.find((r) => r.id === currentRuleId);
  if (!rule) return false;
  const next = {
    runAt: ui.runAtStart.checked ? "document_start" : "document_idle",
    name: ui.name.value,
    urlPattern: ui.url.value,
    js: ui.js.value,
    jsLanguage: ui.jsLanguage.value === "ts" ? "ts" : "js",
    css: ui.css.value,
    libs: ui.libs.value
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l),
  };
  const changed = Object.keys(next).some(
    (k) => JSON.stringify(next[k]) !== JSON.stringify(rule[k] ?? (k === "libs" ? [] : "")),
  );
  if (changed) Object.assign(rule, next);
  return changed;
}

function selectRule(id) {
  // Don't lose edits when jumping to another rule
  if (currentRuleId && currentRuleId !== id) {
    if (rules.some((rule) => rule.id === currentRuleId) && !validateTiming()) return;
    const prev = rules.find((r) => r.id === currentRuleId);
    if (commitEditor()) saveAll(() => notifyBackgroundLiveUpdate(prev));
  }
  currentRuleId = id;
  const rule = rules.find((r) => r.id === id);
  if (!rule) return;

  ui.name.value = rule.name || "";
  ui.url.value = rule.urlPattern || "";
  ui.js.value = rule.js || "";
  ui.jsLanguage.value = rule.jsLanguage === "ts" ? "ts" : "js";
  ui.css.value = rule.css || "";
  ui.runAtStart.checked = rule.runAt === "document_start";
  for (const type of ["js", "css"]) document.getElementById(`${type}-format-message`).classList.add("hidden");
  jsAuto.hide();
  cssAuto.hide();
  jsAuto.editor.reset();
  cssAuto.editor.reset();
  ui.libs.value = (rule.libs || []).join("\n");
  validateTiming();
  ui.btnMods.textContent = `${(rule.libs || []).length} Modules`;
  updateScriptLanguage();

  updateEditor("js");
  updateEditor("css");
  renderList(ui.search.value);
}

function createRule() {
  if (rules.some((rule) => rule.id === currentRuleId) && !validateTiming()) return;
  const r = {
    id: generateId(),
    name: "New Rule",
    urlPattern: "https://example.com/*",
    js: "",
    jsLanguage: "js",
    css: "",
    libs: [],
    enabled: true,
    runAt: "document_idle",
  };
  rules.unshift(r);
  selectRule(r.id);
  saveAll();
}

function saveAll(callback) {
  ext.storage.local.set({ rules }).then(() => {
    renderList(ui.search.value);
    if (callback) callback();
  });
}

ui.btnSave.addEventListener("click", () => {
  if (!currentRuleId) return;
  if (!validateTiming()) return;
  const rule = rules.find((r) => r.id === currentRuleId);
  if (rule) {
    validateScriptSource();
    commitEditor();

    ui.btnMods.textContent = `${rule.libs.length} Modules`;
    saveAll(() => {
      notifyBackgroundLiveUpdate(rule);
      ui.btnSave.textContent = "Saved!";
      setTimeout(() => (ui.btnSave.textContent = "Save"), 1500);
    });
  }
});

function notifyBackgroundLiveUpdate(rule) {
  ext.runtime.sendMessage({ action: "ruleUpdated", rule: rule });
}

ui.btnNew.addEventListener("click", createRule);
ui.search.addEventListener("input", (e) => renderList(e.target.value));

ui.btnDel.addEventListener("click", () => {
  if (confirm("Delete this rule?")) {
    const deleted = rules.find((r) => r.id === currentRuleId);
    rules = rules.filter((r) => r.id !== currentRuleId);
    // Let the background drop the rule's registered script and injected CSS
    saveAll(() => {
      if (deleted) notifyBackgroundLiveUpdate({ ...deleted, enabled: false });
    });
    if (rules.length) selectRule(rules[0].id);
    else createRule();
  }
});

ui.btnMods.addEventListener("click", () => {
  ui.panelMods.classList.toggle("hidden");
});

ui.btnExport.addEventListener("click", () => {
  if (!validateTiming()) return;
  commitEditor();
  const blob = new Blob([JSON.stringify(rules, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "user-js-css-rules.json";
  a.click();
  URL.revokeObjectURL(url);
});

ui.inputImport.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const imported = JSON.parse(event.target.result);
      if (!Array.isArray(imported)) throw new Error("not an array");
      if (!confirm(`Replace all current rules with ${imported.length} imported rule(s)?`)) return;
      rules = imported
        .filter((r) => r && typeof r === "object")
        .map((r) => ({
          id: typeof r.id === "string" && r.id ? r.id : generateId(),
          name: String(r.name ?? ""),
          urlPattern: String(r.urlPattern ?? ""),
          js: String(r.js ?? ""),
          jsLanguage: r.jsLanguage === "ts" ? "ts" : "js",
          css: String(r.css ?? ""),
          libs: Array.isArray(r.libs) ? r.libs.map(String) : [],
          enabled: r.enabled !== false,
          runAt: r.runAt === "document_start" ? "document_start" : "document_idle",
        }));
      currentRuleId = null; // don't let the old editor contents overwrite imported rules
      saveAll(() => ext.runtime.sendMessage({ action: "ruleUpdated", rule: { id: "import", urlPattern: "", enabled: false } }));
      if (rules.length) selectRule(rules[0].id);
      else createRule();
      alert("Rules imported successfully!");
    } catch (err) {
      alert("Invalid JSON file.");
    }
  };
  reader.readAsText(file);
});
