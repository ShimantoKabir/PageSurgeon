const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

module.exports = (async () => {
  const src = (file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const warnings = [];
  let rules = [];
  let registered = [];
  let installed = false;
  const imported = new Set();
  const event = () => ({ addListener() {} });
  const api = {
    runtime: { id: 'test', onInstalled: event(), onStartup: event(), onMessage: event() },
    permissions: { onAdded: event(), onRemoved: event() },
    storage: { local: { get: async () => ({ rules }) } },
    tabs: { onUpdated: event() },
    userScripts: {
      configureWorld: async () => {},
      getScripts: async () => registered,
      unregister: async () => { registered = []; },
      register: async (scripts) => registered.push(...scripts),
    },
  };
  const worker = vm.createContext({ chrome: api, console: { warn: (...args) => warnings.push(args), error: console.error } });
  worker.importScripts = (...files) => {
    for (const file of files) {
      if (installed && !imported.has(file)) {
        throw new Error(`importScripts() of new scripts after service worker installation is not allowed: ${file}`);
      }
      imported.add(file);
      vm.runInContext(src(file), worker, { filename: file });
    }
  };
  vm.runInContext(src('background.js'), worker, { filename: 'background.js' });
  // Chrome only permits scripts discovered during initial evaluation/install.
  installed = true;
  await vm.runInContext('syncReady', worker);
  rules = [{ id: 'new-ts-rule', name: 'New TS rule', urlPattern: 'https://example.com/*',
    jsLanguage: 'ts', js: 'const value: number = 42; globalThis.result = value;' }];
  await vm.runInContext('syncUserScripts()', worker);
  assert.equal(registered.length, 1, warnings.map((warning) => warning.join(' ')).join('\n'));
  const page = vm.createContext({ location: { href: 'https://example.com/' } });
  vm.runInContext(registered[0].js[0].code, page);
  assert.equal(page.result, 42);
  assert.ok(imported.has('vendor/typescript/typescript.js'));

  // Run the exact TS badge example through worker compilation and registration.
  rules[0].js = fs.readFileSync(path.join(__dirname, 'fixtures/typescript-badge.ts'), 'utf8');
  for (const timing of ['document_start', 'document_idle']) {
    rules[0].runAt = timing;
    await vm.runInContext('syncUserScripts()', worker);
    assert.equal(registered[0].runAt, timing);
    const badges = new Map();
    const events = {};
    const document = {
      readyState: timing === 'document_start' ? 'loading' : 'complete',
      createElement: () => ({ style: {}, remove() { badges.delete(this.id); } }),
      getElementById: (id) => badges.get(id),
      addEventListener: (name, callback) => { events[name] = callback; },
      body: { appendChild: (badge) => badges.set(badge.id, badge) },
    };
    const badgePage = vm.createContext({ location: { href: 'https://example.com/' }, document,
      console: { log() {} } });
    vm.runInContext(registered[0].js[0].code, badgePage);
    if (timing === 'document_start') {
      assert.equal(badges.size, 0);
      events.DOMContentLoaded();
    }
    assert.equal(badges.get('pagesurgeon-ts-test').textContent, '✅ TypeScript is working!');
    assert.equal(badges.get('pagesurgeon-ts-test').style.background, '#2563eb');
  }
  console.log('Service-worker lifecycle check passed: TS added after installation compiles and registers without a late script import.');
  console.log('Exact TS badge example passed at document_start and document_idle using the DOM fixture.');
})();
