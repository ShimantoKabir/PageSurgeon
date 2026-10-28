const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

module.exports = (async () => {
  const src = (name) => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
  const names = JSON.parse(src('vendor/typescript/libs.json').replace(/^\uFEFF/, ''));
  const libraries = Object.fromEntries(names.map((name) => [name, src('vendor/typescript/' + name)]));
  for (const text of Object.values(libraries)) {
    for (const match of text.matchAll(/<reference\s+lib="([^"]+)"/g)) {
      assert.ok(libraries['lib.' + match[1] + '.d.ts'], `Missing type dependency ${match[1]}`);
    }
  }
  const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(src('vendor/typescript/typescript.js'), context);
  vm.runInContext(src('intelligence.js'), context);
  context.libraries = libraries;
  const engine = vm.runInContext('new ScriptIntelligence(libraries)', context);
  const complete = (source, language = 'js') => engine.complete(source, source.length, language);
  const has = (result, ...names) => {
    const entries = new Set(result.items.map((item) => item.text));
    for (const name of names) assert.ok(entries.has(name), `Missing completion: ${name}`);
  };

  const source = "const x = document.querySelector('a#dib');\nx.";
  const anchors = complete(source);
  assert.ok(anchors.items.length > 100);
  has(anchors, 'href', 'textContent', 'classList', 'style', 'addEventListener', 'click');
  const partial = source + 'hr';
  const href = complete(partial).items.find((entry) => entry.text === 'href');
  const accepted = partial.slice(0, href.replaceStart) + href.insertText + partial.slice(href.replaceStart + href.replaceLength);
  assert.equal(accepted, source + 'href'); // Receiver is preserved.
  const mid = source + 'hrzzz';
  const midEntry = engine.complete(mid, mid.length - 3).items.find((entry) => entry.text === 'href');
  assert.equal(mid.slice(0, midEntry.replaceStart) + midEntry.insertText + mid.slice(midEntry.replaceStart + midEntry.replaceLength), source + 'href');
  has(complete("const x = document.querySelector('a#dib');\nx?."), 'href');
  has(complete("const x = document.querySelector('div.card');\nx.classList."), 'add', 'remove', 'toggle', 'contains');
  has(complete("const x = document.querySelector('div.card');\nx.style."), 'backgroundColor', 'display', 'setProperty');
  has(complete("const input = document.querySelector('form > input[type=text]');\ninput."), 'value', 'checked', 'focus');
  has(complete("const links = document.querySelectorAll('a.link');\nlinks[0]."), 'href', 'click');
  has(complete("const el = document.getElementById('dib');\nel."), 'style', 'textContent');
  has(complete('const items = [1, 2];\nitems.'), 'map', 'filter', 'push', 'length');
  has(complete('const title = "Hello";\ntitle.'), 'toUpperCase', 'includes', 'length');
  has(complete('const user = {name: "Ada", age: 25};\nuser.'), 'name', 'age');
  has(complete('const result = Promise.resolve(42);\nresult.'), 'then', 'catch', 'finally');
  has(complete('interface Person {name:string; age:number}\nconst person: Person = {name:"Ada",age:25};\nperson.', 'ts'), 'name', 'age');
  assert.equal(complete('// document.').items.length, 0);
  assert.equal(complete('const text = "document.').items.length, 0);
  complete('globalThis.sideEffect = true;\nconst values = [];\nvalues.');
  assert.equal(context.sideEffect, undefined); // Autocomplete never evaluates user code.

  // Exercise the actual editor controller's asynchronous completion/acceptance path.
  const options = src('options.js');
  const controller = options.slice(options.indexOf('class AutoCompleteManager {'), options.indexOf('// Instantiate Autocomplete'));
  const handlers = {};
  const attrs = new Map();
  const textarea = { value: source, selectionStart: source.length, selectionEnd: source.length,
    addEventListener: (name, fn) => { handlers[name] = fn; },
    setAttribute: (name, value) => attrs.set(name, value), removeAttribute: (name) => attrs.delete(name), focus() {} };
  const classes = new Set(['hidden']);
  const autoBox = { id: 'suggestions', setAttribute() {}, contains: () => false,
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) } };
  context.document = { activeElement: textarea, addEventListener() {} };
  context.ui = { jsLanguage: { value: 'js' } };
  context.scriptCompletions = { suggest: async (source, position, language) => engine.complete(source, position, language) };
  context.updateEditor = () => {};
  vm.runInContext(controller, context);
  context.textarea = textarea;
  context.autoBox = autoBox;
  const manager = vm.runInContext('new AutoCompleteManager(textarea, autoBox, [], "js")', context);
  manager.render = () => classes.delete('hidden');
  manager.updateSelectedUI = () => {};
  manager.editor = { replace: (text, start, end, cursor) => {
    textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = cursor;
  } };
  await manager.checkSuggestions();
  has({ items: manager.matches }, 'href', 'textContent');
  manager.activeIdx = 6;
  manager.handleKeydown({ key: 'ArrowDown', preventDefault() {} });
  assert.equal(manager.activeIdx, 7); // Members beyond the old seven-item limit are reachable.
  manager.applySuggestion(manager.matches.find((item) => item.text === 'href'));
  assert.equal(textarea.value, source + 'href');
  assert.equal(attrs.get('aria-expanded'), 'false');
  let resolve;
  context.scriptCompletions = { suggest: () => new Promise((done) => { resolve = done; }) };
  const pending = manager.checkSuggestions(true);
  manager.hide();
  resolve(anchors);
  await pending;
  assert.equal(manager.matches.length, 0); // Dismissed requests cannot reopen the popup.

  // Exercise the packaged worker bootstrap and local type-library loading.
  const messages = [];
  const worker = vm.createContext({ URL, self: {
    location: { href: 'chrome-extension://test/src/completion-worker.js' },
    postMessage: (message) => messages.push(message),
  } });
  worker.importScripts = (...files) => files.forEach((file) => vm.runInContext(src(file), worker));
  worker.fetch = async (url) => {
    assert.equal(url.protocol, 'chrome-extension:');
    const text = src(url.pathname.replace(/^\/src\//, ''));
    return { ok: true, text: async () => text, json: async () => JSON.parse(text.replace(/^\uFEFF/, '')) };
  };
  vm.runInContext(src('completion-worker.js'), worker);
  await worker.self.onmessage({ data: { id: 1, source, position: source.length, language: 'js' } });
  assert.equal(messages[0].id, 1);
  has(messages[0].result, 'href', 'textContent');
  console.log('Completion checks passed: anchor inference, DOM chains, optional access, arrays, strings, objects, promises, TS interfaces, filtering, safe insertion, no evaluation, and stale-request cancellation.');
})();
