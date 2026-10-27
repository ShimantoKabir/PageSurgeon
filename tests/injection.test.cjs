const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

module.exports = (async () => {
  const shared = fs.readFileSync(path.join(__dirname, '../src/shared.js'), 'utf8');
  const background = fs.readFileSync(path.join(__dirname, '../src/background.js'), 'utf8');
  const handlers = {};
  const calls = [];
  let registered = [];
  const event = (name) => ({ addListener(fn) { handlers[name] = fn; } });
  const rule = (id, extra = {}) => ({ id, name: id, enabled: true,
    urlPattern: 'https://example.com/*, !*private*', js: 'globalThis.runs = (globalThis.runs || 0) + 1;',
    css: '', libs: [], ...extra });
  const rules = [rule('idle'), rule('early', { runAt: 'document_start', css: 'body{color:red}' }),
    rule('css-only', { runAt: 'document_start', js: '', css: 'p{color:blue}' }),
    rule('disabled', { enabled: false, runAt: 'document_start' }),
    rule('library', { libs: ['https://example.com/lib.js'] })];
  const api = {
    runtime: { id: 'test-extension', onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message') },
    permissions: { onAdded: event('added'), onRemoved: event('removed') },
    storage: { local: { get: async () => ({ rules }) } },
    tabs: { onUpdated: event('updated'), query: async () => [{ id: 1, url: 'https://example.com/page' }] },
    scripting: {
      insertCSS: async (options) => calls.push(['css', options]),
      executeScript: async (options) => calls.push(['script', options]),
    },
    userScripts: {
      configureWorld: async (options) => calls.push(['configure-world', options]),
      getScripts: async () => registered,
      unregister: async () => { registered = []; },
      register: async (scripts) => { registered.push(...scripts); },
      execute: async (options) => calls.push(['js', options]),
    },
  };
  const warnings = [];
  const context = vm.createContext({ chrome: api, console: { warn: (...args) => warnings.push(args), error: console.error } });
  vm.runInContext(shared + '\n' + background, context);
  await vm.runInContext('syncReady', context);
  const worldPolicy = calls.find(([name]) => name === 'configure-world')[1];
  assert.match(worldPolicy.csp, /script-src[^;]*'unsafe-inline'/);
  assert.match(worldPolicy.csp, /http:\/\/localhost:\*/);
  assert.match(worldPolicy.csp, /http:\/\/127\.0\.0\.1:\*/);
  assert.equal(worldPolicy.messaging, undefined);
  assert.equal(registered.length, 3);
  assert.equal(registered.find((script) => script.id === 'usr_idle').runAt, 'document_idle');
  assert.ok(registered.every((script) => script.world === 'USER_SCRIPT'));
  const early = registered.find((script) => script.id === 'usr_early');
  assert.equal(early.runAt, 'document_start');
  assert.equal(registered.find((script) => script.id === 'usr_css-only').runAt, 'document_start');

  let observerCallback;
  let disconnected = false;
  const styles = new Map();
  const document = { head: null, documentElement: null,
    getElementById: (id) => styles.get(id),
    createElement: () => ({ remove() { styles.delete(this.id); } }),
  };
  const page = vm.createContext({ location: { href: 'https://example.com/page' }, document,
    MutationObserver: class {
      constructor(callback) { observerCallback = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    },
  });
  vm.runInContext(early.js[0].code, page);
  assert.equal(page.runs, 1); // JavaScript did not wait for a document root.
  assert.equal(styles.size, 0);
  document.documentElement = { appendChild: (style) => styles.set(style.id, style) };
  observerCallback();
  assert.equal(styles.size, 1);
  assert.equal([...styles.values()][0].textContent, 'body{color:red}');
  assert.equal(disconnected, true);
  for (const url of ['https://example.com/private/a', 'https://other.com/page']) {
    const excluded = vm.createContext({ location: { href: url } });
    vm.runInContext(early.js[0].code, excluded);
    assert.equal(excluded.runs, undefined);
  }

  // Normal page completion must not run registered JS again.
  await handlers.updated(1, { status: 'complete' }, { url: 'https://example.com/page' });
  // The library rule uses fallback execution; the early and idle registered rules do not.
  assert.equal(calls.filter(([name]) => name === 'js').length, 1);
  const cssIndex = calls.findIndex(([name]) => name === 'css');
  const cleanupIndex = calls.findIndex(([name, options]) => name === 'script' && options.args?.[0] === 'pagesurgeon-test-extension-early');
  assert.ok(cleanupIndex > cssIndex);

  // Live execution configures the same environment before running the rule.
  calls.length = 0;
  await vm.runInContext(`injectRule(1, 'https://example.com/page', {
    id: 'live-loader', enabled: true, urlPattern: 'https://example.com/*',
    js: 'document.head.append(Object.assign(document.createElement("script"), { textContent: "void 0" }));'
  })`, context);
  assert.equal(calls[0][0], 'configure-world');
  assert.equal(calls[1][0], 'js');
  assert.equal(calls[1][1].world, 'USER_SCRIPT');
  assert.match(calls[1][1].js[0].code, /textContent/); // User source is not rewritten.

  calls.length = 0;
  await new Promise((resolve) => {
    assert.equal(handlers.message({ action: 'ruleUpdated', rule: rules[1] }, {}, resolve), true);
  });
  assert.equal(calls.filter(([name]) => name === 'js').length, 0); // Early saves wait for a reload.
  await Promise.all([vm.runInContext('syncUserScripts()', context), vm.runInContext('syncUserScripts()', context)]);
  assert.equal(registered.length, 3); // Rapid synchronization does not duplicate registrations.

  api.userScripts = undefined;
  handlers.removed({ permissions: ['userScripts'] });
  calls.length = 0;
  await handlers.updated(1, { status: 'complete' }, { url: 'https://example.com/page' });
  assert.ok(warnings.some((args) => args[0].includes('Document-start rule')));
  // The early script is not silently run at document completion without permission.
  // Use a distinct early-only rule to distinguish it from the idle/library sources.
  rules.splice(0, rules.length, rule('only-early', { js: 'globalThis.earlyOnly = true;', runAt: 'document_start' }));
  calls.length = 0;
  await handlers.updated(1, { status: 'complete' }, { url: 'https://example.com/page' });
  assert.equal(calls.length, 0);
  console.log('Injection checks passed: user-script CSP, unchanged loader source, timing, CSS-only rules, DOM-root observer, exclusions, CSS handoff, live updates, serialized registration, missing permission.');
})();
